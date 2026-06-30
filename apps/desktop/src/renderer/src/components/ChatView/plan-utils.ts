// Shared plan helpers extracted from ChatView for reuse by usePlanSyncEffect.

import type { Message } from "../../stores/session-store";

export type PlanIdentity = {
  title?: string;
  filename?: string;
};

export type PlanMessageLike = {
  id: string;
  planAction?: Message["planAction"];
};

export function stripPlanFrontmatter(content: string): string {
  return content.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n*/u, "").trim();
}

export function normalizePlanIdentity(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function samePlanIdentity(left: PlanIdentity, right: PlanIdentity): boolean {
  const leftFilename = normalizePlanIdentity(left.filename);
  const rightFilename = normalizePlanIdentity(right.filename);
  if (leftFilename && rightFilename) {
    return leftFilename === rightFilename;
  }
  const leftTitle = normalizePlanIdentity(left.title);
  const rightTitle = normalizePlanIdentity(right.title);
  return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

export function isLockedPlanPhase(phase?: string): boolean {
  return phase === "executing" || phase === "pausing" || phase === "paused" || phase === "completed";
}

export function isReusablePlanStatus(status?: NonNullable<Message["planAction"]>["status"]): boolean {
  return status !== "executed" && status !== "cancelled" && status !== "failed";
}

export function findReusablePlanMessage<T extends PlanMessageLike>(
  messages: T[],
  target: PlanIdentity,
  preferredMessageId?: string | null,
): T | undefined {
  if (preferredMessageId) {
    const preferred = messages.find((message) => (
      message.id === preferredMessageId
      && message.planAction
      && isReusablePlanStatus(message.planAction.status)
      && samePlanIdentity(message.planAction, target)
    ));
    if (preferred) return preferred;
  }
  return [...messages]
    .reverse()
    .find((message) => (
      message.planAction
      && isReusablePlanStatus(message.planAction.status)
      && samePlanIdentity(message.planAction, target)
    ));
}
