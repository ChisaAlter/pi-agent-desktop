import type {
    HerdrFocusAgentInput,
    HerdrPromptAgentInput,
    HerdrReadAgentOutputInput,
    HerdrReadAgentOutputResult,
    HerdrRuntimeAgentProjection,
    HerdrRuntimeAgentState,
    HerdrRuntimeProjection,
    HerdrRuntimeSource,
    HerdrSendAgentKeysInput,
} from "@shared";
import { HerdrRpcRequestError } from "./rpc-client";

export interface HerdrBridgeSubscriptionEvent {
    event: string;
    data: unknown;
}

export interface HerdrBridgeSubscription {
    unsubscribe(): void;
    closed: Promise<Error | null>;
}

export interface HerdrBridgeRpcClient {
    request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
    subscribe(
        params: unknown,
        listener: (event: HerdrBridgeSubscriptionEvent) => void,
        timeoutMs?: number,
    ): Promise<HerdrBridgeSubscription>;
    dispose(): void;
}

export interface HerdrBridgeRuntimeInfo {
    path: string;
    source: "env" | "path" | "development" | "managed";
    version: string;
}

export interface HerdrBridgeServerConnection {
    /** Preferred G3A dependency name. */
    client?: HerdrBridgeRpcClient;
    /** Compatibility with the low-level supervisor's service-handle name. */
    rpc?: HerdrBridgeRpcClient;
    ownership: "external" | "desktop";
    runtime: HerdrBridgeRuntimeInfo | null;
    /**
     * When true, the bridge may dispose the RPC client. Supervisor-owned handles
     * must leave this false so Desktop exit never tears down the persistent server.
     */
    ownsClient?: boolean;
}

export interface HerdrStateBridgeSupervisor {
    ensureServer(): Promise<HerdrBridgeServerConnection>;
}

export interface HerdrStateBridgeTimers {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
    sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
}

export interface HerdrStateBridgeOptions {
    supervisor: HerdrStateBridgeSupervisor;
    sessionName?: string;
    onProjection?: (projection: HerdrRuntimeProjection) => void;
    timers?: HerdrStateBridgeTimers;
    debounceMs?: number;
    requestTimeoutMs?: number;
    subscriptionTimeoutMs?: number;
    reconnectBackoffMs?: readonly number[];
}

interface HerdrAgentSessionInfo {
    source: string;
    value: string;
}

interface HerdrAgentInfo {
    terminal_id: string;
    name?: string;
    agent?: string;
    title?: string;
    display_agent?: string;
    agent_status: string;
    agent_session?: HerdrAgentSessionInfo;
    workspace_id: string;
    tab_id: string;
    pane_id: string;
    focused: boolean;
    state_change_seq: number;
    cwd?: string;
    foreground_cwd?: string;
    revision: number;
}

interface HerdrWorkspaceInfo {
    workspace_id: string;
    label: string;
    agent_status: string;
    worktree?: {
        checkout_path: string;
        is_linked_worktree: boolean;
    };
}

interface HerdrTabInfo {
    tab_id: string;
    workspace_id: string;
    label: string;
    agent_status: string;
}

interface HerdrPaneInfo {
    pane_id: string;
    terminal_id: string;
    workspace_id: string;
    tab_id: string;
    label?: string;
    agent?: string;
    title?: string;
    display_agent?: string;
    agent_status: string;
    agent_session?: HerdrAgentSessionInfo;
    revision: number;
}

interface HerdrSessionSnapshot {
    version: string;
    protocol: number;
    workspaces: HerdrWorkspaceInfo[];
    tabs: HerdrTabInfo[];
    panes: HerdrPaneInfo[];
    layouts: unknown[];
    agents: HerdrAgentInfo[];
}

interface HerdrSessionSnapshotResponse {
    type: "session_snapshot";
    snapshot: HerdrSessionSnapshot;
}

interface HerdrPaneReadResponse {
    type: "pane_read";
    read: {
        pane_id: string;
        workspace_id: string;
        tab_id: string;
        source: HerdrReadAgentOutputResult["source"];
        text: string;
        revision: number;
        truncated: boolean;
    };
}

