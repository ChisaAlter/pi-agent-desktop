import { randomUUID } from "crypto";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
    SubagentInstance,
    SubagentResult,
    SubagentStatus,
    SubagentTypeID,
} from "@shared";
import { SubagentSession, type SubagentSessionSnapshot } from "./session";

/**
 * SubagentManager — Phase E Task 1.
 *
 * Owns the per-agent subagent registry and lifecycle. Each primary agent gets
 * a `Map<actorId, SubagentSession>`; a flat `Map<actorId, SubagentInstance>`
 * mirror is kept for fast `status()` / `listInstances()` lookups without
 * touching the underlying session.
 *
 * Responsibilities:
 *  - spawn: create an isolated AgentSession via the injected factory, wrap it
 *    in a `SubagentSession`, register both Maps, kick off `run()` async, and
 *    return the `actorId` + outcome Promise.
 *  - status / wait / cancel: synchronous snapshot lookup; `wait` awaits the
 *    outcome Promise; `cancel` triggers `SubagentSession.cancel()`.
 *  - disposeAgent / disposeAll: tear down all sessions for one or all agents.
 *  - GC sweep: every 60s, finds `idle` sessions older than 5 min and disposes
 *    them (no waiter can resume them after the grace period).
 *
 * The manager is intentionally agnostic of `createWorkspaceSession` — callers
 * inject a `SubagentSessionFactory` so the manager can be unit-tested with a
 * mock session. Nesting prevention (`actor` tool refusing to run from a
 * subagent) is enforced at the tool layer, not here.
 */

export interface SubagentSpawnContext {
    workspaceId: string;
    workspacePath: string;
    agentId: string;
}

export interface SubagentSpawnOptions {
    context: SubagentSpawnContext;
    subagentType: SubagentTypeID;
    description: string;
    prompt: string;
    timeoutMs?: number;
    toolAllowlist?: string[];
    customTools?: ToolDefinition[];
    modelRef?: { provider: string; modelId: string };
}

export interface SubagentSpawnResult {
    actorId: string;
    outcome: Promise<SubagentResult>;
}

export type SubagentSessionFactory = (opts: {
    context: SubagentSpawnContext;
    subagentType: SubagentTypeID;
    toolAllowlist?: string[];
    customTools?: ToolDefinition[];
    modelRef?: { provider: string; modelId: string };
}) => Promise<AgentSession>;

/** Event broadcast to the renderer via `subagent:event` IPC (Task 6 wires it). */
export interface SubagentManagerEvent {
    agentId: string;
    actorId: string;
    type: "spawned" | "running" | "terminated" | "gc_collected";
    status?: SubagentStatus;
    lastOutcome?: string;
    subagentType: SubagentTypeID;
    description: string;
}

export interface SubagentManagerOpts {
    sessionFactory: SubagentSessionFactory;
    /** Called on every state change. Caller wires this to IPC broadcast. */
    onEvent?: (event: SubagentManagerEvent) => void;
    /** Override for testing; defaults to `Date.now`. */
    now?: () => number;
}

/** Default 10 min timeout, matching spec.md "Subagent Result Handoff". */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** GC sweep interval. */
const GC_INTERVAL_MS = 60 * 1000;
/** Idle grace period before GC reclaims a session. */
const IDLE_GRACE_MS = 5 * 60 * 1000;
/**
 * Phase 3 Task 10 — per-subagent-type concurrency cap. Counts ONLY non-terminal
 * actors of the given type for a given primary agentId. When the count is at
 * the cap, `spawn` throws `SubagentConcurrencyLimitError` so the caller
 * (actor-tool / auto-scheduler) can surface "busy, retry later" instead of
 * piling on more sessions that would starve the same model / disk / context.
 *
 * Rationale for defaults:
 *  - `explore`: cheap read-only actor; allow up to 4 in parallel for fast
 *    multi-region scans (matches MiMo Code's design).
 *  - `dream` / `distill` / `checkpoint-writer`: each is a single-writer actor
 *    that produces a markdown memory / checkpoint; concurrent instances would
 *    race on the same files, so cap at 1.
 */
