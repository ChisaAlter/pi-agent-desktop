// UI Feature-Flag Adapter (NOT a runtime port).
//
// Returns a static capability manifest — agent IDs, tool IDs, and feature
// toggles — consumed by the `pi:runtime-feature-state` IPC handler so the
// React UI can render a capabilities list. Performs no I/O, launches no
// runtime, and imports no MiMo-Code packages.
//
// The agent IDs and tool IDs are transcribed from MiMo-Code's vocabulary
// for UI display purposes only. The actual runtime is the Pi CLI SDK
// (`@earendil-works/pi-coding-agent`), wired in `pi-session/factory.ts`
// and `agent-runtime/registry.ts`.
//
// `dream` and `distill` features are marked `unsupportedToggle(...)` because
// their long-horizon runtime is not yet implemented in Pi Desktop.
//
// Vocabulary sourced from XiaomiMiMo/MiMo-Code at 9c0a0c789d591730a9dc9710cb73434deba20a67.
// MIT License. Copyright (c) 2026 MiMo Code, Xiaomi Corporation.
// MIT License. Copyright (c) 2025 opencode.

import type {
    LongHorizonLoadedFrom,
    LongHorizonRuntimeMeta,
    LongHorizonRuntimeToggle,
    LongHorizonSettings,
} from "@shared";

export interface MiMoCodeAgentPort {
    id: string;
    mode: "primary" | "subagent";
    native: boolean;
    description: string;
    permissionProfile: "build" | "plan" | "compose" | "subagent";
}

export interface MiMoCodeRuntimeFeatures {
    planMode: LongHorizonRuntimeToggle;
    composeMode: LongHorizonRuntimeToggle;
    maxMode: LongHorizonRuntimeMeta & { enabled: boolean; candidates: number };
    memory: LongHorizonRuntimeMeta & {
        enabled: boolean;
        ccIndex: boolean;
        reconcileOnSearch: boolean;
        searchScoreFloor: number;
    };
    history: LongHorizonRuntimeToggle;
    checkpoint: LongHorizonRuntimeToggle;
    goal: LongHorizonRuntimeToggle;
    task: LongHorizonRuntimeToggle;
    actor: LongHorizonRuntimeToggle;
    subagents: LongHorizonRuntimeToggle;
    workflow: LongHorizonRuntimeMeta & {
        enabled: boolean;
        maxConcurrentAgents: number;
        maxLifecycleAgents: number;
        maxDepth: number;
    };
    dream: LongHorizonRuntimeToggle;
    distill: LongHorizonRuntimeToggle;
}

export interface MiMoCodeRuntimePort {
    primaryAgents: MiMoCodeAgentPort[];
    systemAgents: MiMoCodeAgentPort[];
    enabledToolIds: string[];
    features: MiMoCodeRuntimeFeatures;
}

export interface MiMoCodeRuntimeSupportOptions {
    planModeSupported?: boolean;
    composeModeSupported?: boolean;
    workflowSupported?: boolean;
}

export const MIMOCODE_PRIMARY_AGENT_IDS = ["build", "plan", "compose"] as const;

export const MIMOCODE_SYSTEM_AGENT_IDS = [
    "checkpoint-writer",
    "dream",
    "distill",
] as const;

export const MIMOCODE_TOOL_IDS = [
    "invalid",
    "bash",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "actor",
    "fetch",
    "search",
    "code",
    "skill",
    "patch",
    "changedir",
    "question",
    "lsp",
    "planenter",
    "planexit",
    "memory",
    "history",
    "task",
    "workflow",
] as const;

const PRIMARY_AGENTS: Record<(typeof MIMOCODE_PRIMARY_AGENT_IDS)[number], MiMoCodeAgentPort> = {
    build: {
        id: "build",
        mode: "primary",
        native: true,
        description: "Executes tools based on configured permissions.",
        permissionProfile: "build",
    },
    plan: {
        id: "plan",
        mode: "primary",
        native: true,
        description: "Plan mode. Disallows all edit tools except plan markdown files.",
        permissionProfile: "plan",
    },
    compose: {
        id: "compose",
        mode: "primary",
        native: true,
        description: "Compose mode. Orchestrates workflows with built-in compose skills.",
        permissionProfile: "compose",
    },
};

const SYSTEM_AGENTS: Record<(typeof MIMOCODE_SYSTEM_AGENT_IDS)[number], MiMoCodeAgentPort> = {
    "checkpoint-writer": {
        id: "checkpoint-writer",
        mode: "subagent",
        native: true,
        description: "Writes structured checkpoints for context recovery.",
        permissionProfile: "subagent",
    },
    dream: {
        id: "dream",
        mode: "subagent",
        native: true,
        description: "Background organization agent for long-horizon context.",
        permissionProfile: "subagent",
    },
    distill: {
        id: "distill",
        mode: "subagent",
        native: true,
        description: "Distills long conversations into durable memory and skills.",
        permissionProfile: "subagent",
    },
};

