import { describe, expect, it, vi } from "vitest";
import { HerdrRpcRequestError } from "../rpc-client";
import {
    HerdrStateBridge,
    type HerdrBridgeRpcClient,
    type HerdrBridgeSubscription,
    type HerdrBridgeSubscriptionEvent,
    type HerdrStateBridgeTimers,
    type HerdrStateBridgeSupervisor,
} from "../state-bridge";

interface RecordedRequest {
    method: string;
    params: unknown;
    timeoutMs: number | undefined;
}

class FakeSubscription implements HerdrBridgeSubscription {
    readonly unsubscribe = vi.fn(() => this.close(null));
    readonly closed: Promise<Error | null>;
    private resolveClosed: (reason: Error | null) => void = () => undefined;
    private settled = false;

    constructor() {
        this.closed = new Promise((resolve) => {
            this.resolveClosed = resolve;
        });
    }

    close(reason: Error | null): void {
        if (this.settled) return;
        this.settled = true;
        this.resolveClosed(reason);
    }
}

class FakeClient implements HerdrBridgeRpcClient {
    readonly requests: RecordedRequest[] = [];
    readonly subscriptionParams: unknown[] = [];
    readonly subscriptions: FakeSubscription[] = [];
    readonly dispose = vi.fn();
    private readonly listeners: Array<(event: HerdrBridgeSubscriptionEvent) => void> = [];
    private readonly snapshotResponses: unknown[] = [];
    private readonly methodResponses = new Map<string, unknown>();

    queueSnapshot(snapshot: unknown): void {
        this.snapshotResponses.push(snapshot);
    }

    queueSnapshotFailure(error: Error): void {
        this.snapshotResponses.push(error);
    }

    respondTo(method: string, response: unknown): void {
        this.methodResponses.set(method, response);
    }

    async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
        this.requests.push({ method, params, timeoutMs });
        if (method === "session.snapshot") {
            const response = this.snapshotResponses.shift();
            if (response instanceof Error) throw response;
            if (response === undefined) throw new Error("No fake snapshot queued");
            return response as T;
        }
        const response = this.methodResponses.get(method) ?? { type: "ok" };
        if (response instanceof Error) throw response;
        return response as T;
    }

    async subscribe(
        params: unknown,
        listener: (event: HerdrBridgeSubscriptionEvent) => void,
    ): Promise<HerdrBridgeSubscription> {
        this.subscriptionParams.push(params);
        this.listeners.push(listener);
        const subscription = new FakeSubscription();
        this.subscriptions.push(subscription);
        return subscription;
    }

    emit(index: number, event: string, data: unknown): void {
        const listener = this.listeners[index];
        if (!listener) throw new Error(`Missing subscription listener ${index}`);
        listener({ event, data });
    }
}

interface TimerEntry {
    callback: () => void;
    active: boolean;
}

class ManualTimers implements HerdrStateBridgeTimers {
    readonly timeoutDelays: number[] = [];
    readonly sleepDelays: number[] = [];
    private readonly timeouts: TimerEntry[] = [];
    private readonly sleepers: Array<() => void> = [];

    setTimeout(callback: () => void, delayMs: number): unknown {
        const entry = { callback, active: true };
        this.timeoutDelays.push(delayMs);
        this.timeouts.push(entry);
        return entry;
    }

    clearTimeout(handle: unknown): void {
        const entry = this.timeouts.find((candidate) => candidate === handle);
        if (entry) entry.active = false;
    }

    sleep(delayMs: number): Promise<void> {
        this.sleepDelays.push(delayMs);
        return new Promise((resolve) => {
            this.sleepers.push(resolve);
        });
    }

    runNextTimeout(): void {
        const entry = this.timeouts.find((candidate) => candidate.active);
        if (!entry) throw new Error("No active timeout");
        entry.active = false;
        entry.callback();
    }

    releaseNextSleep(): void {
        const resolve = this.sleepers.shift();
        if (!resolve) throw new Error("No pending sleep");
        resolve();
    }
}

