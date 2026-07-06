// Phase E Task 5.8 — Shared spawn handler for dream/distill subagents.
//
// Both the manual `/dream` `/distill` slash commands (chat.ipc.ts) and the
// automatic `AutoScheduler` need to spawn a dream/distill actor with the same
// tool wiring. This module factors that logic out so the two callers don't
// drift.

import type { ResourceLoader, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentRuntimeRegistry } from "../agent-runtime/registry";
import type { MemoryService } from "../long-horizon/memory-service";
import type { MarkdownMemoryService } from "../memory/markdown-memory-service";
import type { Workspace } from "@shared";
import { get as getSubagentType } from "./registry";
import type { SubagentManager, SubagentSpawnResult } from "./manager";
import { createMemoryTools } from "./tools/memory-tools";
import { createSessionSummaryTools } from "./tools/session-summary-tools";
import { createAssetInventoryTools } from "./tools/asset-inventory-tools";
import type { SessionSummaryService } from "./session-summary-service";

/** Subagent types that the spawn handler knows how to wire. */
export type SpawnableSubagentType = "dream" | "distill";

/**
 * Build the custom toolset injected into a spawned dream/distill subagent.
 *
 * - dream: sessionSummary tools (read recent sessions) + memory tools (search
 *   + write at project scope).
 * - distill: same as dream plus asset-inventory tools (skill / command / agent
 *   list).
 *
 * Missing optional services degrade gracefully: no `memoryService` → no memory
 * tools; no `sessionSummaryService` → no session summary tools; no
 * `resourceLoader` (distill only) → no inventory tools.
 */
export function buildSubagentCustomTools(input: {
    subagentType: SpawnableSubagentType;
    workspaceId: string;
    workspacePath: string;
    sessionId: string;
    memoryService?: MemoryService;
    markdownMemoryService?: MarkdownMemoryService;
    sessionSummaryService?: SessionSummaryService;
    resourceLoader?: ResourceLoader;
}): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    if (input.sessionSummaryService) {
        tools.push(...createSessionSummaryTools(input.sessionSummaryService));
    }
    if (input.memoryService) {
        tools.push(
            ...createMemoryTools(
                input.memoryService,
                {
                    workspaceId: input.workspaceId,
                    workspacePath: input.workspacePath,
                    sessionId: input.sessionId,
                    subagentType: input.subagentType,
                },
                undefined,
                input.markdownMemoryService,
            ),
        );
    }
    if (input.subagentType === "distill" && input.resourceLoader) {
        tools.push(...createAssetInventoryTools(input.resourceLoader));
    }
    return tools;
}

/**
 * Format a subagent result as a one-line summary suitable for injection into
 * the main agent's conversation via `promptInternal`. Returns an empty string
 * when the result has no useful text to surface.
 */
export function formatSubagentSummary(
    command: SpawnableSubagentType,
    result: { status: string; lastAssistantText?: string; error?: string },
): string {
    const tag = `[${command}]`;
    switch (result.status) {
        case "success":
            return `${tag} ${result.lastAssistantText ?? "completed"}`;
        case "cancelled":
            return `${tag} cancelled`;
        case "timeout":
            return `${tag} timed out`;
        case "failed":
            return `${tag} failed: ${result.error ?? "unknown error"}`;
        default:
            return "";
    }
}

/** Dependencies needed to spawn a dream/distill subagent. */
export interface SubagentSpawnHandlerDeps {
    subagentManager: SubagentManager;
    agentRegistry?: AgentRuntimeRegistry;
    memoryService?: MemoryService;
    markdownMemoryService?: MarkdownMemoryService;
    sessionSummaryService?: SessionSummaryService;
    resourceLoader?: ResourceLoader;
    /**
     * Persist the last successful run timestamp. Called once at spawn time
     * and again when the outcome settles.
     */
    setLastRunAt?: (workspaceId: string, type: SpawnableSubagentType, ts: number) => void;
}

