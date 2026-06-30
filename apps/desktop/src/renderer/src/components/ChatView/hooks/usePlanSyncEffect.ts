// Extracted from ChatView.tsx (SubTask 7.2).
// Syncs the active plan card from the plan store into the current conversation
// (either the agent stream or the session message list), de-duping via the
// rendered plan card id tracker. Runs as a side-effect hook: returns nothing.

import { useEffect, useMemo } from "react";
import type { AgentMessage } from "@shared";
import { useAgentStore } from "../../../stores/agent-store";
import { useSessionStore } from "../../../stores/session-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { usePlanStore } from "../../../stores/plan-store";
import {
  findReusablePlanMessage,
  isLockedPlanPhase,
  samePlanIdentity,
  stripPlanFrontmatter,
} from "../plan-utils";
import { useRenderedPlanCardIds } from "./useRenderedPlanCardIds";

const EMPTY_AGENT_MESSAGES: AgentMessage[] = [];

export function usePlanSyncEffect(
  currentSessionId: string | null,
  isStreaming: boolean,
): void {
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const agents = useAgentStore((state) => state.agents);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);

  const currentAgent = useMemo(() => {
    if (!currentWorkspace) return null;
    if (currentSessionId) {
      const sessionAgent = agents.find(
        (agent) => agent.workspaceId === currentWorkspace.id && agent.sessionId === currentSessionId,
      );
      if (sessionAgent) return sessionAgent;
    }
    if (!currentSessionId) return null;
    const selectedAgent = currentAgentId
      ? agents.find(
          (agent) => agent.id === currentAgentId && agent.workspaceId === currentWorkspace.id && !agent.sessionId,
        )
      : undefined;
    return (
      selectedAgent
      ?? agents.find((agent) => agent.workspaceId === currentWorkspace.id && !agent.sessionId)
      ?? null
    );
  }, [agents, currentAgentId, currentSessionId, currentWorkspace]);

  const agentId = currentAgent?.id ?? null;
  const agentMessages = useAgentStore((state) =>
    agentId ? state.messagesByAgent[agentId] ?? EMPTY_AGENT_MESSAGES : EMPTY_AGENT_MESSAGES,
  );
  const currentSession = useSessionStore(
    (state) => state.sessions.find((s) => s.id === currentSessionId) ?? null,
  );
  const hasAgent = Boolean(currentAgent);
  const shouldUseSessionMessages = Boolean(currentSession);

  const activePlanCard = usePlanStore((state) => state.activeCard);
  const activePlanExecution = usePlanStore((state) => state.activeExecution);
  const renderedPlanCardIds = useRenderedPlanCardIds();

  useEffect(() => {
    if (
      !activePlanCard
      || renderedPlanCardIds.includes(activePlanCard.id)
      || isStreaming
    ) return;
    const cleanContent = stripPlanFrontmatter(
      activePlanCard.content
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*$/gi, "")
        .trim(),
    );
    const planAction = {
      id: `plan_action_${activePlanCard.id}`,
      title: activePlanCard.title,
      filename: activePlanCard.filename,
      status: "pending" as const,
    };
    const shouldKeepCurrentExecution = Boolean(
      activePlanExecution
      && isLockedPlanPhase(activePlanExecution.phase)
      && samePlanIdentity(activePlanExecution, activePlanCard),
    );
    if (!shouldUseSessionMessages && hasAgent && currentAgent) {
      const reusableAgentMessage = findReusablePlanMessage(
        agentMessages,
        activePlanCard,
        activePlanExecution?.sourceMessageId,
      );
      const messageId = reusableAgentMessage?.id ?? `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (reusableAgentMessage) {
        useAgentStore.getState().updateStreamMessage(currentAgent.id, messageId, {
          content: cleanContent,
          planAction: {
            ...(reusableAgentMessage.planAction ?? {}),
            ...planAction,
            title: activePlanCard.title,
            filename: activePlanCard.filename ?? reusableAgentMessage.planAction?.filename,
            status: reusableAgentMessage.planAction?.status ?? planAction.status,
          },
        });
      } else {
        useAgentStore.getState().appendStreamMessage(currentAgent.id, {
          id: messageId,
          agentId: currentAgent.id,
          role: "assistant",
          content: cleanContent,
          createdAt: Date.now(),
          planAction,
        });
      }
      usePlanStore.getState().markPlanCardRendered(activePlanCard.id);
      if (!shouldKeepCurrentExecution) {
        usePlanStore.getState().setAwaitingConfirmation({
          activePlanId: activePlanCard.id,
          title: activePlanCard.title,
          filename: activePlanCard.filename,
          sourceMessageId: messageId,
        });
      }
      return;
    }
    if (currentSession) {
      const reusableSessionMessage = findReusablePlanMessage(
        currentSession.messages,
        activePlanCard,
        activePlanExecution?.sourceMessageId,
      );
      const messageId = reusableSessionMessage?.id ?? `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (reusableSessionMessage) {
        useSessionStore.getState().updateMessage(currentSession.id, messageId, {
          content: cleanContent,
          planAction: {
            ...(reusableSessionMessage.planAction ?? {}),
            ...planAction,
            title: activePlanCard.title,
            filename: activePlanCard.filename ?? reusableSessionMessage.planAction?.filename,
            status: reusableSessionMessage.planAction?.status ?? planAction.status,
          },
        });
      } else {
        useSessionStore.getState().addMessage(currentSession.id, {
          id: messageId,
          role: "assistant",
          content: cleanContent,
          timestamp: new Date(),
          planAction,
        });
      }
      usePlanStore.getState().markPlanCardRendered(activePlanCard.id);
      if (!shouldKeepCurrentExecution) {
        usePlanStore.getState().setAwaitingConfirmation({
          activePlanId: activePlanCard.id,
          title: activePlanCard.title,
          filename: activePlanCard.filename,
          sourceMessageId: messageId,
        });
      }
    }
  }, [
    activePlanCard,
    activePlanExecution,
    agentMessages,
    currentAgent,
    currentSession,
    hasAgent,
    isStreaming,
    renderedPlanCardIds,
    shouldUseSessionMessages,
  ]);
}