const MAX_CONCURRENT_ACTORS: Record<string, number> = {
    explore: 4,
    dream: 1,
    distill: 1,
    "checkpoint-writer": 1,
};
/** Fallback cap when a subagent type is not listed above. */
const DEFAULT_MAX_CONCURRENT_ACTORS = 4;

/**
 * Error thrown by `spawn` when the per-type concurrency cap is reached.
 * Callers can catch this and surface a "busy" message instead of piling on
 * more sessions.
 */
export class SubagentConcurrencyLimitError extends Error {
    readonly agentId: string;
    readonly subagentType: SubagentTypeID;
    readonly current: number;
    readonly limit: number;
    constructor(agentId: string, subagentType: SubagentTypeID, current: number, limit: number) {
        super(
            `subagent concurrency limit reached for agent=${agentId} type=${subagentType}: ${current}/${limit} active. ` +
                "Wait for an existing actor to finish or cancel one before retrying.",
        );
        this.name = "SubagentConcurrencyLimitError";
        this.agentId = agentId;
        this.subagentType = subagentType;
        this.current = current;
        this.limit = limit;
    }
}

export class SubagentManager {
    private readonly sessionFactory: SubagentSessionFactory;
    private readonly onEvent?: (event: SubagentManagerEvent) => void;
    private readonly now: () => number;

    /** agentId → (actorId → SubagentSession). */
    private readonly sessionsByAgent = new Map<string, Map<string, SubagentSession>>();
    /** actorId → SubagentInstance metadata (mirror, fast lookup). */
    private readonly instancesByActor = new Map<string, SubagentInstance>();
    /** actorId → primary agentId (reverse lookup for GC). */
    private readonly agentByActor = new Map<string, string>();
    /** actorId → waiter Resolvers (for `wait()`). */
    private readonly waitersByActor = new Map<
        string,
        Array<{ resolve: (r: SubagentResult | null) => void; timer?: NodeJS.Timeout }>
    >();

    private gcHandle?: NodeJS.Timeout;

    constructor(opts: SubagentManagerOpts) {
        this.sessionFactory = opts.sessionFactory;
        this.onEvent = opts.onEvent;
        this.now = opts.now ?? Date.now;
    }

    /** Start the periodic GC sweep. Idempotent. */
    start(): void {
        if (this.gcHandle) return;
        this.gcHandle = setInterval(() => this.runGcSweep(), GC_INTERVAL_MS);
        // Allow the process to exit even if the timer is alive.
        if (this.gcHandle.unref) this.gcHandle.unref();
    }

    /** Stop the GC sweep. Safe to call when not started. */
    stop(): void {
        if (this.gcHandle) {
            clearInterval(this.gcHandle);
            this.gcHandle = undefined;
        }
    }

