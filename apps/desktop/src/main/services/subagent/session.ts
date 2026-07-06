import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubagentResult, SubagentStatus, SubagentTypeID } from "@shared";

/**
 * SubagentSession — Phase E Task 1.
 *
 * Wraps a single independent `AgentSession` (created via `createWorkspaceSession`)
 * together with its lifecycle state machine, abort controller, and the
 * `Promise<SubagentResult>` consumed by `SubagentManager.spawn`.
 *
 * State machine:
 *   pending → running → idle (success path; subagent awaits GC) /
 *                       failed (exception) /
 *                       cancelled (abort) /
 *                       timeout (exceeded `timeout_ms`)
 *
 * The `idle` state indicates the conversation loop completed successfully but
 * the underlying `AgentSession` has NOT been disposed yet (60s grace period
 * so the main agent can resume via `actor wait` / read `lastAssistantText`).
 *
 * `SubagentResult.status` is "success" on the idle transition; SubagentInstance
 * reports "idle" so callers can tell apart "running" vs "done but not GC'd".
 */
export interface SubagentSessionOpts {
    session: AgentSession;
    actorId: string;
    agentId: string;
    workspaceId: string;
    subagentType: SubagentTypeID;
    description: string;
    timeoutMs: number;
    /** Optional sink for state-change broadcasts (SubagentManager wires this). */
    onStateChange?: (snapshot: SubagentSessionSnapshot) => void;
}

export interface SubagentSessionSnapshot {
    actorId: string;
    agentId: string;
    workspaceId: string;
    subagentType: SubagentTypeID;
    description: string;
    status: SubagentStatus;
    turnCount: number;
    createdAt: number;
    lastTurnTime?: number;
    lastOutcome?: string;
    terminatedAt?: number;
}

const TERMINAL_OUTCOMES: ReadonlySet<SubagentStatus> = new Set([
    "cancelled",
    "failed",
    "timeout",
]);

export class SubagentSession {
    readonly actorId: string;
    readonly agentId: string;
    readonly workspaceId: string;
    readonly subagentType: SubagentTypeID;
    readonly description: string;
    readonly createdAt: number;

    private readonly session: AgentSession;
    private readonly timeoutMs: number;
    private readonly abortController: AbortController;
    private readonly onStateChange?: (snapshot: SubagentSessionSnapshot) => void;

    private status: SubagentStatus = "pending";
    private timedOut = false;
    private turnCount = 0;
    private lastTurnTime: number | undefined;
    private lastOutcome: string | undefined;
    private terminatedAt: number | undefined;

    private unsubscribe?: () => void;
    private timeoutHandle?: NodeJS.Timeout;
    private outcomeResolve?: (result: SubagentResult) => void;
    private readonly outcomePromise: Promise<SubagentResult>;

    constructor(opts: SubagentSessionOpts) {
        this.session = opts.session;
        this.actorId = opts.actorId;
        this.agentId = opts.agentId;
        this.workspaceId = opts.workspaceId;
        this.subagentType = opts.subagentType;
        this.description = opts.description;
        this.timeoutMs = opts.timeoutMs;
        this.createdAt = Date.now();
        this.abortController = new AbortController();
        this.onStateChange = opts.onStateChange;
        this.outcomePromise = new Promise<SubagentResult>((resolve) => {
            this.outcomeResolve = resolve;
        });
    }

    /** Snapshot for IPC / event broadcast. Caller MUST NOT mutate. */
    snapshot(): SubagentSessionSnapshot {
        return {
            actorId: this.actorId,
            agentId: this.agentId,
            workspaceId: this.workspaceId,
            subagentType: this.subagentType,
            description: this.description,
            status: this.status,
            turnCount: this.turnCount,
            createdAt: this.createdAt,
            lastTurnTime: this.lastTurnTime,
            lastOutcome: this.lastOutcome,
            terminatedAt: this.terminatedAt,
        };
    }

    /** The subagent's terminal outcome. Resolves on success / failure / cancel / timeout. */
    get outcome(): Promise<SubagentResult> {
        return this.outcomePromise;
    }

    /** Whether the subagent is still capable of running (not in a terminal state). */
    isAlive(): boolean {
        return this.status !== "cancelled"
            && this.status !== "failed"
            && this.status !== "timeout"
            && this.status !== "idle";
    }

