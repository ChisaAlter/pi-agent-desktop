import React, { useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { usePlanStore } from "../../stores/plan-store";

interface PlanCardViewProps {
  workspaceId?: string;
  onExecute?: (message: string) => Promise<void>;
}

export function PlanCardView({ workspaceId, onExecute }: PlanCardViewProps): React.JSX.Element | null {
  const { activeCard, decisionRequest, setDecisionRequest, setEnabled } = usePlanStore();
  const [feedback, setFeedback] = useState("");
  const isExtensionQuestion = Boolean(decisionRequest && !decisionRequest.card);

  if (!activeCard && !decisionRequest) return null;

  const execute = async (): Promise<void> => {
    if (!activeCard) return;
    setDecisionRequest(null);
    setEnabled(workspaceId, false);
    const name = activeCard.filename ?? activeCard.title;
    await onExecute?.(`/execute_plan ${name}`);
  };

  const refine = async (): Promise<void> => {
    if (!feedback.trim()) return;
    setDecisionRequest(null);
    await onExecute?.(feedback.trim());
    setFeedback("");
  };

  const respondToExtension = (value: string): void => {
    if (!decisionRequest) return;
    if (decisionRequest.requestId.startsWith("local_plan_goal_")) {
      setDecisionRequest(null);
      setFeedback("");
      if (value.trim()) {
        void onExecute?.(value.trim());
      }
      return;
    }
    window.piAPI?.planRespond(decisionRequest.requestId, "refine", value);
    setDecisionRequest(null);
    setFeedback("");
  };

  const questionPanel = decisionRequest && isExtensionQuestion ? (
    <div className="mt-4 rounded-[15px] border border-[#e8e8e4] bg-white p-3.5">
      <div className="mb-2">
        <div className="text-xs font-medium uppercase text-[#777]">Plan Question</div>
        <div className="text-sm font-medium text-[#222]">{decisionRequest.title ?? "计划需要确认"}</div>
        {decisionRequest.message && (
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#555]">{decisionRequest.message}</p>
        )}
      </div>

      {decisionRequest.options && decisionRequest.options.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {decisionRequest.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => respondToExtension(option)}
              className="rounded-lg border border-[#d4d4d4] bg-white px-3 py-1.5 text-xs text-[#333] hover:bg-[#f7f7f7]"
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={decisionRequest.placeholder ?? "输入你的补充"}
            className="mb-3 min-h-[72px] w-full resize-none rounded-[10px] border border-[#e2e2de] bg-white px-3 py-2 text-sm focus:border-[#d6d6d1] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(36,36,35,0.045)] focus-visible:!outline-none focus-visible:!shadow-[0_0_0_3px_rgba(36,36,35,0.045)]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => respondToExtension("")}
              className="rounded-lg px-3 py-1.5 text-xs text-[#666] hover:bg-[#f3f3f3]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => respondToExtension(feedback.trim())}
              disabled={!feedback.trim()}
              className="rounded-lg bg-[#262626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#111] disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送补充
            </button>
          </div>
        </>
      )}
    </div>
  ) : null;

  if (!activeCard && questionPanel) {
    return (
      <section className="rounded-[16px] border border-[#e8e8e4] bg-white p-4 text-[#202020] shadow-[0_18px_44px_rgba(20,20,18,0.08),0_2px_10px_rgba(20,20,18,0.05)]">
        {questionPanel}
      </section>
    );
  }

  if (!activeCard) return null;

  return (
    <section className="rounded-[16px] border border-[#e8e8e4] bg-white p-5 text-[#202020] shadow-[0_18px_44px_rgba(20,20,18,0.08),0_2px_10px_rgba(20,20,18,0.05)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-[#777]">Plan Mode</div>
          <h3 className="text-lg font-bold">{activeCard.title}</h3>
        </div>
        <span className="inline-flex h-7 items-center rounded-full border border-[#dce9dd] bg-[#f4fbf5] px-2.5 text-xs font-semibold text-[#3c7b46]">已整理</span>
      </div>
      <div className="markdown-body max-w-none text-sm">
        <MarkdownRenderer content={activeCard.content} />
      </div>

      {questionPanel}

      {decisionRequest && !isExtensionQuestion && (
        <div className="mt-4 rounded-[15px] border border-[#e8e8e4] bg-white p-3.5">
          <div className="mb-2 text-sm font-medium text-[#222]">要执行这个计划吗？</div>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="有补充就写在这里"
            className="mb-3 min-h-[64px] w-full resize-none rounded-[10px] border border-[#e2e2de] px-3 py-2 text-sm focus:border-[#d6d6d1] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(36,36,35,0.045)] focus-visible:!outline-none focus-visible:!shadow-[0_0_0_3px_rgba(36,36,35,0.045)]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDecisionRequest(null)}
              className="h-8 rounded-full px-3 text-xs font-medium text-[#555550] hover:bg-[#f3f3f3]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void refine()}
              className="h-8 rounded-full border border-[#e2e2de] bg-white px-3 text-xs font-medium text-[#333] hover:bg-[#f7f7f7]"
            >
              我有补充
            </button>
            <button
              type="button"
              onClick={() => void execute()}
              className="h-8 rounded-full bg-[#242423] px-3 text-xs font-medium text-white hover:bg-[#111]"
            >
              执行计划
            </button>
          </div>
        </div>
      )}
    </section>
  );
}


