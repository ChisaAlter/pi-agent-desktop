import React, { useMemo, useState } from "react";
import { useSessionStore } from "../../../stores/session-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import {
  buildUsageOverview,
  formatUsageCost,
  formatUsageDate,
  formatUsageNumber,
  type UsageOverview,
} from "../../UsageStats/usage-aggregation";

type TimeRange = 7 | 30;

interface TooltipState {
  content: string;
  x: number;
  y: number;
}

const MODEL_COLORS = ["#1683f7", "#1f8f46", "#70aee9", "#9cc3eb", "#c9dff4"];

function usageColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "#e9eaec";
  const ratio = value / max;
  if (ratio > 0.8) return "#1683f7";
  if (ratio > 0.55) return "#4d9cf0";
  if (ratio > 0.3) return "#8bbdec";
  return "#c9dff4";
}

function moveTooltip(event: React.MouseEvent<HTMLElement>, content: string, setTooltip: (next: TooltipState) => void): void {
  setTooltip({ content, x: event.clientX + 14, y: event.clientY + 14 });
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }): React.JSX.Element {
  return (
    <div className="min-h-[88px] rounded-[7px] bg-[#eeeeee] px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] text-[#6b7280]">
        <span className="h-2 w-2 rounded-full border border-[#9ca3af]" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold leading-none text-[#111827]">{value}</div>
      {detail && <div className="mt-2 text-[12px] leading-4 text-[#6b7280]">{detail}</div>}
    </div>
  );
}

function RangeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[7px] px-3 py-1 text-[12px] transition-colors ${
        active ? "bg-[#e5e5e5] font-medium text-[#111827]" : "text-[#6b7280] hover:bg-[#f0f0f0] hover:text-[#111827]"
      }`}
    >
      {children}
    </button>
  );
}

function Heatmap({
  overview,
  setTooltip,
  clearTooltip,
}: {
  overview: UsageOverview;
  setTooltip: (next: TooltipState) => void;
  clearTooltip: () => void;
}): React.JSX.Element {
  const max = Math.max(...overview.days.map((day) => day.totalTokens), 0);
  return (
    <section className="rounded-[7px] bg-[#eeeeee] px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="m-0 text-[13px] font-medium text-[#111827]">活跃热力图</h4>
        <div className="flex items-center gap-1 text-[10px] text-[#6b7280]">
          <span>较少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="h-3 w-3 rounded-[3px] border border-[#d5d8dc]"
              style={{ backgroundColor: usageColor((level / 4) * max, max) }}
              aria-hidden="true"
            />
          ))}
          <span>较多</span>
        </div>
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-[6px] overflow-x-auto pb-1">
        {overview.days.map((day) => (
          <button
            key={day.date}
            type="button"
            aria-label={`${day.date} 用量详情`}
            onMouseEnter={(event) => moveTooltip(event, day.tooltip, setTooltip)}
            onMouseMove={(event) => moveTooltip(event, day.tooltip, setTooltip)}
            onMouseLeave={clearTooltip}
            className="h-[13px] w-[13px] shrink-0 rounded-[3px] transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
            style={{ backgroundColor: usageColor(day.totalTokens, max) }}
          />
        ))}
      </div>
    </section>
  );
}

function TrendChart({
  overview,
  setTooltip,
  clearTooltip,
}: {
  overview: UsageOverview;
  setTooltip: (next: TooltipState) => void;
  clearTooltip: () => void;
}): React.JSX.Element {
  const visibleDays = overview.days.filter((_, index) => index % Math.max(1, Math.floor(overview.days.length / 7)) === 0);
  const max = Math.max(...overview.days.map((day) => day.totalTokens), 1);
  const models = overview.modelBreakdown.slice(0, 2);

  return (
    <section className="rounded-[7px] bg-[#eeeeee] px-4 py-4">
      <h4 className="m-0 text-[13px] font-medium text-[#111827]">按天 Token 趋势</h4>
      <div className="mt-4 rounded-[7px] bg-[#e9e9e9] px-4 pb-3 pt-5">
        <div className="relative flex h-[236px] items-end justify-between gap-2 border-b border-[#d8dadd] bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_52px,#dedede_53px)] px-1">
          {overview.days.map((day) => (
            <div key={day.date} className="flex h-full min-w-[12px] flex-1 items-end justify-center gap-[2px]">
              {models.map((model, index) => {
                const value = day.models.find((entry) => entry.key === model.key)?.totalTokens ?? 0;
                const height = Math.max(0, Math.round((value / max) * 100));
                const tooltip = [
                  day.date,
                  model.model,
                  `${formatUsageNumber(value)} tokens`,
                  `输入 ${formatUsageNumber(day.inputTokens, "compact")} / 输出 ${formatUsageNumber(day.outputTokens, "compact")}`,
                  `预估费用 ${formatUsageCost(day.estimatedCostUsd)}`,
                ].join("\n");
                return (
                  <button
                    key={model.key}
                    type="button"
                    aria-label={`${day.date} ${model.model} 趋势详情`}
                    onMouseEnter={(event) => moveTooltip(event, tooltip, setTooltip)}
                    onMouseMove={(event) => moveTooltip(event, tooltip, setTooltip)}
                    onMouseLeave={clearTooltip}
                    className="w-[9px] rounded-t-[2px] transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
                    style={{
                      height: `${height}%`,
                      minHeight: value > 0 ? 4 : 0,
                      backgroundColor: MODEL_COLORS[index] ?? "#9cc3eb",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-[#4b5563]">
          {visibleDays.map((day) => (
            <span key={day.date}>{day.label}</span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-24 text-[12px] text-[#6b7280]">
        {models.map((model, index) => (
          <span key={model.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[index] }} aria-hidden="true" />
            {model.model}
          </span>
        ))}
      </div>
    </section>
  );
}

function ModelUsage({
  overview,
  setTooltip,
  clearTooltip,
}: {
  overview: UsageOverview;
  setTooltip: (next: TooltipState) => void;
  clearTooltip: () => void;
}): React.JSX.Element {
  const topModels = overview.modelBreakdown.slice(0, 5);
  const gradient = topModels.length === 0
    ? "#dedede 0 100%"
    : topModels.reduce<{ parts: string[]; cursor: number }>((acc, model, index) => {
        const start = acc.cursor;
        const end = index === topModels.length - 1 ? 100 : Math.min(100, start + model.share);
        acc.parts.push(`${MODEL_COLORS[index] ?? "#9cc3eb"} ${start}% ${end}%`);
        acc.cursor = end;
        return acc;
      }, { parts: [], cursor: 0 }).parts.join(", ");

  return (
    <section className="rounded-[7px] bg-[#eeeeee] px-4 py-4">
      <h4 className="m-0 text-[13px] font-medium text-[#111827]">模型用量</h4>
      <div className="mt-4 flex min-h-[240px] items-center gap-10 rounded-[7px] bg-[#e9e9e9] px-8 py-6">
        <div
          className="flex h-[184px] w-[184px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
          aria-hidden="true"
        >
          <div className="flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full bg-[#e9e9e9] text-center">
            <span className="font-mono text-[20px] font-semibold text-[#111827]">{formatUsageNumber(overview.summary.totalTokens)}</span>
            <span className="mt-1 text-[12px] text-[#6b7280]">tokens</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {topModels.map((model, index) => (
            <button
              key={model.key}
              type="button"
              aria-label={`${model.model} 模型用量详情`}
              onMouseEnter={(event) => moveTooltip(event, model.tooltip, setTooltip)}
              onMouseMove={(event) => moveTooltip(event, model.tooltip, setTooltip)}
              onMouseLeave={clearTooltip}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-5 border-b border-[#d5d8dc] pb-3 text-left last:border-b-0 focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-[#111827]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[index] }} aria-hidden="true" />
                  {model.model}
                </span>
                <span className="mt-1 block text-[12px] text-[#6b7280]">{formatUsageNumber(model.totalTokens)} tokens</span>
              </span>
              <span className="font-mono text-[12px] text-[#4b5563]">{model.share}%</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function UsageTab(): React.JSX.Element {
  const sessions = useSessionStore((state) => state.sessions);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const [timeRange, setTimeRange] = useState<TimeRange>(30);
  const [includeAllWorkspaces, setIncludeAllWorkspaces] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const overview = useMemo(
    () => buildUsageOverview(sessions, {
      workspaceId: currentWorkspace?.id,
      includeAllWorkspaces,
      includeArchived,
      days: timeRange,
    }),
    [currentWorkspace?.id, includeAllWorkspaces, includeArchived, sessions, timeRange],
  );

  const clearTooltip = (): void => setTooltip(null);

  return (
    <div
      className="settings-tab-panel mx-auto w-full max-w-[860px] px-2 py-8 text-[#111827]"
      role="tabpanel"
      id="settings-tabpanel-usage"
      aria-labelledby="settings-tab-usage"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-end gap-4">
          <h3 className="m-0 text-[28px] font-semibold tracking-normal text-[#111827]">使用统计</h3>
          <span className="border-b-2 border-[#111827] pb-2 text-[13px] text-[#111827]">Token 用量</span>
        </div>
        <div className="flex shrink-0 rounded-[8px] border border-[#d5d8dc] bg-[#f7f7f7] p-1">
          <RangeButton active={timeRange === 7} onClick={() => setTimeRange(7)}>最近 7 天</RangeButton>
          <RangeButton active={timeRange === 30} onClick={() => setTimeRange(30)}>最近 30 天</RangeButton>
        </div>
      </div>

      <div className="mt-9 flex items-center justify-between">
        <span className="text-[13px] text-[#111827]">时间范围</span>
        <div className="flex gap-2">
          <RangeButton active={!includeAllWorkspaces} onClick={() => setIncludeAllWorkspaces(false)}>当前工作区</RangeButton>
          <RangeButton active={includeAllWorkspaces} onClick={() => setIncludeAllWorkspaces(true)}>全部工作区</RangeButton>
          <RangeButton active={!includeArchived} onClick={() => setIncludeArchived(false)}>活跃</RangeButton>
          <RangeButton active={includeArchived} onClick={() => setIncludeArchived(true)}>含归档</RangeButton>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-3 gap-3">
        <MetricCard label="tokens 用量" value={formatUsageNumber(overview.summary.totalTokens)} />
        <MetricCard label="会话数量" value={String(overview.summary.sessionCount)} />
        <MetricCard label="消息数量" value={String(overview.summary.messageCount)} />
        <MetricCard label="活跃天数" value={String(overview.summary.activeDays)} />
        <MetricCard label="当前连续天数" value={String(overview.summary.currentStreakDays)} />
        <MetricCard
          label="最常用模型"
          value={overview.summary.topModel?.model ?? "-"}
          detail={overview.summary.topModel ? `占比 ${overview.summary.topModel.share}%` : "暂无数据"}
        />
      </div>

      {overview.summary.sessionCount === 0 ? (
        <div className="mt-5 rounded-[7px] bg-[#eeeeee] px-5 py-12 text-center text-[13px] text-[#6b7280]">
          等待会话产生 Token 用量事件
        </div>
      ) : (
        <div className="mt-5 space-y-5 pb-10">
          <Heatmap overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <TrendChart overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <ModelUsage overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <section className="rounded-[7px] bg-[#eeeeee] px-4 py-4">
            <h4 className="m-0 text-[13px] font-medium text-[#111827]">会话排行</h4>
            <div className="mt-3 divide-y divide-[#d5d8dc] overflow-hidden rounded-[7px] bg-[#e9e9e9]">
              {overview.sessions.slice(0, 10).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onMouseEnter={(event) => moveTooltip(event, session.tooltip, setTooltip)}
                  onMouseMove={(event) => moveTooltip(event, session.tooltip, setTooltip)}
                  onMouseLeave={clearTooltip}
                  className="grid w-full grid-cols-[1fr_120px_100px_90px] items-center gap-4 px-4 py-3 text-left text-[12px] transition-colors hover:bg-[#f0f0f0] focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
                >
                  <span className="min-w-0 truncate font-medium text-[#111827]">{session.title}</span>
                  <span className="truncate text-[#6b7280]">{session.model}</span>
                  <span className="font-mono text-[#111827]">{formatUsageNumber(session.totalTokens, "compact")}</span>
                  <span className="text-[#6b7280]">{formatUsageDate(session.updatedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[90] max-w-[260px] whitespace-pre-line rounded-[7px] border border-[#d5d8dc] bg-white px-3 py-2 text-[12px] leading-5 text-[#111827] shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