    /**
     * Spawn a subagent. Returns immediately with `actorId` + outcome Promise;
     * the conversation loop runs async inside `SubagentSession.run`.
     *
     * Phase 3 Task 10: throws `SubagentConcurrencyLimitError` synchronously
     * (before session creation) when the per-(agentId, subagentType) active
     * count is already at the cap. Callers should catch and surface a "busy"
     * message rather than piling on more sessions.
     */
    async spawn(opts: SubagentSpawnOptions): Promise<SubagentSpawnResult> {
        const actorId = makeActorId(opts.subagentType);
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        // Phase 3 Task 10: per-type concurrency check (BEFORE session creation
        // so we don't allocate a Pi AgentSession we'll immediately dispose).
        const limit = MAX_CONCURRENT_ACTORS[opts.subagentType] ?? DEFAULT_MAX_CONCURRENT_ACTORS;
        const current = this.countActiveByType(opts.context.agentId, opts.subagentType);
        if (current >= limit) {
            throw new SubagentConcurrencyLimitError(
                opts.context.agentId,
                opts.subagentType,
                current,
                limit,
            );
        }

        const session = await this.sessionFactory({
            context: opts.context,
            subagentType: opts.subagentType,
            toolAllowlist: opts.toolAllowlist,
            customTools: opts.customTools,
            modelRef: opts.modelRef,
        });

        const subagent = new SubagentSession({
            session,
            actorId,
            agentId: opts.context.agentId,
            workspaceId: opts.context.workspaceId,
            subagentType: opts.subagentType,
            description: opts.description,
            timeoutMs,
            onStateChange: (snapshot: SubagentSessionSnapshot) => {
                this.handleStateChange(snapshot);
            },
        });

        // Register before kicking off run() so cancel/status during the first
        // event tick can observe the instance.
        this.registerSession(opts.context.agentId, subagent);
        this.emit({
            agentId: opts.context.agentId,
            actorId,
            type: "spawned",
            status: subagent.snapshot().status,
            subagentType: opts.subagentType,
            description: opts.description,
        });

        // Fire-and-forget run(); outcome Promise resolves on terminal state.
        // Errors are caught and converted to a `failed` SubagentResult so
        // awaiters always get a resolved Promise (no unhandled rejections).
        const outcome = subagent.run(opts.prompt).catch((err): SubagentResult => {
            const message = err instanceof Error ? err.message : String(err);
            const endedAt = this.now();
            const result: SubagentResult = {
                actorId,
                status: "failed",
                error: message,
                turnCount: subagent.snapshot().turnCount,
                startedAt: subagent.snapshot().createdAt,
                endedAt,
            };
            return result;
        });
        // When outcome settles, wake any waiters and update instance metadata.
        void outcome.then((result) => this.handleOutcome(actorId, result));

        return { actorId, outcome };
    }

    /**
     * Synchronous snapshot lookup. Returns `null` when `actorId` is unknown
     * or belongs to a different agent (workspace-scoped actor isolation).
     */
    status(agentId: string, actorId: string): SubagentInstance | null {
        const instance = this.instancesByActor.get(actorId);
        if (!instance || instance.agentId !== agentId) return null;
        return { ...instance };
    }

    /**
     * Await a subagent's terminal outcome. Returns `null` if the actor is
     * unknown or already terminal at call time and no fresh outcome is
     * available (defensive — should be rare since outcome Promise persists).
     *
     * `timeoutMs` (default 600_000ms = 10 min) caps the wait. On timeout the
     * returned value is `null`; the subagent keeps running (caller can `cancel`).
     */
    async wait(
        agentId: string,
        actorId: string,
        timeoutMs = 10 * 60 * 1000,
    ): Promise<SubagentResult | null> {
        const instance = this.instancesByActor.get(actorId);
        if (!instance || instance.agentId !== agentId) return null;
        const session = this.sessionsByAgent.get(agentId)?.get(actorId);
        if (!session) return null;

        // If the session is already terminal, return a synthetic snapshot from
        // the instance's lastOutcome so callers don't hang waiting for a
        // Promise that already resolved.
        if (isTerminalStatus(instance.status)) {
            return {
                actorId,
                status: outcomeStatusFromInstanceStatus(instance.status),
                lastAssistantText: undefined,
                error: instance.lastOutcome,
                turnCount: instance.turnCount,
                startedAt: instance.createdAt,
                endedAt: instance.terminatedAt ?? this.now(),
            };
        }

        return new Promise<SubagentResult | null>((resolve) => {
            const entry: { resolve: (r: SubagentResult | null) => void; timer?: NodeJS.Timeout } = {
                resolve,
            };
            entry.timer = setTimeout(() => {
                resolve(null);
            }, timeoutMs);
            const list = this.waitersByActor.get(actorId) ?? [];
            list.push(entry);
            this.waitersByActor.set(actorId, list);
        });
    }