interface ActiveConnectionMetadata {
    ownership: HerdrBridgeServerConnection["ownership"];
    runtime: HerdrBridgeRuntimeInfo | null;
}

const DEFAULT_DEBOUNCE_MS = 75;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SUBSCRIPTION_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000] as const;
const COMPATIBLE_PROTOCOL = 19;

const RECONCILIATION_EVENT_NAMES = [
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
    // pane.agent_status_changed / pane.output_matched / pane.scroll_changed
    // require a pane_id and cannot be used as session-wide subscriptions.
] as const;

const defaultTimers: HerdrStateBridgeTimers = {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    sleep: (delayMs, signal) => new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const handle = setTimeout(resolve, delayMs);
        signal?.addEventListener("abort", () => {
            clearTimeout(handle);
            resolve();
        }, { once: true });
    }),
};

export class HerdrStateBridge {
    private readonly supervisor: HerdrStateBridgeSupervisor;
    private readonly sessionName: string;
    private readonly onProjection?: (projection: HerdrRuntimeProjection) => void;
    private readonly timers: HerdrStateBridgeTimers;
    private readonly debounceMs: number;
    private readonly requestTimeoutMs: number;
    private readonly subscriptionTimeoutMs: number;
    private readonly reconnectBackoffMs: readonly number[];

    private projection: HerdrRuntimeProjection;
    private client: HerdrBridgeRpcClient | null = null;
    private ownsClient = false;
    private connectionMetadata: ActiveConnectionMetadata | null = null;
    private subscription: HerdrBridgeSubscription | null = null;
    private debounceHandle: unknown = null;
    private reconnectAbortController: AbortController | null = null;
    private reconnectPromise: Promise<void> | null = null;
    private startPromise: Promise<HerdrRuntimeProjection> | null = null;
    private refreshPromise: Promise<HerdrRuntimeProjection> | null = null;
    private lifecycleRevision = 0;
    private started = false;
    private disposed = false;

    constructor(options: HerdrStateBridgeOptions) {
        this.supervisor = options.supervisor;
        this.sessionName = options.sessionName ?? "default";
        this.onProjection = options.onProjection;
        this.timers = options.timers ?? defaultTimers;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.subscriptionTimeoutMs = options.subscriptionTimeoutMs ?? DEFAULT_SUBSCRIPTION_TIMEOUT_MS;
        this.reconnectBackoffMs = normalizeBackoff(options.reconnectBackoffMs);
        this.projection = emptyProjection(this.sessionName);
    }

    start(): Promise<HerdrRuntimeProjection> {
        if (this.disposed) return Promise.reject(new Error("Herdr state bridge is disposed"));
        if (this.startPromise) return this.startPromise;
        if (this.started) return Promise.resolve(this.projection);

        this.started = true;
        const lifecycleRevision = ++this.lifecycleRevision;
        const starting = this.establishConnection(lifecycleRevision).catch((cause: unknown) => {
            if (this.isActive(lifecycleRevision)) this.handleConnectionFailure(cause, "offline");
            throw toError(cause, "Herdr state bridge failed to start");
        });
        this.startPromise = starting;
        void starting.finally(() => {
            if (this.startPromise === starting) this.startPromise = null;
        }).catch(() => undefined);
        return starting;
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        ++this.lifecycleRevision;
        this.cancelDebouncedRefresh();
        this.cancelReconnect();
        this.closeSubscription();
        this.refreshPromise = null;

        const client = this.client;
        const shouldDisposeClient = this.ownsClient;
        this.client = null;
        this.ownsClient = false;
        this.connectionMetadata = null;
        if (shouldDisposeClient) client?.dispose();
        this.publishDisconnected("offline", null);
    }

    dispose(): void {
        if (this.disposed) return;
        this.stop();
        this.disposed = true;
    }

    getProjection(): HerdrRuntimeProjection {
        return this.projection;
    }

    isStarted(): boolean {
        return this.started && !this.disposed;
    }

