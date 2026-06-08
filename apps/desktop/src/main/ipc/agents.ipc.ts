import { ipcMain } from "electron";
import type { CreateAgentInput, SendAgentPromptInput } from "@shared";
import type { AgentRuntimeRegistry } from "../services/agent-runtime/registry";

export function setupAgentsIpc(registry: AgentRuntimeRegistry): void {
    ipcMain.handle("agents:list", async () => registry.list());
    ipcMain.handle("agents:create", async (_event, input: CreateAgentInput) => registry.create(input));
    ipcMain.handle("agents:prompt", async (_event, input: SendAgentPromptInput) => registry.prompt(input));
    ipcMain.handle("agents:abort", async (_event, agentId: string) => registry.abort(agentId));
    ipcMain.handle("agents:stop", async (_event, agentId: string) => registry.stop(agentId));
    ipcMain.handle("agents:restart", async (_event, agentId: string) => registry.restart(agentId));
    ipcMain.handle("agents:messages", async (_event, agentId: string) => registry.getMessages(agentId));
    ipcMain.handle("agents:runtime-state", async (_event, agentId: string) => registry.getRuntimeState(agentId));
}
