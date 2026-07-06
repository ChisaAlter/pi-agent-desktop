import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LongHorizonSettings, Workspace } from "@shared";
import { AutoScheduler, MIN_SPAWN_GAP_MS } from "../auto-scheduler";
import type { SubagentManager, SubagentSpawnResult } from "../manager";

// ── Test fixtures ───────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 10 * DAY_MS; // 10d after epoch — comfortably past dream's 7d default

function createWorkspace(id: string): Workspace {
    return { id, name: id, path: `/tmp/${id}`, createdAt: 0, lastActiveAt: NOW };
}

function longHorizonOn(overrides: Partial<LongHorizonSettings> = {}): LongHorizonSettings {
    return {
        enabled: true,
        defaultMode: "build",
        planMode: { enabled: true },
        composeMode: { enabled: true },
        maxMode: { enabled: true, candidates: 5 },
        memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
        history: { enabled: true },
        checkpoint: { enabled: true },
        goal: { enabled: true },
        subagents: { enabled: true },
        task: { enabled: true },
        actor: { enabled: true },
        workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
        dream: { enabled: true, intervalDays: 7, auto: true },
        distill: { enabled: true, intervalDays: 30, auto: true },
        composeWorkflow: { enabled: true },
        ...overrides,
    };
}

function createMockManager(runningCount = 0): {
    manager: SubagentManager;
    listInstances: ReturnType<typeof vi.fn>;
} {
    const listInstances = vi.fn(() => Array.from({ length: runningCount }, () => ({})));
    const manager = {
        listInstances,
        spawn: vi.fn(),
        status: vi.fn(),
        wait: vi.fn(),
        cancel: vi.fn(),
        disposeAgent: vi.fn(),
        disposeAll: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
    } as unknown as SubagentManager;
    return { manager, listInstances };
}

function createSpawnResult(): SubagentSpawnResult {
    return {
        actorId: "dream-abc123",
        outcome: Promise.resolve({
            actorId: "dream-abc123",
            status: "success",
            lastAssistantText: "Consolidated: 2",
            turnCount: 1,
            startedAt: 0,
            endedAt: NOW,
        }),
    };
}

interface Harness {
    scheduler: AutoScheduler;
    spawn: ReturnType<typeof vi.fn>;
    getLastRunAt: ReturnType<typeof vi.fn>;
    setLastRunAt: ReturnType<typeof vi.fn>;
    getAgentForWorkspace: ReturnType<typeof vi.fn>;
    getLongHorizonSettings: ReturnType<typeof vi.fn>;
}

function createHarness(opts: {
    workspaces?: Workspace[];
    longHorizon?: LongHorizonSettings;
    lastDreamRunAt?: number;
    lastDistillRunAt?: number;
    agentStatus?: "idle" | "running" | "starting" | "error" | "closed";
    agentUpdatedAt?: number;
    runningSubagents?: number;
    now?: () => number;
} = {}): Harness {
    const workspaces = opts.workspaces ?? [createWorkspace("ws1")];
    const longHorizon = opts.longHorizon ?? longHorizonOn();
    const agentStatus = opts.agentStatus ?? "idle";
    const agentUpdatedAt = opts.agentUpdatedAt ?? 0;
    const runningSubagents = opts.runningSubagents ?? 0;

    const { manager } = createMockManager(runningSubagents);

    const spawn = vi.fn(async (): Promise<SubagentSpawnResult> => createSpawnResult());
    const getLastRunAt = vi.fn((workspaceId: string, type: string) => {
        if (type === "dream") return opts.lastDreamRunAt;
        if (type === "distill") return opts.lastDistillRunAt;
        return undefined;
    });
    const setLastRunAt = vi.fn();
    const getAgentForWorkspace = vi.fn(() => ({
        id: "agent1",
        workspaceId: workspaces[0]?.id ?? "ws1",
        title: "ws agent",
        status: agentStatus,
        createdAt: 0,
        updatedAt: agentUpdatedAt,
    }));
    const getLongHorizonSettings = vi.fn(() => longHorizon);

    const scheduler = new AutoScheduler({
        subagentManager: manager,
        getWorkspaces: () => workspaces,
        getAgentForWorkspace,
        getLongHorizonSettings,
        spawn,
        getLastRunAt,
        setLastRunAt,
        now: opts.now ?? (() => NOW),
        tickIntervalMs: 1000,
        idleThresholdMs: 0,
    });

    return { scheduler, spawn, getLastRunAt, setLastRunAt, getAgentForWorkspace, getLongHorizonSettings };
}

// ── Tests ───────────────────────────────────────────────────────