    refresh(): Promise<HerdrRuntimeProjection> {
        if (this.disposed) return Promise.reject(new Error("Herdr state bridge is disposed"));
        if (!this.started) return this.start();
        if (this.refreshPromise) return this.refreshPromise;

        const client = this.requireClient();
        const lifecycleRevision = this.lifecycleRevision;
        const refreshing = this.fetchAndPublishSnapshot(client, lifecycleRevision).catch((cause: unknown) => {
            if (this.isActive(lifecycleRevision)) this.handleConnectionFailure(cause, "reconnecting");
            throw toError(cause, "Herdr snapshot refresh failed");
        });
        this.refreshPromise = refreshing;
        void refreshing.finally(() => {
            if (this.refreshPromise === refreshing) this.refreshPromise = null;
        }).catch(() => undefined);
        return refreshing;
    }

    async readAgentOutput(input: HerdrReadAgentOutputInput): Promise<HerdrReadAgentOutputResult> {
        await this.ensureStarted();
        const params: { target: string; source: HerdrReadAgentOutputResult["source"]; lines?: number } = {
            target: input.target,
            source: input.source ?? "recent",
        };
        if (input.lines !== undefined) params.lines = input.lines;
        const response = await this.request<HerdrPaneReadResponse>("agent.read", params);
        if (response.type !== "pane_read") {
            throw new Error("Herdr agent.read returned an unexpected response type");
        }
        return {
            paneId: response.read.pane_id,
            workspaceId: response.read.workspace_id,
            tabId: response.read.tab_id,
            source: response.read.source,
            text: response.read.text,
            revision: response.read.revision,
            truncated: response.read.truncated,
        };
    }

    async focusAgent(input: HerdrFocusAgentInput): Promise<HerdrRuntimeProjection> {
        await this.ensureStarted();
        await this.request<unknown>("agent.focus", { target: input.target });
        return this.refreshAfterPending();
    }

    async promptAgent(input: HerdrPromptAgentInput): Promise<HerdrRuntimeProjection> {
        await this.ensureStarted();
        const params: {
            target: string;
            text: string;
            wait?: { until?: HerdrRuntimeAgentState[]; timeout_ms?: number };
        } = {
            target: input.target,
            text: input.text,
        };
        if (input.until !== undefined || input.timeoutMs !== undefined) {
            params.wait = {};
            if (input.until !== undefined) params.wait.until = input.until;
            if (input.timeoutMs !== undefined) params.wait.timeout_ms = input.timeoutMs;
        }
        await this.request<unknown>("agent.prompt", params, input.timeoutMs);
        return this.refreshAfterPending();
    }

    async sendAgentKeys(input: HerdrSendAgentKeysInput): Promise<void> {
        await this.ensureStarted();
        await this.request<unknown>("agent.send_keys", {
            target: input.target,
            keys: input.keys,
        });
    }

    async installIntegration(target: "pi"): Promise<void> {
        await this.ensureStarted();
        await this.request<unknown>("integration.install", { target });
    }

    private async ensureStarted(): Promise<void> {
        if (this.disposed) throw new Error("Herdr state bridge is disposed");
        if (!this.started || this.startPromise) await this.start();
    }

    private async refreshAfterPending(): Promise<HerdrRuntimeProjection> {
        const pendingConnection = this.startPromise ?? this.reconnectPromise;
        if (pendingConnection) await pendingConnection;
        const pendingRefresh = this.refreshPromise;
        if (pendingRefresh) await pendingRefresh;
        return this.refresh();
    }

