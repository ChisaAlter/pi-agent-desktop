// MiMoCode runtime capability map.
// Ported from XiaomiMiMo/MiMo-Code at 9c0a0c789d591730a9dc9710cb73434deba20a67.
// MIT License. Copyright (c) 2026 MiMo Code, Xiaomi Corporation.
// MIT License. Copyright (c) 2025 opencode.

import type { LongHorizonSettings, LongHorizonToggle } from "@shared";

export interface MiMoCodeAgentPort {
    id: string;
    mode: "primary" | "subagent";
    native: boolean;
    description: string;
    permissionProfile: "build" | "plan" | "compose" | "subagent";
}

export interface MiMoCodeRuntimeFeatures {
    planMode: LongHorizonToggle;
    composeMode: LongHorizonToggle;
    maxMode: { enabled: boolean; candidates: number };
    memory: {
        enabled: boolean;
        ccIndex: boolean;
        reconcileOnSearch: boolean;
        searchScoreFloor: number;
    };
    history: LongHorizonToggle;
    checkpoint: LongHorizonToggle;
    goal: LongHorizonToggle;
    task: LongHorizonToggle;
    actor: LongHorizonToggle;
    subagents: LongHorizonToggle;
    workflow: {
        enabled: boolean;
        maxConcurrentAgents: number;
        maxLifecycleAgents: number;
        maxDepth: number;
    };
    dream: LongHorizonToggle;
    distill: LongHorizonToggle;
}

export interface MiMoCodeRuntimePort {
    primaryAgents: MiMoCodeAgentPort[];
    systemAgents: MiMoCodeAgentPort[];
    enabledToolIds: string[];
    features: MiMoCodeRuntimeFeatures;
}

export const MIMOCODE_PRIMARY_AGENT_IDS = ["build", "plan", "compose", "max"] as const;

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
    max: {
        id: "max",
        mode: "primary",
        native: true,
        description: "Experimental Max mode. Runs parallel reasoning candidates and executes the best one.",
        permissionProfile: "build",
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

export function buildMiMoCodeRuntimePort(settings: LongHorizonSettings): MiMoCodeRuntimePort {
    const features = buildFeatureState(settings);
    const primaryAgents = [
        PRIMARY_AGENTS.build,
        ...(features.planMode.enabled ? [PRIMARY_AGENTS.plan] : []),
        ...(features.composeMode.enabled ? [PRIMARY_AGENTS.compose] : []),
        ...(features.maxMode.enabled ? [PRIMARY_AGENTS.max] : []),
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

function buildFeatureState(settings: LongHorizonSettings): MiMoCodeRuntimeFeatures {
    const enabled = settings.enabled;
    return {
        planMode: { enabled: enabled && settings.planMode.enabled },
        composeMode: { enabled: enabled && settings.composeMode.enabled },
        maxMode: {
            enabled: enabled && settings.maxMode.enabled,
            candidates: settings.maxMode.candidates ?? 5,
        },
        memory: {
            enabled: enabled && settings.memory.enabled,
            ccIndex: settings.memory.ccIndex ?? false,
            reconcileOnSearch: settings.memory.reconcileOnSearch ?? true,
            searchScoreFloor: settings.memory.searchScoreFloor ?? 0.15,
        },
        history: { enabled: enabled && settings.history.enabled },
        checkpoint: { enabled: enabled && settings.checkpoint.enabled },
        goal: { enabled: enabled && settings.goal.enabled },
        task: { enabled: enabled && settings.task.enabled },
        actor: { enabled: enabled && settings.actor.enabled },
        subagents: { enabled: enabled && settings.subagents.enabled },
        workflow: {
            enabled: enabled && settings.workflow.enabled,
            maxConcurrentAgents: settings.workflow.maxConcurrentAgents ?? 4,
            maxLifecycleAgents: settings.workflow.maxLifecycleAgents ?? 100,
            maxDepth: settings.workflow.maxDepth ?? 4,
        },
        dream: { enabled: enabled && settings.dream.enabled },
        distill: { enabled: enabled && settings.distill.enabled },
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