export interface SpawnHandlerInput {
    workspaceId: string;
    workspacePath: string;
    agentId: string;
    subagentType: SpawnableSubagentType;
}

export interface SpawnHandlerResult {
    spawnResult: SubagentSpawnResult;
    /** The agentId that owns the spawned actor (for promptInternal injection). */
    agentId: string;
}

/**
 * Spawn a dream/distill subagent with the standard tool wiring and register
 * the outcome hook that persists `lastRunAt` and injects the summary into the
 * main agent's conversation.
 *
 * Returns the raw spawn result so the caller can format its own user-facing
 * message (e.g. chat.ipc.ts returns a slashInfo with the actorId).
 */
export async function spawnSubagent(
    deps: SubagentSpawnHandlerDeps,
    input: SpawnHandlerInput,
): Promise<SpawnHandlerResult> {
    const typeDef = getSubagentType(input.subagentType);
    if (!typeDef) {
        throw new Error(`/${input.subagentType} type not registered`);
    }
    // Prefer the explicitly-named agent; fall back to the workspace's default.
    const agent = input.agentId
        ? deps.agentRegistry?.list().find((a) => a.id === input.agentId)
        : deps.agentRegistry?.findDefaultAgent(input.workspaceId);
    if (!agent) {
        throw new Error(`/${input.subagentType} requires an active agent`);
    }
    const customTools = buildSubagentCustomTools({
        subagentType: input.subagentType,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        sessionId: agent.sessionId ?? agent.id,
        memoryService: deps.memoryService,
        markdownMemoryService: deps.markdownMemoryService,
        sessionSummaryService: deps.sessionSummaryService,
        resourceLoader: deps.resourceLoader,
    });
    const timeoutMs = input.subagentType === "dream" ? 10 * 60 * 1000 : 15 * 60 * 1000;
    const description =
        input.subagentType === "dream" ? "Memory consolidation" : "Workflow distillation";
    const spawnResult = await deps.subagentManager.spawn({
        context: {
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            agentId: agent.id,
        },
        subagentType: input.subagentType,
        description,
        prompt: typeDef.prompt,
        timeoutMs,
        toolAllowlist: typeDef.toolAllowlist,
        customTools,
    });
    deps.setLastRunAt?.(input.workspaceId, input.subagentType, Date.now());
    void spawnResult.outcome
        .then((result) => {
            deps.setLastRunAt?.(input.workspaceId, input.subagentType, Date.now());
            const summary = formatSubagentSummary(input.subagentType, result);
            if (summary) {
                deps.agentRegistry?.promptInternal(agent.id, summary).catch(() => {
                    // Inject failures are non-fatal — the user can read
                    // the result from the Subagent panel.
                });
            }
        })
        .catch(() => {
            // Swallow — spawn rejection was already surfaced via spawnResult
            // or the manager's own error handling.
        });
    return { spawnResult, agentId: agent.id };
}

/**
 * Build a SpawnHandler callback suitable for `AutoScheduler`. Mirrors
 * `spawnSubagent` but adapts the signature to `SpawnHandler` (which only
 * carries `{ workspaceId, agentId, subagentType }` — no `workspacePath`).
 */
export function createAutoSchedulerSpawnHandler(
    deps: SubagentSpawnHandlerDeps,
    getWorkspace: (workspaceId: string) => Workspace | undefined,
): (input: { workspaceId: string; agentId: string; subagentType: "dream" | "distill" }) => Promise<SubagentSpawnResult> {
    return async (input) => {
        const ws = getWorkspace(input.workspaceId);
        if (!ws) {
            throw new Error(`workspace ${input.workspaceId} not found`);
        }
        const result = await spawnSubagent(deps, {
            workspaceId: input.workspaceId,
            workspacePath: ws.path,
            agentId: input.agentId,
            subagentType: input.subagentType,
        });
        return result.spawnResult;
    };
}