    private async establishConnection(lifecycleRevision: number): Promise<HerdrRuntimeProjection> {
        const connection = await this.supervisor.ensureServer();
        const client = connection.client ?? connection.rpc;
        if (!client) throw new Error("Herdr supervisor returned no RPC client");
        const ownsClient = connection.ownsClient ?? (connection.client !== undefined && connection.rpc === undefined);
        if (!this.isActive(lifecycleRevision)) {
            if (ownsClient) client.dispose();
            throw new BridgeOperationCancelledError();
        }
        this.replaceClient(client, ownsClient);
        this.connectionMetadata = {
            ownership: connection.ownership,
            runtime: connection.runtime,
        };

        const subscription = await client.subscribe(
            { subscriptions: RECONCILIATION_EVENT_NAMES.map((type) => ({ type })) },
            () => this.scheduleReconciliation(),
            this.subscriptionTimeoutMs,
        );
        if (!this.isActive(lifecycleRevision)) {
            subscription.unsubscribe();
            throw new BridgeOperationCancelledError();
        }

        try {
            const projection = await this.fetchAndPublishSnapshot(
                client,
                lifecycleRevision,
            );
            if (!this.isActive(lifecycleRevision)) {
                subscription.unsubscribe();
                throw new BridgeOperationCancelledError();
            }
            this.closeSubscription();
            this.subscription = subscription;
            this.watchSubscription(subscription, lifecycleRevision);
            return projection;
        } catch (cause) {
            subscription.unsubscribe();
            throw cause;
        }
    }

    private async fetchAndPublishSnapshot(
        client: HerdrBridgeRpcClient,
        lifecycleRevision: number,
    ): Promise<HerdrRuntimeProjection> {
        const response = await client.request<HerdrSessionSnapshotResponse>(
            "session.snapshot",
            {},
            this.requestTimeoutMs,
        );
        if (!this.isActive(lifecycleRevision)) throw new BridgeOperationCancelledError();
        if (response.type !== "session_snapshot") {
            throw new Error("Herdr session.snapshot returned an unexpected response type");
        }
        const metadata = this.connectionMetadata;
        if (!metadata) throw new Error("Herdr connection metadata is unavailable");
        const projection = projectSnapshot(
            response.snapshot,
            metadata,
            this.sessionName,
            this.projection.revision + 1,
        );
        this.publish(projection);
        return projection;
    }

