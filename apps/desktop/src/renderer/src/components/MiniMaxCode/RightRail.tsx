import React, { useEffect, useMemo, useState } from "react";
import type { GitStatus } from "@shared";
import { usePlanStore } from '../../stores/plan-store';
import { useAgentStore } from '../../stores/agent-store';
import type { TaskProgressItem } from "./TaskProgressPanel";

interface RightRailProps {
  workspacePath?: string;
  tasks?: TaskProgressItem[];
}

function statusDot(status: string): string {
  if (status === "completed") return "bg-[#16a34a]";
  if (status === "running") return "bg-[#111]";
  if (status === "failed") return "bg-[#dc2626]";
  if (status === "waiting") return "bg-[#f59e0b]";
  return "bg-[#d4d4d4]";
}

export function RightRail({ workspacePath, tasks = [] }: RightRailProps): React.JSX.Element {
  const [git, setGit] = useState<GitStatus | null>(null);
    const currentAgent = useAgentStore((state) => state.getCurrentAgent());
    const agentRuntimeState = useAgentStore((state) => state.currentAgentId ? state.runtimeByAgent[state.currentAgentId] : undefined);
  const { steps } = usePlanStore();

  useEffect(() => {
    if (!workspacePath || !window.piAPI?.getGitStatus) return;
    let disposed = false;
    const load = async (): Promise<void> => {
      const next = await window.piAPI.getGitStatus(workspacePath);
      if (!disposed) setGit(next);
    };
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [workspacePath]);

  const changeCount = useMemo(() => {
    if (!git) return 0;
    return git.modified.length + git.added.length + git.deleted.length + git.untracked.length;
  }, [git]);

  return (
    <aside className="flex h-full w-full flex-col gap-3 bg-transparent px-4 py-[88px] text-[var(--mm-text-primary)]">
      <section className="rounded-[16px] border border-[#e9e9e6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">环境信息</h2>
          <svg className="h-3.5 w-3.5 text-[#aaa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <dl className="space-y-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--mm-text-tertiary)]">Branch</dt>
            <dd className="truncate text-right font-mono">{git?.branch ?? "无 Git"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--mm-text-tertiary)]">变更</dt>
            <dd>{changeCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--mm-text-tertiary)]">Ahead / Behind</dt>
            <dd>{git ? `${git.ahead} / ${git.behind}` : "-"}</dd>
          </div>
          <div className="flex items-center gap-2 pt-1 text-[#b0b0b0]">
            <span className="h-px flex-1 bg-[#eee]" />
            <span>提交或推送</span>
          </div>
        </dl>
      </section>

      <section className="rounded-[16px] border border-[#e9e9e6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">Agent</h2>
        </div>
        <dl className="space-y-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--mm-text-tertiary)]">状态</dt>
            <dd className="truncate text-right">
              {currentAgent
                ? currentAgent.status === "running"
                  ? "运行中"
                  : currentAgent.status === "starting"
                    ? "启动中"
                    : "空闲"
                : "未创建"}
            </dd>
          </div>
          {agentRuntimeState?.isStreaming != null && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--mm-text-tertiary)]">流式</dt>
              <dd>{agentRuntimeState?.isStreaming ? "是" : "否"}</dd>
            </div>
          )}
          {agentRuntimeState?.sessionPath && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--mm-text-tertiary)]">会话</dt>
              <dd className="truncate text-right font-mono text-[10px]" title={agentRuntimeState?.sessionPath}>
                {(() => { const p = agentRuntimeState?.sessionPath; return p ? p.split(/[\\/]/).pop() : null; })()}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="min-h-0 rounded-[16px] border border-[#e9e9e6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-medium">进度</h2>
          <svg className="h-3.5 w-3.5 text-[#aaa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {steps.length > 0 ? (
          <ol className="m-0 max-h-[440px] list-none space-y-2 overflow-y-auto p-0">
            {steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-start gap-2 text-xs">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(step.status)}`} />
                <span className={step.status === "completed" ? "text-[var(--mm-text-tertiary)] line-through" : ""}>
                  {step.text}
                </span>
              </li>
            ))}
          </ol>
        ) : tasks.length > 0 ? (
          <ul className="m-0 max-h-[440px] list-none space-y-2 overflow-y-auto p-0">
            {tasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-center gap-2 text-xs">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(task.status)}`} />
                <span className="truncate">{task.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs leading-5 text-[var(--mm-text-secondary)]">跟踪或长任务的进度</p>
        )}
      </section>
    </aside>
  );
}
