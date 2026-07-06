import type { AgentTab, LongHorizonSettings, SubagentResult, Workspace } from "@shared";
import type { SubagentManager, SubagentSpawnResult } from "./manager";

/**
 * AutoScheduler — Phase E Task 5 SubTask 5.4-5.7.
 *
 * Periodically (default 60s) checks every workspace and, when the primary
 * agent is idle (status `"idle"`), no subagent is running for that agent,
 * and the configured interval has elapsed since the last run, spawns the
 * `dream` or `distill` subagent.
 *
 * State machine per (workspaceId, subagentType):
 *
 *     idle ── tick ──► shouldAutoX()? ──yes──► spawnX() ──► record lastRunAt
 *                       │no                                │
 *                       └──► wait next tick                ▼
 *                                              (next tick: just-running actors
 *                                               block the gate until terminal)
 *
 * Design notes:
 *  - The scheduler is intentionally conservative: any non-idle primary agent
 *    (running / starting / error / closed) or any in-flight subagent blocks
 *    the spawn. We rely on `SubagentManager.listInstances()` for the latter.
 *  - `MIN_SPAWN_GAP_MS = 10_000` (matching MiMo Code `auto-dream.ts:109-127`)
 *    guards against double-spawn within the same tick window.
 *  - The spawn itself is delegated to a caller-provided callback so this
 *    module doesn't need to know how to build the custom toolset per type.
 *  - `lastRunAt` is read/written via injected callbacks so callers can back
 *    it with `electron-store` (Pi Desktop) or in-memory state (tests).
 *  - `now()` is overridable for deterministic tests.
 */

/** Minimum gap between auto-spawns of the same subagent type. */
export const MIN_SPAWN_GAP_MS = 10_000;

/** Default tick interval. Mirrors `SubagentManager`'s GC sweep cadence. */
const DEFAULT_TICK_MS = 60 * 1000;

/** Agent must be idle for this long before a spawn triggers (avoids flicker). */
const DEFAULT_IDLE_THRESHOLD_MS = 30 * 1000;

/** Interval-day defaults per spec.md "Auto-Dream / Auto-Distill Scheduler". */
const DEFAULT_DREAM_INTERVAL_DAYS = 7;
const DEFAULT_DISTILL_INTERVAL_DAYS = 30;

/**
 * The scheduler only ever spawns `dream` or `distill` (per spec.md
 * "Auto-Dream / Auto-Distill Scheduler"). `general` / `explore` are reserved
 * for manual `actor` invocations from the primary agent and are never
 * scheduled.
 */
export type ScheduledSubagentType = "dream" | "distill";

/** Spawn callback invoked when the scheduler decides to fire. */
export type SpawnHandler = (input: {
    workspaceId: string;
    agentId: string;
    subagentType: ScheduledSubagentType;
}) => Promise<SubagentSpawnResult>;

/** Idle-state observer. Returns the agent's status, or `undefined` if unknown. */
export type AgentStatusLookup = (workspaceId: string) => AgentTab | undefined;

export interface AutoSchedulerOpts {
    subagentManager: SubagentManager;
    /** Lists workspaces to consider for scheduling. */
    getWorkspaces: () => Workspace[];
    /** Returns the primary agent tab for a workspace (used for idle gate). */
    getAgentForWorkspace: AgentStatusLookup;
    /** Returns the active long-horizon settings (already normalized). */
    getLongHorizonSettings: (workspaceId: string) => LongHorizonSettings | undefined;
    /** Spawns the subagent. Rejects on failure (caught internally). */
    spawn: SpawnHandler;
    /** Read the last successful run epoch-ms for `(workspaceId, type)`. */
    getLastRunAt: (workspaceId: string, type: ScheduledSubagentType) => number | undefined;
    /** Persist the last successful run epoch-ms for `(workspaceId, type)`. */
    setLastRunAt: (workspaceId: string, type: ScheduledSubagentType, ts: number) => void;
    /** Override for tests; defaults to `Date.now`. */
    now?: () => number;
    /** Override tick interval for tests. */
    tickIntervalMs?: number;
    /** Override idle threshold for tests. */
    idleThresholdMs?: number;
}

interface ScheduledActor {
    actorId: string;
    subagentType: ScheduledSubagentType;
    workspaceId: string;
    startedAt: number;
    /** Resolves when the subagent reaches a terminal state. */
    outcome: Promise<SubagentResult>;
}

export class AutoScheduler {
    private readonly opts: Required<Omit<AutoSchedulerOpts, "spawn">> & { spawn: SpawnHandler };
    private handle?: NodeJS.Timeout;
    /** Tracks in-flight scheduled spawns to gate concurrent runs. */
    private readonly inFlight = new Map<string, ScheduledActor>();
    /**
     * Latest spawn timestamp per subagent type. Set synchronously when
     * `spawn()` resolves, persisted across outcome settlement so the
     * `MIN_SPAWN_GAP_MS` throttle keeps working even when the outcome
     * Promise resolves on the same microtask as the spawn call (which
     * would otherwise clear `inFlight` before the next workspace is
     * iterated in the same tick).
     */
    private readonly lastSpawnedAt = new Map<ScheduledSubagentType, number>();