    private async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
        const client = this.requireClient();
        try {
            return await client.request<T>(method, params, timeoutMs);
        } catch (cause) {
            if (this.started && isTransportFailure(cause)) {
                this.handleConnectionFailure(cause, "reconnecting");
            }
            throw cause;
        }
    }

    private requireClient(): HerdrBridgeRpcClient {
        if (!this.started || !this.client) {
            throw new Error("Herdr state bridge is not connected");
        }
        return this.client;
    }

    private replaceClient(client: HerdrBridgeRpcClient, ownsClient: boolean): void {
        if (this.client === client) {
            this.ownsClient = ownsClient;
            return;
        }
        if (this.ownsClient) this.client?.dispose();
        this.client = client;
        this.ownsClient = ownsClient;
    }

    private watchSubscription(
        subscription: HerdrBridgeSubscription,
        lifecycleRevision: number,
    ): void {
        void subscription.closed.then(
            (reason) => {
                if (
                    !this.isActive(lifecycleRevision)
                    || this.subscription !== subscription
                ) return;
                this.subscription = null;
                this.handleConnectionFailure(
                    reason ?? new Error("Herdr event subscription closed unexpectedly"),
                    "reconnecting",
                );
            },
            (cause: unknown) => {
                if (
                    !this.isActive(lifecycleRevision)
                    || this.subscription !== subscription
                ) return;
                this.subscription = null;
                this.handleConnectionFailure(cause, "reconnecting");
            },
        );
    }

    private scheduleReconciliation(): void {
        if (!this.started || this.debounceHandle !== null) return;
        this.debounceHandle = this.timers.setTimeout(() => {
            this.debounceHandle = null;
            if (!this.started) return;
            void this.refreshAfterPending().catch(() => undefined);
        }, this.debounceMs);
    }

    private cancelDebouncedRefresh(): void {
        if (this.debounceHandle === null) return;
        this.timers.clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
    }

    private handleConnectionFailure(
        cause: unknown,
        connection: "offline" | "reconnecting",
    ): void {
        if (!this.started || cause instanceof BridgeOperationCancelledError) return;
        this.cancelDebouncedRefresh();
        this.closeSubscription();
        this.publishDisconnected(connection, toError(cause, "Herdr connection failed").message);
        this.beginReconnect();
    }

    private publishDisconnected(
        connection: "offline" | "reconnecting",
        error: string | null,
    ): void {
        const agents = this.projection.agents.map((agent) => ({
            ...agent,
            displayState: "disconnected" as const,
        }));
        const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
        this.publish({
            revision: this.projection.revision + 1,
            status: {
                ...this.projection.status,
                connection,
                compatibility: connection === "offline"
                    ? "unknown"
                    : this.projection.status.compatibility,
                error,
            },
            agents,
            tree: {
                session: this.projection.tree.session,
                workspaces: this.projection.tree.workspaces.map((workspace) => ({
                    ...workspace,
                    rollup: "disconnected",
                    tabs: workspace.tabs.map((tab) => ({
                        ...tab,
                        rollup: "disconnected",
                        panes: tab.panes.map((agent) => agentsById.get(agent.id) ?? {
                            ...agent,
                            displayState: "disconnected",
                        }),
                    })),
                })),
            },
        });
    }

    private beginReconnect(): void {
        if (!this.started || this.reconnectPromise) return;
        const lifecycleRevision = this.lifecycleRevision;
        const abortController = new AbortController();
        this.reconnectAbortController = abortController;
        const reconnecting = this.runReconnect(lifecycleRevision, abortController.signal);
        this.reconnectPromise = reconnecting;
        void reconnecting.finally(() => {
            if (this.reconnectPromise === reconnecting) this.reconnectPromise = null;
            if (this.reconnectAbortController === abortController) {
                this.reconnectAbortController = null;
            }
        }).catch(() => undefined);
    }

    private async runReconnect(
        lifecycleRevision: number,
        signal: AbortSignal,
    ): Promise<void> {
        let attempt = 0;
        while (this.isActive(lifecycleRevision) && !signal.aborted) {
            const delayMs = this.reconnectBackoffMs[
                Math.min(attempt, this.reconnectBackoffMs.length - 1)
            ];
            await this.timers.sleep(delayMs, signal);
            if (!this.isActive(lifecycleRevision) || signal.aborted) return;
            try {
                await this.establishConnection(lifecycleRevision);
                return;
            } catch (cause) {
                if (
                    !this.isActive(lifecycleRevision)
                    || signal.aborted
                    || cause instanceof BridgeOperationCancelledError
                ) return;
                this.publishDisconnected(
                    "reconnecting",
                    toError(cause, "Herdr reconnect failed").message,
                );
                attempt += 1;
            }
        }
    }

    private cancelReconnect(): void {
        this.reconnectAbortController?.abort();
        this.reconnectAbortController = null;
        this.reconnectPromise = null;
    }

    private closeSubscription(): void {
        const subscription = this.subscription;
        this.subscription = null;
        subscription?.unsubscribe();
    }

    private isActive(lifecycleRevision: number): boolean {
        return this.started && !this.disposed && this.lifecycleRevision === lifecycleRevision;
    }

    private publish(projection: HerdrRuntimeProjection): void {
        this.projection = projection;
        this.onProjection?.(projection);
    }
}

class BridgeOperationCancelledError extends Error {
    constructor() {
        super("Herdr state bridge operation was cancelled");
        this.name = "BridgeOperationCancelledError";
    }
}