function sessionSnapshot(options: {
    firstAgentState?: string;
    protocol?: number;
    firstWorkspaceRollup?: string;
    firstTabRollup?: string;
} = {}): unknown {
    const firstAgentState = options.firstAgentState ?? "idle";
    return {
        type: "session_snapshot",
        snapshot: {
            version: "0.9.3",
            protocol: options.protocol ?? 19,
            focused_workspace_id: "ws-worktree",
            focused_tab_id: "tab-impl",
            focused_pane_id: "pane-worker",
            workspaces: [
                {
                    workspace_id: "ws-worktree",
                    label: "Auth worktree",
                    agent_status: options.firstWorkspaceRollup ?? "blocked",
                    worktree: {
                        checkout_path: "C:\\repo\\wt\\auth",
                        is_linked_worktree: true,
                    },
                },
                {
                    workspace_id: "ws-main",
                    label: "Main",
                    agent_status: "done",
                },
            ],
            tabs: [
                {
                    tab_id: "tab-impl",
                    workspace_id: "ws-worktree",
                    label: "Implementation",
                    agent_status: options.firstTabRollup ?? "working",
                },
                {
                    tab_id: "tab-empty",
                    workspace_id: "ws-worktree",
                    label: "Shell",
                    agent_status: "idle",
                },
                {
                    tab_id: "tab-review",
                    workspace_id: "ws-main",
                    label: "Review",
                    agent_status: "done",
                },
            ],
            panes: [
                {
                    pane_id: "pane-worker",
                    terminal_id: "term-worker",
                    workspace_id: "ws-worktree",
                    tab_id: "tab-impl",
                    label: "Worker pane",
                    agent: "pi",
                    agent_status: firstAgentState,
                    revision: 41,
                },
                {
                    pane_id: "pane-shell",
                    terminal_id: "term-shell",
                    workspace_id: "ws-worktree",
                    tab_id: "tab-empty",
                    label: "Plain shell",
                    agent_status: "idle",
                    revision: 3,
                },
                {
                    pane_id: "pane-review",
                    terminal_id: "term-review",
                    workspace_id: "ws-main",
                    tab_id: "tab-review",
                    label: "Review pane",
                    agent_status: "done",
                    revision: 9,
                },
            ],
            layouts: [],
            agents: [
                {
                    terminal_id: "term-worker",
                    display_agent: "Pi Worker",
                    agent: "pi",
                    title: "Implement auth",
                    agent_status: firstAgentState,
                    agent_session: {
                        source: "herdr:pi",
                        agent: "pi",
                        kind: "path",
                        value: "C:\\sessions\\worker.jsonl",
                    },
                    workspace_id: "ws-worktree",
                    tab_id: "tab-impl",
                    pane_id: "pane-worker",
                    focused: true,
                    state_change_seq: 27,
                    cwd: "C:\\repo\\wt\\auth",
                    foreground_cwd: "C:\\repo\\wt\\auth",
                    revision: 41,
                },
                {
                    terminal_id: "term-review",
                    title: "Review auth",
                    agent_status: "done",
                    workspace_id: "ws-main",
                    tab_id: "tab-review",
                    pane_id: "pane-review",
                    focused: false,
                    state_change_seq: 11,
                    revision: 9,
                },
            ],
        },
    };
}

function snapshotWithFirstAgent(patch: Record<string, unknown>): unknown {
    const response = sessionSnapshot() as {
        snapshot: { agents: Array<Record<string, unknown>> };
    };
    const firstAgent = response.snapshot.agents[0];
    if (!firstAgent) throw new Error("Missing first fixture agent");
    Object.assign(firstAgent, patch);
    return response;
}

function makeHarness(options: {
    client?: FakeClient;
    timers?: ManualTimers;
    ownership?: "external" | "desktop";
    onProjection?: ReturnType<typeof vi.fn>;
} = {}): {
    bridge: HerdrStateBridge;
    client: FakeClient;
    timers: ManualTimers;
    supervisor: HerdrStateBridgeSupervisor & { stop: ReturnType<typeof vi.fn> };
    ensureServer: ReturnType<typeof vi.fn>;
} {
    const client = options.client ?? new FakeClient();
    const timers = options.timers ?? new ManualTimers();
    const connection = {
        client,
        ownership: options.ownership ?? "desktop" as const,
        runtime: {
            path: "C:\\tools\\herdr.exe",
            source: "managed",
            version: "0.9.3",
        },
    };
    const ensureServer = vi.fn(async () => connection);
    const supervisor = {
        ensureServer,
        stop: vi.fn(),
    };
    const bridge = new HerdrStateBridge({
        supervisor,
        sessionName: "pi-desktop",
        onProjection: options.onProjection,
        timers,
        reconnectBackoffMs: [10, 20],
    });
    return { bridge, client, timers, supervisor, ensureServer };
}