    /**
     * Cancel a running subagent. Idempotent — no-op when already terminal or
     * when `actorId` belongs to a different agent. Returns the post-cancel
     * snapshot (or `null` when unknown).
     */
    cancel(agentId: string, actorId: string): SubagentInstance | null {
        const session = this.sessionsByAgent.get(agentId)?.get(actorId);
        if (!session) return null;
        session.cancel("graceful");
        return this.status(agentId, actorId);
    }

    /**
     * List all subagent instances for a given primary agent. Returns an empty
     * array when the agent is unknown or has no active actors.
     */
    listInstances(agentId: string): SubagentInstance[] {
        const inner = this.sessionsByAgent.get(agentId);
        if (!inner) return [];
        const result: SubagentInstance[] = [];
        for (const actorId of inner.keys()) {
            const instance = this.instancesByActor.get(actorId);
            if (instance) result.push({ ...instance });
        }
        return result;
    }

    /**
     * Dispose all subagents for a single primary agent. Used when the primary
     * agent is stopped (`AgentRuntimeRegistry.stop`). Cancels running actors
     * immediately (no grace period) and disposes their AgentSessions.
     */
    disposeAgent(agentId: string): void {
        const inner = this.sessionsByAgent.get(agentId);
        if (!inner) return;
        for (const [actorId, session] of inner) {
            session.cancel("forced");
            session.dispose();
            const instance = this.instancesByActor.get(actorId);
            if (instance && !isTerminalStatus(instance.status)) {
                this.markTerminated(actorId, "cancelled", "disposed");
            }
            this.emit({
                agentId,
                actorId,
                type: "terminated",
                status: "cancelled",
                lastOutcome: "disposed",
                subagentType: session.subagentType,
                description: session.description,
            });
        }
        this.sessionsByAgent.delete(agentId);
        for (const [actorId, agent] of this.agentByActor) {
            if (agent === agentId) {
                this.instancesByActor.delete(actorId);
                this.agentByActor.delete(actorId);
                this.clearWaiters(actorId, null);
            }
        }
    }

    /** Dispose everything (used on app shutdown). */
    disposeAll(): void {
        this.stop();
        for (const agentId of [...this.sessionsByAgent.keys()]) {
            this.disposeAgent(agentId);
        }
    }

    // ── internal helpers ──────────────────────────────────────────

    /**
     * Phase 3 Task 10 — count non-terminal actors of the given subagentType
     * currently registered for `agentId`. Used by `spawn` to enforce the
     * per-type concurrency cap. Terminal actors (cancelled/failed/timeout/idle)
     * don't count against the cap because they're either about to be GC'd or
     * already awaiting GC.
     */
    private countActiveByType(agentId: string, subagentType: SubagentTypeID): number {
        const inner = this.sessionsByAgent.get(agentId);
        if (!inner) return 0;
        let count = 0;
        for (const session of inner.values()) {
            if (session.subagentType !== subagentType) continue;
            const instance = this.instancesByActor.get(session.actorId);
            // If we have no instance metadata yet (just-registered session),
            // count it as active — it's in `pending`/`running` state.
            if (!instance || !isTerminalStatus(instance.status)) count++;
        }
        return count;
    }

    private registerSession(agentId: string, session: SubagentSession): void {
        let inner = this.sessionsByAgent.get(agentId);
        if (!inner) {
            inner = new Map();
            this.sessionsByAgent.set(agentId, inner);
        }
        inner.set(session.actorId, session);
        this.agentByActor.set(session.actorId, agentId);
        const snapshot = session.snapshot();
        this.instancesByActor.set(session.actorId, snapshotToInstance(snapshot));
    }

    private handleStateChange(snapshot: SubagentSessionSnapshot): void {
        const existing = this.instancesByActor.get(snapshot.actorId);
        if (!existing) return;
        const updated: SubagentInstance = {
            ...existing,
            status: snapshot.status,
            turnCount: snapshot.turnCount,
            lastTurnTime: snapshot.lastTurnTime,
            lastOutcome: snapshot.lastOutcome,
            terminatedAt: snapshot.terminatedAt,
        };
        this.instancesByActor.set(snapshot.actorId, updated);
        const type: SubagentManagerEvent["type"] =
            snapshot.status === "running" ? "running" : "terminated";
        this.emit({
            agentId: snapshot.agentId,
            actorId: snapshot.actorId,
            type,
            status: snapshot.status,
            lastOutcome: snapshot.lastOutcome,
            subagentType: snapshot.subagentType,
            description: snapshot.description,
        });
    }