function projectSnapshot(
    snapshot: HerdrSessionSnapshot,
    metadata: ActiveConnectionMetadata,
    sessionName: string,
    revision: number,
): HerdrRuntimeProjection {
    const workspaceById = new Map(snapshot.workspaces.map((workspace) => [
        workspace.workspace_id,
        workspace,
    ]));
    const tabById = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab]));
    const paneById = new Map(snapshot.panes.map((pane) => [pane.pane_id, pane]));
    const agents = snapshot.agents.map((agent) => {
        const workspace = workspaceById.get(agent.workspace_id);
        const tab = tabById.get(agent.tab_id);
        const pane = paneById.get(agent.pane_id);
        const state = normalizeAgentState(agent.agent_status);
        return {
            id: agent.pane_id,
            target: agent.pane_id,
            name: agent.name ?? agent.pane_id,
            displayName: agent.name
                ?? agent.display_agent
                ?? agent.title
                ?? pane?.label
                ?? agent.pane_id,
            kind: agent.agent ?? "unknown",
            state,
            displayState: state,
            pane: agent.pane_id,
            terminalId: agent.terminal_id,
            tab: tab?.label ?? agent.tab_id,
            tabId: agent.tab_id,
            workspace: workspace?.label ?? agent.workspace_id,
            workspaceId: agent.workspace_id,
            task: agent.title ?? "",
            session: agent.agent_session?.value ?? "",
            worktree: workspace?.worktree?.checkout_path ?? "",
            authority: agent.agent_session ? `hook:${agent.agent_session.source}` : "herdr",
            stateChangeSeq: agent.state_change_seq,
            revision: agent.revision,
            focused: agent.focused,
        } satisfies HerdrRuntimeAgentProjection;
    });
    const agentsByTab = groupAgentsByTab(agents);
    const statusSource = runtimeSource(metadata);
    return {
        revision,
        status: {
            connection: "connected",
            source: statusSource,
            version: metadata.runtime?.version ?? snapshot.version,
            protocol: snapshot.protocol,
            pid: null,
            owned: metadata.ownership === "desktop",
            compatibility: snapshot.protocol === COMPATIBLE_PROTOCOL
                ? "compatible"
                : "incompatible",
            error: null,
        },
        agents,
        tree: {
            session: sessionName,
            workspaces: snapshot.workspaces.map((workspace) => ({
                id: workspace.workspace_id,
                name: workspace.label,
                kind: workspace.worktree ? "worktree" : "workspace",
                rollup: normalizeAgentState(workspace.agent_status),
                tabs: snapshot.tabs
                    .filter((tab) => tab.workspace_id === workspace.workspace_id)
                    .map((tab) => ({
                        id: tab.tab_id,
                        name: tab.label,
                        rollup: normalizeAgentState(tab.agent_status),
                        panes: agentsByTab.get(tab.tab_id) ?? [],
                    })),
            })),
        },
    };
}

function groupAgentsByTab(
    agents: HerdrRuntimeAgentProjection[],
): Map<string, HerdrRuntimeAgentProjection[]> {
    const grouped = new Map<string, HerdrRuntimeAgentProjection[]>();
    for (const agent of agents) {
        const tabAgents = grouped.get(agent.tabId) ?? [];
        tabAgents.push(agent);
        grouped.set(agent.tabId, tabAgents);
    }
    return grouped;
}

function normalizeAgentState(state: string): HerdrRuntimeAgentState {
    switch (state) {
        case "idle":
        case "working":
        case "blocked":
        case "done":
        case "unknown":
            return state;
        default:
            return "unknown";
    }
}

function runtimeSource(metadata: ActiveConnectionMetadata): HerdrRuntimeSource {
    if (metadata.ownership === "external") return "external";
    return metadata.runtime?.source ?? "unknown";
}

function emptyProjection(sessionName: string): HerdrRuntimeProjection {
    return {
        revision: 0,
        status: {
            connection: "offline",
            source: "unknown",
            version: null,
            protocol: null,
            pid: null,
            owned: false,
            compatibility: "unknown",
            error: null,
        },
        agents: [],
        tree: {
            session: sessionName,
            workspaces: [],
        },
    };
}

function normalizeBackoff(backoff: readonly number[] | undefined): readonly number[] {
    if (!backoff || backoff.length === 0) return DEFAULT_RECONNECT_BACKOFF_MS;
    if (backoff.some((delayMs) => !Number.isFinite(delayMs) || delayMs < 0)) {
        throw new RangeError("Herdr reconnect backoff delays must be finite non-negative numbers");
    }
    return [...backoff];
}

function toError(cause: unknown, fallback: string): Error {
    if (cause instanceof Error) return cause;
    return new Error(typeof cause === "string" ? cause : fallback);
}

function isTransportFailure(cause: unknown): boolean {
    return !(cause instanceof HerdrRpcRequestError);
}