function snapshotRequests(client: FakeClient): RecordedRequest[] {
    return client.requests.filter((request) => request.method === "session.snapshot");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

const expectedLifecycleEvents = [
    "workspace.created",
    "workspace.updated",
    "workspace.metadata_updated",
    "workspace.renamed",
    "workspace.moved",
    "workspace.reordered",
    "workspace.closed",
    "workspace.focused",
    "worktree.created",
    "worktree.opened",
    "worktree.removed",
    "tab.created",
    "tab.closed",
    "tab.focused",
    "tab.renamed",
    "tab.moved",
    "pane.created",
    "pane.closed",
    "pane.updated",
    "pane.focused",
    "pane.moved",
    "pane.exited",
    "pane.agent_detected",
];

describe("HerdrStateBridge", () => {
    it("maps the official snapshot into a Main-authoritative projection", async () => {
        const onProjection = vi.fn();
        const harness = makeHarness({ onProjection });
        harness.client.queueSnapshot(sessionSnapshot());

        const projection = await harness.bridge.start();

        expect(harness.ensureServer).toHaveBeenCalledOnce();
        expect(harness.client.subscriptionParams).toEqual([{
            subscriptions: expectedLifecycleEvents.map((type) => ({ type })),
        }]);
        expect(projection).toMatchObject({
            revision: 1,
            status: {
                connection: "connected",
                source: "managed",
                version: "0.9.3",
                protocol: 19,
                pid: null,
                owned: true,
                compatibility: "compatible",
                error: null,
            },
            tree: { session: "pi-desktop" },
        });
        expect(projection.agents).toEqual([
            {
                id: "pane-worker",
                target: "pane-worker",
                name: "pane-worker",
                displayName: "Pi Worker",
                kind: "pi",
                state: "idle",
                displayState: "idle",
                pane: "pane-worker",
                terminalId: "term-worker",
                tab: "Implementation",
                tabId: "tab-impl",
                workspace: "Auth worktree",
                workspaceId: "ws-worktree",
                task: "Implement auth",
                session: "C:\\sessions\\worker.jsonl",
                worktree: "C:\\repo\\wt\\auth",
                authority: "hook:herdr:pi",
                stateChangeSeq: 27,
                revision: 41,
                focused: true,
            },
            {
                id: "pane-review",
                target: "pane-review",
                name: "pane-review",
                displayName: "Review auth",
                kind: "unknown",
                state: "done",
                displayState: "done",
                pane: "pane-review",
                terminalId: "term-review",
                tab: "Review",
                tabId: "tab-review",
                workspace: "Main",
                workspaceId: "ws-main",
                task: "Review auth",
                session: "",
                worktree: "",
                authority: "herdr",
                stateChangeSeq: 11,
                revision: 9,
                focused: false,
            },
        ]);
        expect(projection.agents.map((agent) => agent.id)).not.toContain("pane-shell");
        expect(projection.tree.workspaces.map((workspace) => workspace.id)).toEqual([
            "ws-worktree",
            "ws-main",
        ]);
        expect(projection.tree.workspaces[0].tabs.map((tab) => tab.id)).toEqual([
            "tab-impl",
            "tab-empty",
        ]);
        expect(projection.tree.workspaces[0].kind).toBe("worktree");
        expect(projection.tree.workspaces[0].tabs[1].panes).toEqual([]);
        expect(onProjection).toHaveBeenLastCalledWith(projection);
    });

    it("uses the documented display-name precedence down to the pane label", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(snapshotWithFirstAgent({ name: "auth-worker" }));
        harness.client.queueSnapshot(snapshotWithFirstAgent({
            name: undefined,
            display_agent: undefined,
            title: undefined,
        }));

        const named = await harness.bridge.start();
        const paneFallback = await harness.bridge.refresh();

        expect(named.agents[0]).toMatchObject({
            name: "auth-worker",
            displayName: "auth-worker",
        });
        expect(paneFallback.agents[0]).toMatchObject({
            name: "pane-worker",
            displayName: "Worker pane",
        });
    });

    it("uses workspace and tab agent_status rollups from each authoritative snapshot", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot({
            firstAgentState: "idle",
            firstWorkspaceRollup: "blocked",
            firstTabRollup: "working",
        }));

        const projection = await harness.bridge.start();

        expect(projection.agents[0].displayState).toBe("idle");
        expect(projection.tree.workspaces[0].rollup).toBe("blocked");
        expect(projection.tree.workspaces[0].tabs[0].rollup).toBe("working");
    });

    it("keeps Desktop projection revisions monotonic without inventing an event cursor", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "working" }));

        const initial = await harness.bridge.start();
        const refreshed = await harness.bridge.refresh();

        expect([initial.revision, refreshed.revision]).toEqual([1, 2]);
        expect(refreshed.agents[0].stateChangeSeq).toBe(27);
        expect(refreshed).not.toHaveProperty("lastEventSeq");
        expect(JSON.stringify(refreshed)).not.toContain("eventSeq");
    });

    it("debounces an event burst into one full snapshot reconciliation and never patches payloads", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "idle" }));
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "blocked" }));
        await harness.bridge.start();

        harness.client.emit(0, "pane.agent_status_changed", {
            pane_id: "pane-worker",
            agent_status: "working",
        });
        harness.client.emit(0, "pane.updated", { pane: { pane_id: "pane-worker" } });
        harness.client.emit(0, "workspace.updated", { workspace_id: "ws-worktree" });

        expect(harness.timers.timeoutDelays).toEqual([75]);
        expect(snapshotRequests(harness.client)).toHaveLength(1);
        expect(harness.bridge.getProjection().agents[0].state).toBe("idle");

        harness.timers.runNextTimeout();
        await vi.waitFor(() => expect(snapshotRequests(harness.client)).toHaveLength(2));

        expect(harness.bridge.getProjection().agents[0].state).toBe("blocked");
        expect(harness.bridge.getProjection().revision).toBe(2);
    });

    it("reconciles again when an event arrives during an in-flight snapshot", async () => {
        const harness = makeHarness();
        const inFlightSnapshot = deferred<unknown>();
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "idle" }));
        harness.client.queueSnapshot(inFlightSnapshot.promise);
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "blocked" }));
        await harness.bridge.start();

        const manualRefresh = harness.bridge.refresh();
        await vi.waitFor(() => expect(snapshotRequests(harness.client)).toHaveLength(2));
        harness.client.emit(0, "pane.updated", { pane: { pane_id: "pane-worker" } });
        harness.timers.runNextTimeout();
        expect(snapshotRequests(harness.client)).toHaveLength(2);

        inFlightSnapshot.resolve(sessionSnapshot({ firstAgentState: "working" }));
        await manualRefresh;
        await vi.waitFor(() => {
            expect(snapshotRequests(harness.client)).toHaveLength(3);
            expect(harness.bridge.getProjection().agents[0].state).toBe("blocked");
        });
    });

    it("marks every agent and tree rollup disconnected when the subscription closes", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        const connected = await harness.bridge.start();

        harness.client.subscriptions[0].close(new Error("pipe closed"));

        await vi.waitFor(() => {
            expect(harness.bridge.getProjection().status.connection).toBe("reconnecting");
        });
        const disconnected = harness.bridge.getProjection();
        expect(disconnected.revision).toBe(connected.revision + 1);
        expect(disconnected.status.error).toContain("pipe closed");
        expect(disconnected.agents.every((agent) => agent.displayState === "disconnected")).toBe(true);
        expect(disconnected.agents[0].state).toBe("idle");
        expect(disconnected.tree.workspaces.every((workspace) => workspace.rollup === "disconnected"))
            .toBe(true);
        expect(disconnected.tree.workspaces.flatMap((workspace) => workspace.tabs)
            .every((tab) => tab.rollup === "disconnected")).toBe(true);
    });

    it("backs off, re-subscribes, and reconciles a fresh snapshot after disconnect", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "idle" }));
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "working" }));
        await harness.bridge.start();

        harness.client.subscriptions[0].close(new Error("lost subscription"));
        await vi.waitFor(() => expect(harness.timers.sleepDelays).toEqual([10]));

        harness.timers.releaseNextSleep();
        await vi.waitFor(() => expect(harness.client.subscriptions).toHaveLength(2));
        await vi.waitFor(() => expect(harness.bridge.getProjection().status.connection).toBe("connected"));

        expect(harness.ensureServer).toHaveBeenCalledTimes(2);
        expect(harness.client.subscriptionParams).toHaveLength(2);
        expect(harness.bridge.getProjection().agents[0].displayState).toBe("working");
        expect(harness.bridge.getProjection().revision).toBe(3);
    });

    it("publishes disconnected state and starts reconnecting when a snapshot request fails", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        harness.client.queueSnapshotFailure(new Error("snapshot unavailable"));
        await harness.bridge.start();

        await expect(harness.bridge.refresh()).rejects.toThrow("snapshot unavailable");

        expect(harness.bridge.getProjection().status.connection).toBe("reconnecting");
        expect(harness.bridge.getProjection().agents.every(
            (agent) => agent.displayState === "disconnected",
        )).toBe(true);
        expect(harness.timers.sleepDelays).toEqual([10]);
    });

    it("refreshes immediately after focus and prompt actions", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "done" }));
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "idle" }));
        harness.client.queueSnapshot(sessionSnapshot({ firstAgentState: "working" }));
        await harness.bridge.start();

        const focused = await harness.bridge.focusAgent({ target: "pane-worker" });
        const prompted = await harness.bridge.promptAgent({
            target: "pane-worker",
            text: "Continue",
            until: ["idle", "done"],
            timeoutMs: 30_000,
        });

        expect(focused.agents[0].state).toBe("idle");
        expect(prompted.agents[0].state).toBe("working");
        expect(harness.client.requests.map((request) => request.method)).toEqual([
            "session.snapshot",
            "agent.focus",
            "session.snapshot",
            "agent.prompt",
            "session.snapshot",
        ]);
        expect(harness.client.requests[1].params).toEqual({ target: "pane-worker" });
        expect(harness.client.requests[3]).toEqual({
            method: "agent.prompt",
            params: {
                target: "pane-worker",
                text: "Continue",
                wait: { until: ["idle", "done"], timeout_ms: 30_000 },
            },
            timeoutMs: 30_000,
        });
    });

    it("does not reconnect when Herdr returns a typed business error", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        harness.client.respondTo(
            "agent.focus",
            new HerdrRpcRequestError("agent_not_found", "agent target w1:p1 not found"),
        );
        await harness.bridge.start();

        await expect(harness.bridge.focusAgent({ target: "w1:p1" })).rejects.toMatchObject({
            code: "agent_not_found",
        });
        expect(harness.bridge.getProjection().status.connection).toBe("connected");
        expect(harness.client.subscriptions).toHaveLength(1);
        expect(harness.client.subscriptions[0].unsubscribe).not.toHaveBeenCalled();
    });

    it("maps the pane_read response from agent.read", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        harness.client.respondTo("agent.read", {
            type: "pane_read",
            read: {
                pane_id: "pane-worker",
                workspace_id: "ws-worktree",
                tab_id: "tab-impl",
                source: "recent_unwrapped",
                format: "text",
                text: "completed",
                revision: 44,
                truncated: false,
            },
        });
        await harness.bridge.start();

        const output = await harness.bridge.readAgentOutput({
            target: "pane-worker",
            source: "recent_unwrapped",
            lines: 200,
        });

        expect(output).toEqual({
            paneId: "pane-worker",
            workspaceId: "ws-worktree",
            tabId: "tab-impl",
            source: "recent_unwrapped",
            text: "completed",
            revision: 44,
            truncated: false,
        });
        expect(harness.client.requests.at(-1)).toEqual({
            method: "agent.read",
            params: { target: "pane-worker", source: "recent_unwrapped", lines: 200 },
            timeoutMs: undefined,
        });
    });

    it("sends only the typed key action without an arbitrary RPC passthrough", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());
        await harness.bridge.start();

        await expect(harness.bridge.sendAgentKeys({
            target: "pane-worker",
            keys: ["ctrl+c", "enter"],
        })).resolves.toBeUndefined();

        expect(harness.client.requests.at(-1)).toEqual({
            method: "agent.send_keys",
            params: { target: "pane-worker", keys: ["ctrl+c", "enter"] },
            timeoutMs: undefined,
        });
    });

    it("makes start and stop idempotent and never stops the persistent Herdr server", async () => {
        const harness = makeHarness();
        harness.client.queueSnapshot(sessionSnapshot());

        const [first, second] = await Promise.all([
            harness.bridge.start(),
            harness.bridge.start(),
        ]);
        expect(second).toBe(first);
        expect(harness.ensureServer).toHaveBeenCalledOnce();
        expect(harness.client.subscriptions).toHaveLength(1);
        harness.client.emit(0, "pane.updated", { pane: { pane_id: "pane-worker" } });

        harness.bridge.stop();
        harness.bridge.stop();
        harness.bridge.dispose();

        expect(harness.client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(harness.client.dispose).toHaveBeenCalledOnce();
        expect(() => harness.timers.runNextTimeout()).toThrow("No active timeout");
        expect(harness.supervisor.stop).not.toHaveBeenCalled();
        expect(harness.client.requests.some((request) => request.method === "server.stop")).toBe(false);
        expect(harness.bridge.getProjection().status.connection).toBe("offline");
    });

    it("marks a non-v19 snapshot incompatible and maps external ownership", async () => {
        const harness = makeHarness({ ownership: "external" });
        harness.client.queueSnapshot(sessionSnapshot({ protocol: 20 }));

        const projection = await harness.bridge.start();

        expect(projection.status).toMatchObject({
            source: "external",
            owned: false,
            protocol: 20,
            compatibility: "incompatible",
        });
    });
});