export function buildMiMoCodeRuntimePort(
    settings: LongHorizonSettings,
    support: MiMoCodeRuntimeSupportOptions = {},
): MiMoCodeRuntimePort {
    const features = buildFeatureState(settings, support);
    const primaryAgents = [
        PRIMARY_AGENTS.build,
        ...(features.planMode.enabled ? [PRIMARY_AGENTS.plan] : []),
        ...(features.composeMode.enabled ? [PRIMARY_AGENTS.compose] : []),
    ];
    const systemAgents = settings.subagents.enabled ? [
        SYSTEM_AGENTS["checkpoint-writer"],
        ...(features.dream.enabled ? [SYSTEM_AGENTS.dream] : []),
        ...(features.distill.enabled ? [SYSTEM_AGENTS.distill] : []),
    ] : [];

    return {
        primaryAgents,
        systemAgents,
        enabledToolIds: enabledToolIds(features),
        features,
    };
}

function buildFeatureState(
    settings: LongHorizonSettings,
    support: MiMoCodeRuntimeSupportOptions = {},
): MiMoCodeRuntimeFeatures {
    const enabled = settings.enabled;
    const unsupportedReason = "Pi Desktop 暂未实现该长程 runtime。";
    return {
        planMode: conditionalToggle(
            enabled,
            settings.planMode.enabled,
            support.planModeSupported ?? true,
            "pi-openplan",
            "Pi Desktop 未找到 pi-openplan plan runtime。",
        ),
        composeMode: conditionalToggle(
            enabled,
            settings.composeMode.enabled,
            support.composeModeSupported ?? true,
            "desktop",
            "Pi Desktop 未找到 compose runtime bundle。",
        ),
        maxMode: {
            ...unsupportedMeta("Pi Desktop 已移除 Max mode。"),
            enabled: false,
            candidates: settings.maxMode.candidates ?? 5,
        },
        memory: {
            ...supportedMeta(enabled && settings.memory.enabled, "desktop"),
            enabled: enabled && settings.memory.enabled,
            ccIndex: settings.memory.ccIndex ?? false,
            reconcileOnSearch: settings.memory.reconcileOnSearch ?? true,
            searchScoreFloor: settings.memory.searchScoreFloor ?? 0.15,
        },
        history: supportedToggle(enabled, settings.history.enabled, "desktop"),
        checkpoint: supportedToggle(enabled, settings.checkpoint.enabled, "desktop"),
        goal: supportedToggle(enabled, settings.goal.enabled, "desktop"),
        task: supportedToggle(enabled, settings.task.enabled, "desktop"),
        actor: supportedToggle(enabled, settings.actor.enabled, "desktop"),
        subagents: supportedToggle(enabled, settings.subagents.enabled, "desktop"),
        workflow: {
            ...conditionalToggle(
                enabled,
                settings.workflow.enabled,
                support.workflowSupported ?? support.composeModeSupported ?? true,
                "desktop",
                "Pi Desktop 未找到 workflow runtime bundle。",
            ),
            enabled: enabled && settings.workflow.enabled && (support.workflowSupported ?? support.composeModeSupported ?? true),
            maxConcurrentAgents: settings.workflow.maxConcurrentAgents ?? 4,
            maxLifecycleAgents: settings.workflow.maxLifecycleAgents ?? 100,
            maxDepth: settings.workflow.maxDepth ?? 4,
        },
        dream: unsupportedToggle(unsupportedReason),
        distill: unsupportedToggle(unsupportedReason),
    };
}

function enabledToolIds(features: MiMoCodeRuntimeFeatures): string[] {
    const disabled = new Set<string>();
    if (!features.memory.enabled) disabled.add("memory");
    if (!features.history.enabled) disabled.add("history");
    if (!features.task.enabled) disabled.add("task");
    if (!features.actor.enabled) disabled.add("actor");
    if (!features.workflow.enabled) disabled.add("workflow");
    if (!features.planMode.enabled) {
        disabled.add("planenter");
        disabled.add("planexit");
    }
    return MIMOCODE_TOOL_IDS.filter((id) => !disabled.has(id));
}

function supportedToggle(
    longHorizonEnabled: boolean,
    featureEnabled: boolean,
    loadedFromWhenEnabled: Extract<LongHorizonLoadedFrom, "desktop" | "pi-openplan">,
): LongHorizonRuntimeToggle {
    const enabled = longHorizonEnabled && featureEnabled;
    return {
        enabled,
        ...supportedMeta(enabled, loadedFromWhenEnabled),
    };
}

function conditionalToggle(
    longHorizonEnabled: boolean,
    featureEnabled: boolean,
    runtimeSupported: boolean,
    loadedFromWhenEnabled: Extract<LongHorizonLoadedFrom, "desktop" | "pi-openplan">,
    unsupportedReason: string,
): LongHorizonRuntimeToggle {
    if (!runtimeSupported) {
        return unsupportedToggle(unsupportedReason);
    }
    if (!longHorizonEnabled || !featureEnabled) {
        return {
            enabled: false,
            ...supportedMeta(false, loadedFromWhenEnabled),
        };
    }
    return supportedToggle(longHorizonEnabled, featureEnabled, loadedFromWhenEnabled);
}

function supportedMeta(
    enabled: boolean,
    loadedFromWhenEnabled: Extract<LongHorizonLoadedFrom, "desktop" | "pi-openplan">,
): LongHorizonRuntimeMeta {
    return {
        supported: true,
        loadedFrom: enabled ? loadedFromWhenEnabled : "disabled",
    };
}

function unsupportedToggle(reason: string): LongHorizonRuntimeToggle {
    return {
        enabled: false,
        ...unsupportedMeta(reason),
    };
}

function unsupportedMeta(reason: string): LongHorizonRuntimeMeta {
    return {
        supported: false,
        loadedFrom: "unsupported",
        reason,
    };
}
