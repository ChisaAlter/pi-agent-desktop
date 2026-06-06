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
    window.piAPI?.planRespond(decisionRequest.requestId, "refine", value);
    setDecisionRequest(null);
    setFeedback("");
  };

  const questionPanel = decisionRequest && isExtensionQuestion ? (
    <div className="mt-4 rounded-xl border border-[#cacac6] bg-white p-3">
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
            className="mb-3 min-h-[72px] w-full resize-none rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#222]/10"
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
      <section className="rounded-xl border border-[#d7d7d4] bg-[#f6f6f3] p-4 text-[#202020] shadow-sm">
        {questionPanel}
      </section>
    );
  }

  if (!activeCard) return null;

  return (
    <section className="rounded-xl border border-[#d7d7d4] bg-[#eeeeea] p-4 text-[#202020] shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase text-[#777]">Plan Mode</div>
          <h3 className="text-lg font-semibold">{activeCard.title}</h3>
        </div>
        <span className="rounded-md bg-white px-2 py-1 text-xs text-[#666]">计划</span>
      </div>
      <div className="prose prose-sm max-w-none text-sm">
        <MarkdownRenderer content={activeCard.content} />
      </div>

      {questionPanel}

      {decisionRequest && !isExtensionQuestion && (
        <div className="mt-4 rounded-xl border border-[#cacac6] bg-white p-3">
          <div className="mb-2 text-sm font-medium text-[#222]">要执行这个计划吗？</div>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="有补充就写在这里"
            className="mb-3 min-h-[64px] w-full resize-none rounded-lg border border-[#ddd] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#222]/10"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDecisionRequest(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-[#666] hover:bg-[#f3f3f3]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void refine()}
              className="rounded-lg border border-[#d4d4d4] px-3 py-1.5 text-xs text-[#333] hover:bg-[#f7f7f7]"
            >
              我有补充
            </button>
            <button
              type="button"
              onClick={() => void execute()}
              className="rounded-lg bg-[#262626] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#111]"
            >
              执行计划
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