    private handleOutcome(actorId: string, result: SubagentResult): void {
        const instance = this.instancesByActor.get(actorId);
        if (!instance) return;
        const status: SubagentStatus = result.status === "success" ? "idle" : result.status;
        this.instancesByActor.set(actorId, {
            ...instance,
            status,
            lastOutcome: result.status === "success"
                ? "success"
                : result.status === "failed"
                    ? `failed: ${result.error ?? "unknown error"}`
                    : result.status,
            terminatedAt: result.endedAt,
        });
        this.clearWaiters(actorId, result);
    }

    private markTerminated(
        actorId: string,
        status: SubagentStatus,
        reason: string,
    ): void {
        const instance = this.instancesByActor.get(actorId);
        if (!instance) return;
        this.instancesByActor.set(actorId, {
            ...instance,
            status,
            lastOutcome: reason,
            terminatedAt: this.now(),
        });
    }

    private clearWaiters(actorId: string, result: SubagentResult | null): void {
        const list = this.waitersByActor.get(actorId);
        if (!list) return;
        for (const entry of list) {
            if (entry.timer) clearTimeout(entry.timer);
            entry.resolve(result);
        }
        this.waitersByActor.delete(actorId);
    }

    private runGcSweep(): void {
        const now = this.now();
        for (const [actorId, instance] of this.instancesByActor) {
            if (instance.status !== "idle") continue;
            const lastActivity = instance.lastTurnTime ?? instance.createdAt;
            if (now - lastActivity < IDLE_GRACE_MS) continue;
            const agentId = this.agentByActor.get(actorId);
            if (!agentId) continue;
            const session = this.sessionsByAgent.get(agentId)?.get(actorId);
            if (session) {
                session.dispose();
                this.sessionsByAgent.get(agentId)?.delete(actorId);
            }
            this.instancesByActor.delete(actorId);
            this.agentByActor.delete(actorId);
            this.emit({
                agentId,
                actorId,
                type: "gc_collected",
                status: "idle",
                lastOutcome: "gc_collected",
                subagentType: instance.subagentType,
                description: instance.description,
            });
        }
    }

    private emit(event: SubagentManagerEvent): void {
        try {
            this.onEvent?.(event);
        } catch {
            // Listener failures are non-fatal; never let them propagate.
        }
    }
}

// ── helpers ──────────────────────────────────────────────────────

function makeActorId(type: SubagentTypeID): string {
    const short = randomUUID().replace(/-/g, "").slice(0, 6);
    return `${type}-${short}`;
}

function snapshotToInstance(snapshot: SubagentSessionSnapshot): SubagentInstance {
    return {
        actorId: snapshot.actorId,
        agentId: snapshot.agentId,
        workspaceId: snapshot.workspaceId,
        subagentType: snapshot.subagentType,
        description: snapshot.description,
        status: snapshot.status,
        turnCount: snapshot.turnCount,
        createdAt: snapshot.createdAt,
        lastTurnTime: snapshot.lastTurnTime,
        lastOutcome: snapshot.lastOutcome,
        terminatedAt: snapshot.terminatedAt,
    };
}

function isTerminalStatus(status: SubagentStatus): boolean {
    return (
        status === "cancelled"
        || status === "failed"
        || status === "timeout"
        || status === "idle"
    );
}

function outcomeStatusFromInstanceStatus(status: SubagentStatus): SubagentResult["status"] {
    if (status === "idle") return "success";
    if (status === "cancelled") return "cancelled";
    if (status === "timeout") return "timeout";
    return "failed";
}
