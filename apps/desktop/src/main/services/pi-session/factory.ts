// AgentSession Factory (M1 Task 5)
// 为每个 workspace 创建一个 Pi AgentSession 实例
// 不起子进程, 直接 in-process 调用

import { createRequire } from "module";
import { existsSync } from "fs";
import { dirname, join } from "path";
import log from "electron-log/main";
import type {
    AgentSession,
    AuthStorage,
    ExtensionUIContext,
    ModelRegistry,
    ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { PiThinkingLevel } from "@shared";
import type { PiAgentConfig } from "../../types";
import { createGuardedBuiltins } from "../permission/guarded-tools";
import type { RuntimeToolPolicy } from "../permission/runtime-policy";
import { loadPiSdk } from "./sdk-runtime";

const require = createRequire(__filename);
type RegisteredProviderConfig = Parameters<ModelRegistry["registerProvider"]>[1];
type RegisteredApi = RegisteredProviderConfig["api"];
type RegisteredProviderModel = NonNullable<RegisteredProviderConfig["models"]>[number];

export interface WorkspaceSession {
    workspaceId: string;
    session: AgentSession;
    setModel: (provider: string, modelId: string) => Promise<boolean>;
    modelFallbackMessage?: string;
    dispose: () => void;
}

export interface DesktopExtensionCapabilityOptions {
    planModeEnabled?: boolean;
    generatedUiEnabled?: boolean;
    composeModeEnabled?: boolean;
    workflowEnabled?: boolean;
    composeWorkflowEnabled?: boolean;
}

export interface CreateSessionOpts {
    workspaceId: string;
    workspacePath: string;
    modelId?: string;
    provider?: string;
    thinkingLevel?: PiThinkingLevel;
    autoCompactionEnabled?: boolean;
    agentDir?: string;
    piAgentConfig?: PiAgentConfig | null;
    sessionPath?: string;
    uiContext?: ExtensionUIContext;
    tools?: string[];
    noTools?: "all" | "builtin";
    customTools?: ToolDefinition[];
    getRuntimePolicy?: () => RuntimeToolPolicy;
    desktopExtensions?: string[];
}

type SendUserMessageFn = AgentSession["sendUserMessage"];

export async function createWorkspaceSession(opts: CreateSessionOpts): Promise<WorkspaceSession> {
    const sdk = await loadPiSdk();
    const agentDir = opts.agentDir ?? sdk.getAgentDir();
    const authStorage = sdk.AuthStorage.create(join(agentDir, "auth.json"));
    const modelRegistry = sdk.ModelRegistry.create(authStorage, join(agentDir, "models.json"));
    await registerConfiguredProviders(modelRegistry, authStorage, opts.piAgentConfig);
    await assertSelectedModelHasCredentials(authStorage, opts);
    const selectedModel = opts.provider && opts.modelId
        ? modelRegistry.find(opts.provider, opts.modelId)
        : undefined;
    const settingsManager = sdk.SettingsManager.create(opts.workspacePath, agentDir);
    const additionalExtensionPaths = resolveDesktopExtensionPaths(opts.desktopExtensions);
    const eventBus = sdk.createEventBus();
    const resourceLoader = new sdk.DefaultResourceLoader({
        cwd: opts.workspacePath,
        agentDir,
        eventBus,
        settingsManager,
        additionalExtensionPaths,
    });
    await resourceLoader.reload();
    const customTools = opts.getRuntimePolicy
        ? [...(opts.customTools ?? []), ...createGuardedBuiltins(opts.workspacePath, opts.getRuntimePolicy)]
        : opts.customTools;

    const { session, modelFallbackMessage } = await sdk.createAgentSession({
        cwd: opts.workspacePath,
        agentDir,
        authStorage,
        modelRegistry,
        settingsManager,
        model: selectedModel,
        thinkingLevel: opts.thinkingLevel,
        tools: opts.tools,
        noTools: opts.noTools,
        customTools,
        resourceLoader,
        sessionManager: opts.sessionPath ? sdk.SessionManager.open(opts.sessionPath) : undefined,
    });
    patchExtensionSendUserMessage(session);
    if (opts.autoCompactionEnabled !== undefined) {
        session.setAutoCompactionEnabled(opts.autoCompactionEnabled);
    }
    if (opts.uiContext) {
        await session.bindExtensions({ uiContext: opts.uiContext });
    }

    return {
        workspaceId: opts.workspaceId,
        session,
        modelFallbackMessage,
        setModel: async (provider, modelId) => {
            const model = modelRegistry.find(provider, modelId);
            if (!model) return false;
            await session.setModel(model);
            return true;
        },
        dispose: () => {
            try {
                session.dispose();
            } catch (err) {
                log.warn("[factory] session dispose error:", err);
            }
        },
    };
}

function patchExtensionSendUserMessage(session: AgentSession): void {
    const target = session as AgentSession & {
        isStreaming?: boolean;
        sendUserMessage?: SendUserMessageFn;
        __piDesktopPatchedSendUserMessage?: boolean;
    };
    if (target.__piDesktopPatchedSendUserMessage) return;
    if (typeof target.sendUserMessage !== "function") return;
    const original = target.sendUserMessage.bind(session) as SendUserMessageFn;
    target.sendUserMessage = (async (content, options) => {
        if (options?.deliverAs) {
            await original(content, options);
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (target.isStreaming) {
            await original(content, { deliverAs: "followUp" });
            return;
        }
        await original(content, options);
    }) as SendUserMessageFn;
    target.__piDesktopPatchedSendUserMessage = true;
}

function safeResolve(packageName: string, map: (resolved: string) => string = (resolved) => resolved): string | undefined {
    try {
        return map(require.resolve(packageName));
    } catch {
        return undefined;
    }
}

/**
 * Whether the bundled `pi-permission-system` extension resolved successfully.
 *
 * The approval interceptor's high-risk branch is fail-open by design: it
 * delegates runtime permission decisions to this extension and never
 * aborts/approves itself. If the extension is missing (packaging regression,
 * version mismatch, first-run extraction failure), high-risk tool calls
 * would execute with NO gate at all. This cached probe lets the interceptor
 * flip that branch to fail-closed (abort + extension_error) until the
 * extension is available again.
 */
let permissionSystemAvailable: boolean | undefined;
export function isPermissionSystemAvailable(): boolean {
    if (permissionSystemAvailable === undefined) {
        permissionSystemAvailable = safeResolve("pi-permission-system") !== undefined;
    }
    return permissionSystemAvailable;
}

export function resolveBundledDesktopExtensionPaths(
    options: DesktopExtensionCapabilityOptions = {},
): string[] {
    const paths: Array<string | undefined> = [];
    if (options.generatedUiEnabled) {
        paths.push(resolveBundledGeneratedUiExtensionPath());
    }
    if (options.planModeEnabled) {
        paths.push(safeResolve("pi-openplan/package.json", (packageJson) => dirname(packageJson)));
    }
    if (options.composeModeEnabled) {
        paths.push(resolveBundledComposeExtensionPath());
    }
    if (options.workflowEnabled || options.composeWorkflowEnabled) {
        paths.push(resolveBundledComposeExtensionPath(__dirname, "workflow-extension.ts"));
    }
    return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function resolveBundledComposeExtensionPath(
    baseDir = __dirname,
    entryFile = "index.ts",
    resourcesDir = typeof process.resourcesPath === "string" ? process.resourcesPath : undefined,
): string | undefined {
    const candidates = [
        resourcesDir ? join(resourcesDir, "extensions/compose-mode", entryFile) : undefined,
        join(baseDir, "../../../../extensions/compose-mode", entryFile),
        join(baseDir, "../../../extensions/compose-mode", entryFile),
        join(baseDir, "../../extensions/compose-mode", entryFile),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
}

export function resolveBundledGeneratedUiExtensionPath(
    baseDir = __dirname,
    resourcesDir = typeof process.resourcesPath === "string" ? process.resourcesPath : undefined,
): string | undefined {
    const candidates = [
        resourcesDir ? join(resourcesDir, "extensions/generated-ui/index.ts") : undefined,
        join(baseDir, "../../../../extensions/generated-ui/index.ts"),
        join(baseDir, "../../../extensions/generated-ui/index.ts"),
        join(baseDir, "../../extensions/generated-ui/index.ts"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
}

function resolveDesktopExtensionPaths(explicitDesktopExtensions?: string[]): string[] {
    const paths = [
        safeResolve("pi-permission-system"),
        ...(explicitDesktopExtensions ?? []),
    ].filter((path): path is string => Boolean(path));
    return [...new Set(paths)];
}

async function registerConfiguredProviders(
    modelRegistry: ModelRegistry,
    authStorage: AuthStorage,
    config?: PiAgentConfig | null,
): Promise<void> {
    for (const provider of config?.providers ?? []) {
        if (!provider.baseUrl || provider.models.length === 0) continue;
        const apiKey = await resolveConfiguredProviderApiKey(authStorage, provider, config);
        if (!apiKey) continue;
        modelRegistry.registerProvider(provider.id, {
            name: provider.name,
            baseUrl: provider.baseUrl,
            apiKey,
            api: toApi(provider.api),
            headers: provider.headers,
            authHeader: provider.authHeader,
            models: provider.models.map((model) => ({
                id: model.id,
                name: model.name,
                api: toApi(model.api ?? provider.api),
                baseUrl: model.baseUrl,
                reasoning: model.reasoning ?? false,
                thinkingLevelMap: model.thinkingLevelMap,
                input: normalizeModelInput(model.input),
                cost: normalizeModelCost(model.cost),
                contextWindow: model.contextWindow ?? 128000,
                maxTokens: model.maxTokens ?? 16384,
                headers: model.headers,
                compat: model.compat as RegisteredProviderModel["compat"],
            })),
        });
    }
}

function normalizeModelCost(cost?: PiAgentConfig["providers"][number]["models"][number]["cost"]): RegisteredProviderModel["cost"] {
    return {
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cacheRead: cost?.cacheRead ?? 0,
        cacheWrite: cost?.cacheWrite ?? 0,
    };
}

async function assertSelectedModelHasCredentials(
    authStorage: AuthStorage,
    opts: Pick<CreateSessionOpts, "provider" | "modelId" | "piAgentConfig">,
): Promise<void> {
    if (!opts.provider || !opts.modelId) return;
    const provider = opts.piAgentConfig?.providers.find((candidate) => candidate.id === opts.provider);
    if (!provider?.models.some((model) => model.id === opts.modelId)) return;
    const apiKey = await resolveConfiguredProviderApiKey(authStorage, provider, opts.piAgentConfig);
    if (apiKey) return;
    throw new Error(
        `模型 ${provider.id} / ${opts.modelId} 未配置 API Key，请在设置 > 模型中补充凭据后重试。`,
    );
}

async function resolveConfiguredProviderApiKey(
    authStorage: AuthStorage,
    provider: NonNullable<PiAgentConfig["providers"]>[number],
    config?: PiAgentConfig | null,
): Promise<string | undefined> {
    const direct = await authStorage.getApiKey(provider.id) ?? resolveProviderApiKey(provider.apiKey);
    if (direct || !provider.baseUrl) return direct;

    const normalizedBaseUrl = normalizeBaseUrl(provider.baseUrl);
    const renameRemnants = (config?.providers ?? []).filter((candidate) =>
        candidate.id !== provider.id
        && candidate.models.length === 0
        && Boolean(candidate.baseUrl)
        && normalizeBaseUrl(candidate.baseUrl ?? "") === normalizedBaseUrl,
    );
    for (const candidate of renameRemnants) {
        const inherited = await authStorage.getApiKey(candidate.id) ?? resolveProviderApiKey(candidate.apiKey);
        if (!inherited) continue;
        log.warn(
            `[factory] recovering API key for renamed provider ${provider.id} from orphaned provider ${candidate.id}`,
        );
        return inherited;
    }
    return undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

function resolveProviderApiKey(apiKey?: string): string | undefined {
    const trimmed = apiKey?.trim();
    if (!trimmed) return undefined;
    return process.env[trimmed] || trimmed;
}

function normalizeModelInput(input?: string[]): Array<"text" | "image"> {
    const normalized = (input ?? ["text"]).filter((item): item is "text" | "image" => item === "text" || item === "image");
    return normalized.length > 0 ? normalized : ["text"];
}

function toApi(api?: string): RegisteredApi {
    return api as RegisteredApi;
}