    constructor(opts: AutoSchedulerOpts) {
        this.opts = {
            subagentManager: opts.subagentManager,
            getWorkspaces: opts.getWorkspaces,
            getAgentForWorkspace: opts.getAgentForWorkspace,
            getLongHorizonSettings: opts.getLongHorizonSettings,
            spawn: opts.spawn,
            getLastRunAt: opts.getLastRunAt,
            setLastRunAt: opts.setLastRunAt,
            now: opts.now ?? Date.now,
            tickIntervalMs: opts.tickIntervalMs ?? DEFAULT_TICK_MS,
            idleThresholdMs: opts.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS,
        };
    }

    /** Start the periodic sweep. Idempotent. */
    start(): void {
        if (this.handle) return;
        this.handle = setInterval(() => {
            void this.tick().catch(() => {
                // Errors are swallowed — the next tick will retry.
            });
        }, this.opts.tickIntervalMs);
        if (this.handle.unref) this.handle.unref();
    }

    /** Stop the periodic sweep. Safe to call when not started. */
    stop(): void {
        if (this.handle) {
            clearInterval(this.handle);
            this.handle = undefined;
        }
    }

    /**
     * Single scheduling pass. Public for tests.
     *
     * For every workspace whose primary agent is idle and has no in-flight
     * scheduled actor, evaluates `dream` then `distill` and spawns the first
     * one that qualifies.
     */
    async tick(): Promise<void> {
        const now = this.opts.now();
        const workspaces = this.opts.getWorkspaces();
        for (const ws of workspaces) {
            const longHorizon = this.opts.getLongHorizonSettings(ws.id);
            if (!longHorizon || !longHorizon.enabled || !longHorizon.subagents.enabled) continue;
            const agent = this.opts.getAgentForWorkspace(ws.id);
            if (!agent || agent.status !== "idle") continue;
            if (this.hasInFlightScheduled(ws.id)) continue;
            if (this.hasRunningSubagent(agent.id)) continue;
            if (agent.updatedAt && now - agent.updatedAt < this.opts.idleThresholdMs) continue;

            // dream first (more frequent), then distill.
            if (this.shouldSpawn(ws.id, "dream", now)) {
                await this.spawnAndTrack(ws.id, agent.id, "dream", now);
                continue; // one spawn per tick per workspace
            }
            if (this.shouldSpawn(ws.id, "distill", now)) {
                await this.spawnAndTrack(ws.id, agent.id, "distill", now);
            }
        }
    }

    /**
     * Decides whether the given subagent type should auto-spawn now.
     * Public for unit testing.
     */
    shouldSpawn(workspaceId: string, type: ScheduledSubagentType, now: number): boolean {
        const longHorizon = this.opts.getLongHorizonSettings(workspaceId);
        if (!longHorizon || !longHorizon.enabled || !longHorizon.subagents.enabled) return false;
        const cfg = type === "dream" ? longHorizon.dream : longHorizon.distill;
        if (cfg.enabled === false) return false;
        if (cfg.auto !== true) return false;
        const intervalDays = type === "dream"
            ? (cfg.intervalDays ?? DEFAULT_DREAM_INTERVAL_DAYS)
            : (cfg.intervalDays ?? DEFAULT_DISTILL_INTERVAL_DAYS);
        const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
        const last = this.opts.getLastRunAt(workspaceId, type) ?? 0;
        if (now - last < intervalMs) return false;
        // Throttle: never spawn twice within MIN_SPAWN_GAP_MS of the last
        // spawn of the same type, regardless of which workspace.
        const lastScheduled = this.lastScheduledAt(type);
        if (lastScheduled !== undefined && now - lastScheduled < MIN_SPAWN_GAP_MS) return false;
        return true;
    }

    private lastScheduledAt(type: ScheduledSubagentType): number | undefined {
        let latest: number | undefined;
        for (const actor of this.inFlight.values()) {
            if (actor.subagentType !== type) continue;
            if (latest === undefined || actor.startedAt > latest) latest = actor.startedAt;
        }
        const persisted = this.lastSpawnedAt.get(type);
        if (persisted !== undefined) {
            if (latest === undefined || persisted > latest) latest = persisted;
        }
        return latest;
    }

    private hasInFlightScheduled(workspaceId: string): boolean {
        for (const actor of this.inFlight.values()) {
            if (actor.workspaceId === workspaceId) return true;
        }
        return false;
    }

    private hasRunningSubagent(agentId: string): boolean {
        return this.opts.subagentManager.listInstances(agentId).length > 0;
    }

    private async spawnAndTrack(
        workspaceId: string,
        agentId: string,
        type: ScheduledSubagentType,
        now: number,
    ): Promise<void> {
        const key = `${workspaceId}:${type}`;
        try {
            const result = await this.opts.spawn({ workspaceId, agentId, subagentType: type });
            // Record spawn time synchronously — survives outcome settlement
            // so the MIN_SPAWN_GAP_MS throttle keeps working across
            // iterations within the same tick.
            this.lastSpawnedAt.set(type, now);
            const actor: ScheduledActor = {
                actorId: result.actorId,
                subagentType: type,
                workspaceId,
                startedAt: now,
                outcome: result.outcome,
            };
            this.inFlight.set(key, actor);
            void result.outcome.then(() => {
                this.inFlight.delete(key);
                this.opts.setLastRunAt(workspaceId, type, this.opts.now());
            }).catch(() => {
                this.inFlight.delete(key);
                // On failure we still advance lastRunAt to avoid retry storms;
                // callers can manually re-trigger via /dream if needed.
                this.opts.setLastRunAt(workspaceId, type, this.opts.now());
            });
        } catch {
            // spawn failed — leave lastRunAt alone so next tick can retry.
        }
    }
}
