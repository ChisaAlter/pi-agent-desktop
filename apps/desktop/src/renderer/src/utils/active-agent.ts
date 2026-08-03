import type { AgentTab } from "@shared";

/**
 * Resolve the renderer's active runtime without allowing a stale selection from
 * another workspace to leak into the current chat surface.
 */
export function resolveActiveAgent(
  agents: AgentTab[],
  workspaceId?: string | null,
  selection?: { agentId?: string | null; sessionId?: string | null },
): AgentTab | null {
  if (!workspaceId) return null;
  if (selection?.agentId) {
    const selected = agents.find((agent) =>
      agent.id === selection.agentId && agent.workspaceId === workspaceId,
    );
    if (selected) return selected;
  }
  if (selection?.sessionId) {
    const sessionAgent = agents.find((agent) =>
      agent.workspaceId === workspaceId && agent.sessionId === selection.sessionId,
    );
    if (sessionAgent) return sessionAgent;
  }
  return agents.find((agent) => agent.workspaceId === workspaceId && !agent.sessionId) ?? null;
}
