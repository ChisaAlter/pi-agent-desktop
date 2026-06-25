import { BrowserWindow } from "electron";
import log from "electron-log/main";
import type {
    ExtensionUIContext,
    ExtensionUIDialogOptions,
    ExtensionWidgetOptions,
    WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import type {
    ExtensionUiRequest,
    ExtensionUiResponse,
    PermissionDecision,
    PlanCard,
    PlanProgressItem,
} from "@shared";

type PendingRequest = {
    kind: ExtensionUiRequest["kind"];
    source: ExtensionUiRequest["source"];
    options?: string[];
    resolve: (value: string | boolean | undefined) => void;
    timer: NodeJS.Timeout;
};

interface ExtensionUiBridgeScope {
    agentId?: string;
}

interface ExtensionUiBridgeObservers {
    onPlanProgress?: (payload: {
        workspaceId: string;
        agentId?: string;
        items: PlanProgressItem[];
    }) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
let currentPermissionMode: "ask" | "smart" | "always" = "smart";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

function getWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

function send(channel: string, payload: unknown): void {
    const win = getWindow();
    if (!win) return;
    win.webContents.send(channel, payload);
}

function newRequestId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function classifySource(title: string, options?: string[]): ExtensionUiRequest["source"] {
    const text = `${title}\n${(options ?? []).join("\n")}`.toLowerCase();
    if (text.includes("permission") || text.includes("allow") || text.includes("deny")) return "permission";
    if (text.includes("plan") || text.includes("execute_plan") || text.includes("refine")) return "plan";
    return "extension";
}

function splitTitleMessage(title: string): { title: string; message?: string } {
    const [first, ...rest] = title.split(/\r?\n/);
    return {
        title: first.trim() || "请求",
        message: rest.join("\n").trim() || undefined,
    };
}

function coerceDecisionValue(
    response: ExtensionUiResponse | PermissionDecision | boolean | string,
    pending: PendingRequest,
): string | boolean | undefined {
    if (typeof response === "boolean" || typeof response === "string") return response;
    if (typeof response === "object" && response !== null) {
        if (typeof response.value === "boolean" || typeof response.value === "string") return response.value;
        if (response.decision) {
            const approve = response.decision === "allow_once" ||
                response.decision === "allow_session" ||
                response.decision === "allow_always";
            if (pending.kind === "confirm") return approve;
            const yes = pending.options?.find((opt) => /^yes$/i.test(opt)) ?? pending.options?.[0];
            const no = pending.options?.find((opt) => /^no$/i.test(opt)) ?? pending.options?.[1];
            return approve ? yes : no;
        }
    }
    return undefined;
}

export function resolveExtensionUiRequest(
    requestId: string,
    response: ExtensionUiResponse | PermissionDecision | boolean | string,
): void {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(coerceDecisionValue(response, pending));
}

function timeoutValue(kind: ExtensionUiRequest["kind"]): string | boolean | undefined {
    return kind === "confirm" ? false : undefined;
}

export function clearPendingExtensionUiRequests(): void {
    for (const [requestId, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);
        pending.resolve(timeoutValue(pending.kind));
    }
}

export function _pendingExtensionUiRequestCount(): number {
    return pendingRequests.size;
}

export function setDesktopPermissionMode(mode: "ask" | "smart" | "always"): void {
    currentPermissionMode = mode;
    const globalScope = globalThis as {
        __piPermissionSystem?: {
            setYoloMode?: (enabled: boolean, options?: { persist?: boolean; source?: string }) => unknown;
        };
    };
    try {
        globalScope.__piPermissionSystem?.setYoloMode?.(mode === "always", {
            persist: mode === "always",
            source: "pi-desktop",
        });
    } catch (err) {
        log.warn("[extension-ui] failed to update pi-permission-system yolo mode:", err);
    }
    send("permission:update", { mode });
}

function parsePlanWidgetLines(lines: string[]): PlanProgressItem[] {
    return lines
        .map((raw, index): PlanProgressItem | null => {
            const text = raw.replace(/^[\s\-*]+/, "").replace(/^\[[ xX~!]\]\s*/, "").trim();
            if (!text) return null;
            const done = /\[[xX]\]|\[DONE:\d+\]|✅/.test(raw);
            const running = /▶|running|进行中|in_progress/i.test(raw);
            const waiting = /⏸|waiting|等待/i.test(raw);
            const failed = /❌|failed|失败/i.test(raw);
            return {
                id: `plan_step_${index}`,
                text,
                status: failed ? "failed" : done ? "completed" : running ? "running" : waiting ? "waiting" : "pending",
            } satisfies PlanProgressItem;
        })
        .filter((item): item is PlanProgressItem => item !== null);
}

export function emitPlanCard(card: PlanCard, workspaceId?: string): void {
    send("plan:card", card);
    send("plan:decision-request", {
        requestId: newRequestId("plan_decision"),
        card,
        workspaceId,
    });
}

export function createExtensionUiBridge(
    workspaceId: string,
    scope: ExtensionUiBridgeScope = {},
    observers: ExtensionUiBridgeObservers = {},
): ExtensionUIContext {
    const request = async (
        kind: ExtensionUiRequest["kind"],
        rawTitle: string,
        opts?: {
            message?: string;
            placeholder?: string;
            options?: string[];
            dialogOptions?: ExtensionUIDialogOptions;
        },
    ): Promise<string | boolean | undefined> => {
        const requestId = newRequestId(kind);
        const source = classifySource(rawTitle, opts?.options);
        const split = splitTitleMessage(rawTitle);
        const payload: ExtensionUiRequest = {
            requestId,
            workspaceId,
            agentId: scope.agentId,
            kind,
            source,
            title: split.title,
            message: opts?.message ?? split.message,
            placeholder: opts?.placeholder,
            options: opts?.options,
            createdAt: Date.now(),
        };

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const pending = pendingRequests.get(requestId);
                if (!pending) return;
                pendingRequests.delete(requestId);
                pending.resolve(timeoutValue(pending.kind));
            }, DEFAULT_REQUEST_TIMEOUT_MS);
            pendingRequests.set(requestId, { kind, source, options: opts?.options, resolve, timer });
            send(source === "plan" ? "plan:decision-request" : "permission:request", payload);
        });
    };

    return {
        async select(title: string, options: string[]) {
            if (currentPermissionMode === "always" && classifySource(title, options) === "permission") {
                return options.find((opt) => /^yes$/i.test(opt)) ?? options[0];
            }
            return request("select", title, { options }) as Promise<string | undefined>;
        },
        async confirm(title: string, message: string) {
            if (currentPermissionMode === "always" && classifySource(`${title}\n${message}`) === "permission") {
                return true;
            }
            return Boolean(await request("confirm", title, { message }));
        },
        async input(title: string, placeholder?: string) {
            return request("input", title, { placeholder }) as Promise<string | undefined>;
        },
        async editor(title: string, prefill?: string) {
            return request("editor", title, { message: prefill }) as Promise<string | undefined>;
        },
        notify(message: string, type?: "info" | "warning" | "error") {
            send("permission:update", { message, type, workspaceId, agentId: scope.agentId });
        },
        onTerminalInput() {
            return () => undefined;
        },
        setStatus(key: string, text: string | undefined) {
            send("permission:update", { key, text, workspaceId, agentId: scope.agentId });
        },
        setWorkingMessage() {},
        setWorkingVisible() {},
        setWorkingIndicator(_options?: WorkingIndicatorOptions) {},
        setHiddenThinkingLabel() {},
        setWidget(key: string, content: unknown, _options?: ExtensionWidgetOptions) {
            if (key === "plan-todos") {
                const lines = Array.isArray(content) ? content.filter((item): item is string => typeof item === "string") : [];
                const payload = {
                    workspaceId,
                    agentId: scope.agentId,
                    items: parsePlanWidgetLines(lines),
                    status: lines.length > 0 ? "executing" : "idle",
                } as const;
                observers.onPlanProgress?.({
                    workspaceId,
                    agentId: scope.agentId,
                    items: payload.items,
                });
                send("plan:progress", payload);
            }
        },
        setFooter() {},
        setHeader() {},
        setTitle(title: string) {
            send("permission:update", { title, workspaceId, agentId: scope.agentId });
        },
        async custom(_factory: unknown) {
            return undefined as never;
        },
        pasteToEditor() {},
        setEditorText() {},
        getEditorText() {
            return "";
        },
        addAutocompleteProvider() {},
        setEditorComponent() {},
        getEditorComponent() {
            return undefined;
        },
        theme: undefined as never,
        getAllThemes() {
            return [];
        },
        getTheme() {
            return undefined;
        },
        setTheme() {
            return { success: false, error: "Themes are not managed by Pi Desktop extension UI." };
        },
        getToolsExpanded() {
            return true;
        },
        setToolsExpanded() {},
    };
}