describe("AutoScheduler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("shouldSpawn", () => {
        it("returns true when auto=true and interval elapsed", () => {
            const h = createHarness({ lastDreamRunAt: 0 });
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(true);
        });

        it("returns false when interval not yet elapsed", () => {
            const h = createHarness({ lastDreamRunAt: NOW - 3 * DAY_MS }); // 3d ago, interval=7d
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(false);
        });

        it("returns false when auto is not explicitly true", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ dream: { enabled: true, intervalDays: 7, auto: false } }),
            });
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(false);
        });

        it("returns false when dream.enabled is false even if auto=true", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ dream: { enabled: false, intervalDays: 7, auto: true } }),
            });
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(false);
        });

        it("returns false when longHorizon.enabled is false", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ enabled: false }),
            });
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(false);
        });

        it("returns false when subagents.enabled is false", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ subagents: { enabled: false } }),
            });
            expect(h.scheduler.shouldSpawn("ws1", "dream", NOW)).toBe(false);
        });

        it("uses default distill interval (30d) when intervalDays is undefined", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({
                    distill: { enabled: true, auto: true }, // intervalDays omitted
                }),
                lastDistillRunAt: NOW - 15 * DAY_MS, // 15d ago, less than 30d
            });
            expect(h.scheduler.shouldSpawn("ws1", "distill", NOW)).toBe(false);
        });

        it("honors explicit intervalDays override", () => {
            const h = createHarness({
                longHorizon: longHorizonOn({
                    distill: { enabled: true, intervalDays: 14, auto: true },
                }),
                lastDistillRunAt: NOW - 15 * DAY_MS, // 15d ago, more than 14d
            });
            expect(h.scheduler.shouldSpawn("ws1", "distill", NOW)).toBe(true);
        });
    });

    describe("tick", () => {
        it("spawns dream when agent is idle and interval elapsed", async () => {
            const h = createHarness({ lastDreamRunAt: 0 });
            await h.scheduler.tick();
            expect(h.spawn).toHaveBeenCalledWith({
                workspaceId: "ws1",
                agentId: "agent1",
                subagentType: "dream",
            });
        });

        it("does not spawn when agent is running (not idle)", async () => {
            const h = createHarness({ agentStatus: "running" });
            await h.scheduler.tick();
            expect(h.spawn).not.toHaveBeenCalled();
        });

        it("does not spawn when subagent is already running for the agent", async () => {
            const h = createHarness({ runningSubagents: 1 });
            await h.scheduler.tick();
            expect(h.spawn).not.toHaveBeenCalled();
        });

        it("does not spawn when dream.auto is false", async () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ dream: { enabled: true, intervalDays: 7, auto: false } }),
            });
            await h.scheduler.tick();
            expect(h.spawn).not.toHaveBeenCalled();
        });

        it("persists lastRunAt after spawn outcome settles", async () => {
            const h = createHarness({ lastDreamRunAt: 0 });
            await h.scheduler.tick();
            // Outcome is pre-resolved in the fixture, so the .then() handler runs
            // on a microtask. Wait one tick.
            await Promise.resolve();
            expect(h.setLastRunAt).toHaveBeenCalledWith("ws1", "dream", expect.any(Number));
        });

        it("does not spawn dream twice in the same tick", async () => {
            const h = createHarness({ lastDreamRunAt: 0 });
            await h.scheduler.tick();
            await h.scheduler.tick(); // second tick — should not spawn again (lastRunAt advanced)
            // First call's outcome was already settled, so setLastRunAt was invoked,
            // which means subsequent ticks should not trigger another spawn.
            expect(h.spawn).toHaveBeenCalledTimes(1);
        });

        it("respects MIN_SPAWN_GAP_MS throttle across workspaces", async () => {
            const ws1 = createWorkspace("ws1");
            const ws2 = createWorkspace("ws2");
            const h = createHarness({
                workspaces: [ws1, ws2],
                lastDreamRunAt: 0,
            });
            await h.scheduler.tick();
            // Only one workspace's spawn should fire; the second is blocked by
            // MIN_SPAWN_GAP_MS since both happen "now".
            expect(h.spawn).toHaveBeenCalledTimes(1);
        });

        it("skips workspace when longHorizon is disabled", async () => {
            const h = createHarness({
                longHorizon: longHorizonOn({ enabled: false }),
            });
            await h.scheduler.tick();
            expect(h.spawn).not.toHaveBeenCalled();
        });

        it("skips workspace with no primary agent", async () => {
            const h = createHarness();
            h.getAgentForWorkspace.mockReturnValue(undefined);
            await h.scheduler.tick();
            expect(h.spawn).not.toHaveBeenCalled();
        });

        it("skips distill when dream already spawned in this tick", async () => {
            const h = createHarness({
                lastDreamRunAt: 0,
                lastDistillRunAt: 0,
            });
            await h.scheduler.tick();
            // dream fires first; distill is skipped (one spawn per tick per workspace)
            expect(h.spawn).toHaveBeenCalledTimes(1);
            expect(h.spawn).toHaveBeenCalledWith(
                expect.objectContaining({ subagentType: "dream" }),
            );
        });

        it("tries distill when dream is not due", async () => {
            // distill interval defaults to 30d. Bump the distill interval
            // to 1d so it fires given `lastDistillRunAt = 0` and NOW=10d,
            // while dream's `lastDreamRunAt = NOW - 1d` keeps dream not due.
            const h = createHarness({
                longHorizon: longHorizonOn({
                    dream: { enabled: true, intervalDays: 7, auto: true },
                    distill: { enabled: true, intervalDays: 1, auto: true },
                }),
                lastDreamRunAt: NOW - DAY_MS, // 1d ago — dream not due (7d interval)
                lastDistillRunAt: 0, // never — distill due (1d interval)
            });
            await h.scheduler.tick();
            expect(h.spawn).toHaveBeenCalledWith(
                expect.objectContaining({ subagentType: "distill" }),
            );
        });
    });

    describe("lifecycle", () => {
        it("start() and stop() are idempotent", () => {
            const h = createHarness();
            expect(() => {
                h.scheduler.start();
                h.scheduler.start();
                h.scheduler.stop();
                h.scheduler.stop();
                h.scheduler.start();
            }).not.toThrow();
        });
    });

    describe("MIN_SPAWN_GAP_MS", () => {
        it("matches spec value of 10 seconds", () => {
            expect(MIN_SPAWN_GAP_MS).toBe(10_000);
        });
    });
});
