import { ipcMain } from "electron";
import { ipcError, type AgentMode, type CreateAgentInput, type PiThinkingLevel, type SendAgentPromptInput } from "@shared";
import type { AgentRuntimeRegistry } from "../services/agent-runtime/registry";
import { agentsCreateSchema, agentsPromptSchema, agentsIdSchema, agentsSetThinkingSchema, agentsSetModeSchema, agentsWorkspaceSessionSchema, agentsActiveSelectionSchema } from "./schemas";

// 统一契约: 所有 handler 用 safeParse 校验, 失败返回结构化 ipcError 而不是让
// ZodError 穿越 IPC (否则渲染层收到的是 "Error invoking remote method" 泛化错误).
function parseOrError<T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    value: unknown,
): { ok: true; data: T } | { ok: false } {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false };
    return { ok: true, data: parsed.data as T };
}

export function setupAgentsIpc(registry: AgentRuntimeRegistry): void {
    ipcMain.handle("agents:list", async () => {
        try {
            return registry.list();
        } catch (error) {
            return ipcError("ipcErrors.agents.listFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:list-by-workspace", async (_event, workspaceId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [workspaceId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "workspaceId must be a non-empty string");
        try {
            return registry.listByWorkspace(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.listFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:find-by-session", async (_event, sessionId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [sessionId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "sessionId must be a non-empty string");
        try {
            return registry.findBySessionId(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.findFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:find-by-workspace-session", async (_event, workspaceId: string, sessionId: string) => {
        const parsed = parseOrError<[string, string]>(agentsWorkspaceSessionSchema, [workspaceId, sessionId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "workspaceId and sessionId must be non-empty strings");
        try {
            return registry.findByWorkspaceAndSession(parsed.data[0], parsed.data[1]);
        } catch (error) {
            return ipcError("ipcErrors.agents.findFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:resolve-active", async (_event, workspaceId: string, selection?: { agentId?: string; sessionId?: string }) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [workspaceId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "workspaceId must be a non-empty string");
        const selectionParsed = agentsActiveSelectionSchema.safeParse(selection);
        if (!selectionParsed.success) {
            return ipcError("ipcErrors.agents.invalidSelection", "agentId/sessionId must be non-empty strings");
        }
        try {
            return registry.resolveActiveAgent(parsed.data[0], selectionParsed.data);
        } catch (error) {
            return ipcError("ipcErrors.agents.resolveFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:create", async (_event, input: CreateAgentInput) => {
        const parsed = agentsCreateSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.agents.invalidCreateInput", "无效的 Agent 创建参数");
        }
        try {
            return await registry.create(parsed.data);
        } catch (error) {
            return ipcError(
                "ipcErrors.agents.createFailed",
                error instanceof Error ? error.message : String(error),
            );
        }
    });
    ipcMain.handle("agents:prompt", async (_event, input: SendAgentPromptInput) => {
        const parsed = agentsPromptSchema.safeParse(input);
        if (!parsed.success) {
            return ipcError("ipcErrors.agents.invalidPrompt", "无效的提示词参数");
        }
        try {
            return registry.prompt(parsed.data);
        } catch (error) {
            return ipcError(
                "ipcErrors.agents.promptFailed",
                error instanceof Error ? error.message : String(error),
            );
        }
    });
    ipcMain.handle("agents:abort", async (_event, agentId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [agentId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        try {
            return registry.abort(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.abortFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:abort-by-session", async (_event, sessionId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [sessionId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "sessionId must be a non-empty string");
        try {
            return registry.abortBySession(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.abortFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:abort-workspace", async (_event, workspaceId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [workspaceId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "workspaceId must be a non-empty string");
        try {
            return registry.abortWorkspace(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.abortFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:stop", async (_event, agentId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [agentId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        try {
            return registry.stop(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.stopFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:stop-by-session", async (_event, sessionId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [sessionId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "sessionId must be a non-empty string");
        try {
            return registry.stopBySession(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.stopFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:stop-workspace", async (_event, workspaceId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [workspaceId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "workspaceId must be a non-empty string");
        try {
            return registry.stopWorkspace(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.stopFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:restart", async (_event, agentId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [agentId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        try {
            return registry.restart(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.restartFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:messages", async (_event, agentId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [agentId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        try {
            return registry.getMessages(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.messagesFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:runtime-state", async (_event, agentId: string) => {
        const parsed = parseOrError<[string]>(agentsIdSchema, [agentId]);
        if (!parsed.ok) return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        try {
            return registry.getRuntimeState(parsed.data[0]);
        } catch (error) {
            return ipcError("ipcErrors.agents.runtimeStateFailed", error instanceof Error ? error.message : String(error));
        }
    });
    ipcMain.handle("agents:set-thinking", async (_event, agentId: string, level: PiThinkingLevel) => {
        const parsed = agentsSetThinkingSchema.safeParse([agentId, level]);
        if (!parsed.success) {
            return ipcError("ipcErrors.agents.invalidThinkingLevel", "无效的思考强度");
        }
        try {
            return registry.setThinking(parsed.data[0], parsed.data[1]);
        } catch (error) {
            return ipcError(
                "ipcErrors.agents.setThinkingFailed",
                error instanceof Error ? error.message : String(error),
            );
        }
    });
    ipcMain.handle("agents:set-mode", async (_event, agentId: string, mode: AgentMode) => {
        const parsed = agentsSetModeSchema.safeParse([agentId, mode]);
        if (!parsed.success) {
            return ipcError("ipcErrors.agents.invalidAgentMode", "无效的 Agent 模式");
        }
        try {
            return await registry.setMode(parsed.data[0], parsed.data[1]);
        } catch (error) {
            return ipcError(
                "ipcErrors.agents.setModeFailed",
                error instanceof Error ? error.message : String(error),
            );
        }
    });
    ipcMain.handle("agents:sync-permissions", async (_event, agentId: string) => {
        const parsed = agentsIdSchema.safeParse([agentId]);
        if (!parsed.success) {
            return ipcError("ipcErrors.agents.invalidAgentId", "agentId must be a non-empty string");
        }
        try {
            return await registry.syncPermissions(parsed.data[0]);
        } catch (error) {
            return ipcError(
                "ipcErrors.agents.syncPermissionsFailed",
                error instanceof Error ? error.message : String(error),
            );
        }
    });
}