    /**
     * Run the subagent's conversation loop to completion.
     *
     *  - Subscribes to the AgentSession's event stream to track `turn_end`
     *    (incrementing `turnCount` and updating `lastTurnTime`).
     *  - Arms a `setTimeout` for `timeoutMs`; on expiry the session is cancelled
     *    with status `"timeout"`.
     *  - On success the subagent transitions to `idle` and resolves `outcome`
     *    with `{ status: "success", lastAssistantText }`.
     *  - On exception the subagent transitions to `failed` and rejects `outcome`
     *    (the rejection is caught by `SubagentManager.spawn` and converted to a
     *    `failed` SubagentResult so callers always see a resolved Promise).
     *
     * Must be called at most once per instance.
     */
    async run(prompt: string): Promise<SubagentResult> {
        if (this.status !== "pending") {
            throw new Error(
                `SubagentSession.run() called in non-pending state: ${this.status}`,
            );
        }
        this.armTimeout();
        this.unsubscribe = this.session.subscribe((event) => {
            this.handleEvent(event);
        });
        this.setStatus("running");
        try {
            await this.session.prompt(prompt);
            // success path — capture last assistant text and resolve.
            const lastAssistantText = safeGetLastAssistantText(this.session);
            const endedAt = Date.now();
            this.lastOutcome = "success";
            this.terminatedAt = endedAt;
            // Transition to idle so GC sweep can reclaim after grace period.
            this.setStatus("idle");
            const result: SubagentResult = {
                actorId: this.actorId,
                status: "success",
                lastAssistantText,
                turnCount: this.turnCount,
                startedAt: this.createdAt,
                endedAt,
            };
            this.outcomeResolve?.(result);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const endedAt = Date.now();
            // If the abort signal fired, the run was cancelled rather than failed.
            // Use the explicit `timedOut` flag — TS control-flow analysis cannot
            // track `markTimeout()` mutating `this.status` through the method call,
            // so reading `this.status` here would be narrowed back to "pending".
            const status: SubagentResult["status"] = this.timedOut
                ? "timeout"
                : this.abortController.signal.aborted
                    ? "cancelled"
                    : "failed";
            this.lastOutcome = status === "timeout"
                ? `timeout after ${this.timeoutMs}ms`
                : status === "cancelled"
                    ? "cancelled"
                    : `failed: ${message}`;
            this.terminatedAt = endedAt;
            if (status === "timeout") {
                this.setStatus("timeout");
            } else if (status === "cancelled") {
                this.setStatus("cancelled");
            } else {
                this.setStatus("failed");
            }
            const result: SubagentResult = {
                actorId: this.actorId,
                status,
                error: status === "failed" ? message : undefined,
                turnCount: this.turnCount,
                startedAt: this.createdAt,
                endedAt,
            };
            this.outcomeResolve?.(result);
            return result;
        } finally {
            this.clearTimeout();
            this.detachSubscription();
        }
    }

    /**
     * Cancel the subagent. Idempotent — no-op when already terminal.
     *
     *  - `graceful`: calls `session.abort()` and lets the conversation loop
     *    drain naturally; the in-flight `run()` will resolve with status
     *    `cancelled` once the SDK's abort promise settles.
     *  - `forced`: same as graceful in this SDK (Pi CLI has no force-kill
     *    distinct from abort), but signals intent for future extension.
     */
    cancel(reason: "graceful" | "forced" = "graceful"): void {
        if (this.isTerminal()) return;
        this.abortController.abort(reason);
        // Pi CLI's AgentSession.abort() returns a Promise that resolves when the
        // agent becomes idle. We fire-and-forget — the in-flight prompt() will
        // settle and run()'s catch block maps the outcome.
        void this.session.abort().catch(() => {
            // Swallow: abort failures surface via the run() catch path.
        });
    }

    /** Force the session into timeout terminal state (used internally by run()). */
    markTimeout(): void {
        if (this.isTerminal()) return;
        this.timedOut = true;
        this.status = "timeout";
        this.abortController.abort("timeout");
        void this.session.abort().catch(() => undefined);
    }

    /**
     * Dispose the underlying AgentSession and detach subscriptions.
     * Safe to call multiple times. After dispose, the instance is unusable.
     */
    dispose(): void {
        this.detachSubscription();
        this.clearTimeout();
        try {
            this.session.dispose();
        } catch {
            // Ignore — dispose failures are non-fatal; we're tearing down anyway.
        }
    }

    private isTerminal(): boolean {
        return TERMINAL_OUTCOMES.has(this.status) || this.status === "idle";
    }

    private armTimeout(): void {
        if (this.timeoutMs <= 0) return;
        this.timeoutHandle = setTimeout(() => {
            this.markTimeout();
        }, this.timeoutMs);
    }

    private clearTimeout(): void {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
    }

    private detachSubscription(): void {
        if (this.unsubscribe) {
            try {
                this.unsubscribe();
            } catch {
                // Ignore — listener detach failures are non-fatal.
            }
            this.unsubscribe = undefined;
        }
    }

    private handleEvent(event: unknown): void {
        if (!event || typeof event !== "object") return;
        const type = (event as { type?: unknown }).type;
        if (type === "turn_end") {
            this.turnCount += 1;
            this.lastTurnTime = Date.now();
            this.emitSnapshot();
        }
    }

    private setStatus(next: SubagentStatus): void {
        if (this.status === next) return;
        this.status = next;
        this.emitSnapshot();
    }

    private emitSnapshot(): void {
        this.onStateChange?.(this.snapshot());
    }
}

function safeGetLastAssistantText(session: AgentSession): string | undefined {
    try {
        const text = session.getLastAssistantText();
        return text && text.length > 0 ? text : undefined;
    } catch {
        return undefined;
    }
}
