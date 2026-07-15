import React, { useEffect, useMemo, useState } from "react";
import { isIpcError } from "@shared";
import { useI18n } from "../../../i18n";
import {
  buildUsageOverview,
  formatUsageDate,
  formatUsageNumber,
  type UsageOverview,
} from "../../UsageStats/usage-aggregation";
import { SectionTitle, SettingsCard, SettingsPage } from "../_shared";

type TimeRange = 7 | 30;
type UsageSession = Parameters<typeof buildUsageOverview>[0][number];
type UsageSessionSource = Pick<UsageSession, "id" | "title" | "workspaceId" | "archived" | "usage"> & {
  createdAt: number | Date;
  updatedAt: number | Date;
  messages?: UsageSession["messages"];
  messageCount?: number;
};
type UsageApi = NonNullable<Window["piAPI"]> & {
  listSessionSummaries?: () => Promise<UsageSessionSource[]>;
};

function reviveUsageSession(session: UsageSessionSource): UsageSession {
  return {
    ...session,
    createdAt: session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt),
    updatedAt: session.updatedAt instanceof Date ? session.updatedAt : new Date(session.updatedAt),
    messages: session.messages ?? [],
  } as UsageSession;
}

interface TooltipState {
  content: string;
  x: number;
  y: number;
}

const MODEL_COLORS = [
  "var(--settings-chart-1)",
  "var(--settings-chart-2)",
  "var(--settings-chart-3)",
  "var(--settings-chart-4)",
  "var(--settings-chart-5)",
];

function usageColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "var(--settings-heat-0)";
  const ratio = value / max;
  if (ratio > 0.8) return "var(--settings-heat-4)";
  if (ratio > 0.55) return "var(--settings-heat-3)";
  if (ratio > 0.3) return "var(--settings-heat-2)";
  return "var(--settings-heat-1)";
}

function moveTooltip(event: React.MouseEvent<HTMLElement>, content: string, setTooltip: (next: TooltipState) => void): void {
  setTooltip({ content, x: event.clientX + 14, y: event.clientY + 14 });
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }): React.JSX.Element {
  return (
    <div className="min-h-[88px] rounded-[7px] bg-[var(--settings-bg-card)] px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] text-[var(--settings-text-secondary)]">
        <span className="h-2 w-2 rounded-full border border-[var(--settings-border)]" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold leading-none text-[var(--settings-text-primary)]">{value}</div>
      {detail && <div className="mt-2 text-[12px] leading-4 text-[var(--settings-text-secondary)]">{detail}</div>}
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
        active ? "bg-[var(--settings-bg-active)] font-medium text-[var(--settings-text-primary)]" : "text-[var(--settings-text-secondary)] hover:bg-[var(--settings-bg-control-hover)] hover:text-[var(--settings-text-primary)]"
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
    <section className="rounded-[7px] bg-[var(--settings-bg-card)] px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="m-0 text-[13px] font-medium text-[var(--settings-text-primary)]">活跃热力图</h4>
        <div className="flex items-center gap-1 text-[10px] text-[var(--settings-text-secondary)]">
          <span>较少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="h-3 w-3 rounded-[3px] border border-[var(--settings-border)]"
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
    <section className="rounded-[7px] bg-[var(--settings-bg-card)] px-4 py-4">
      <h4 className="m-0 text-[13px] font-medium text-[var(--settings-text-primary)]">按天 Token 趋势</h4>
      <div className="mt-4 rounded-[7px] bg-[var(--settings-bg-card-muted)] px-4 pb-3 pt-5">
        <div className="relative flex h-[236px] items-end justify-between gap-2 border-b border-[var(--settings-border)] bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_52px,var(--settings-gridline)_53px)] px-1">
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
                      backgroundColor: MODEL_COLORS[index] ?? "var(--settings-chart-4)",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-[var(--settings-text-muted)]">
          {visibleDays.map((day) => (
            <span key={day.date}>{day.label}</span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-24 text-[12px] text-[var(--settings-text-secondary)]">
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
    ? "var(--settings-gridline) 0 100%"
    : topModels.reduce<{ parts: string[]; cursor: number }>((acc, model, index) => {
        const start = acc.cursor;
        const end = index === topModels.length - 1 ? 100 : Math.min(100, start + model.share);
        acc.parts.push(`${MODEL_COLORS[index] ?? "var(--settings-chart-4)"} ${start}% ${end}%`);
        acc.cursor = end;
        return acc;
      }, { parts: [], cursor: 0 }).parts.join(", ");

  return (
    <section className="rounded-[7px] bg-[var(--settings-bg-card)] px-4 py-4">
      <h4 className="m-0 text-[13px] font-medium text-[var(--settings-text-primary)]">模型用量</h4>
      <div className="mt-4 flex min-h-[240px] items-center gap-10 rounded-[7px] bg-[var(--settings-bg-card-muted)] px-8 py-6">
        <div
          className="flex h-[184px] w-[184px] shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
          aria-hidden="true"
        >
          <div className="flex h-[112px] w-[112px] flex-col items-center justify-center rounded-full bg-[var(--settings-bg-card-muted)] text-center">
            <span className="font-mono text-[20px] font-semibold text-[var(--settings-text-primary)]">{formatUsageNumber(overview.summary.totalTokens)}</span>
            <span className="mt-1 text-[12px] text-[var(--settings-text-secondary)]">tokens</span>
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
              className="grid w-full grid-cols-[1fr_auto] items-center gap-5 border-b border-[var(--settings-border)] pb-3 text-left last:border-b-0 focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--settings-text-primary)]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[index] }} aria-hidden="true" />
                  {model.model}
                </span>
                <span className="mt-1 block text-[12px] text-[var(--settings-text-secondary)]">{formatUsageNumber(model.totalTokens)} tokens</span>
              </span>
              <span className="font-mono text-[12px] text-[var(--settings-text-muted)]">{model.share}%</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function UsageTab(): React.JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<UsageSession[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<TimeRange>(30);
  const [includeAllWorkspaces, setIncludeAllWorkspaces] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const api = window.piAPI as UsageApi | undefined;
      if (!api?.listSessions || !api.listWorkspaces) return;
      try {
        const [sessionList, workspaceList] = await Promise.all([
          api.listSessionSummaries ? api.listSessionSummaries() : api.listSessions(),
          api.listWorkspaces(),
        ]);
        if (!active) return;
        const currentWorkspace = isIpcError(workspaceList)
          ? undefined
          : workspaceList
            .slice()
            .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))[0];
        setSessions((sessionList as UsageSessionSource[]).map(reviveUsageSession));
        setCurrentWorkspaceId(currentWorkspace?.id);
      } catch {
        if (!active) return;
        setSessions([]);
        setCurrentWorkspaceId(undefined);
      }
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void load();
    };

    void load();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const overview = useMemo(
    () => buildUsageOverview(sessions, {
      workspaceId: currentWorkspaceId,
      includeAllWorkspaces,
      includeArchived,
      days: timeRange,
    }),
    [currentWorkspaceId, includeAllWorkspaces, includeArchived, sessions, timeRange],
  );

  const clearTooltip = (): void => setTooltip(null);

  return (
    <SettingsPage
      tabId="usage"
      title={t("settings.usage.heading")}
      description={t("settings.usage.description")}
      actions={(
        <div className="flex shrink-0 rounded-[10px] border border-[var(--settings-border)] bg-[var(--settings-bg-control)] p-1">
          <RangeButton active={timeRange === 7} onClick={() => setTimeRange(7)}>最近 7 天</RangeButton>
          <RangeButton active={timeRange === 30} onClick={() => setTimeRange(30)}>最近 30 天</RangeButton>
        </div>
      )}
    >
      <SettingsCard anchorId="usage-filters" className="px-5 py-4">
        <SectionTitle title={t("settings.usage.filtersHeading")} description={t("settings.usage.filtersDescription")} />
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-[var(--settings-text-primary)]">时间范围</span>
          <div className="flex gap-2">
          <RangeButton active={!includeAllWorkspaces} onClick={() => setIncludeAllWorkspaces(false)}>当前工作区</RangeButton>
          <RangeButton active={includeAllWorkspaces} onClick={() => setIncludeAllWorkspaces(true)}>全部工作区</RangeButton>
          <RangeButton active={!includeArchived} onClick={() => setIncludeArchived(false)}>活跃</RangeButton>
          <RangeButton active={includeArchived} onClick={() => setIncludeArchived(true)}>含归档</RangeButton>
          </div>
        </div>
      </SettingsCard>

      <div data-settings-anchor="usage-overview" className="space-y-4">
        <SectionTitle title={t("settings.usage.overviewHeading")} description={t("settings.usage.overviewDescription")} />
        <div className="grid grid-cols-3 gap-3">
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
      </div>

      {overview.summary.sessionCount === 0 ? (
        <div className="mt-5 rounded-[7px] bg-[var(--settings-bg-card)] px-5 py-12 text-center text-[13px] text-[var(--settings-text-secondary)]">
          等待会话产生 Token 用量事件
        </div>
      ) : (
        <div className="mt-5 space-y-5 pb-10">
          <Heatmap overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <TrendChart overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <ModelUsage overview={overview} setTooltip={setTooltip} clearTooltip={clearTooltip} />
          <section className="rounded-[7px] bg-[var(--settings-bg-card)] px-4 py-4">
            <h4 className="m-0 text-[13px] font-medium text-[var(--settings-text-primary)]">会话排行</h4>
            <div className="mt-3 divide-y divide-[var(--settings-border)] overflow-hidden rounded-[7px] bg-[var(--settings-bg-card-muted)]">
              {overview.sessions.slice(0, 10).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onMouseEnter={(event) => moveTooltip(event, session.tooltip, setTooltip)}
                  onMouseMove={(event) => moveTooltip(event, session.tooltip, setTooltip)}
                  onMouseLeave={clearTooltip}
                  className="grid w-full grid-cols-[1fr_120px_100px_90px] items-center gap-4 px-4 py-3 text-left text-[12px] transition-colors hover:bg-[var(--settings-bg-control-hover)] focus:outline-none focus:ring-2 focus:ring-[#1683f7]/30"
                >
                  <span className="min-w-0 truncate font-medium text-[var(--settings-text-primary)]">{session.title}</span>
                  <span className="truncate text-[var(--settings-text-secondary)]">{session.model}</span>
                  <span className="font-mono text-[var(--settings-text-primary)]">{formatUsageNumber(session.totalTokens, "compact")}</span>
                  <span className="text-[var(--settings-text-secondary)]">{formatUsageDate(session.updatedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[90] max-w-[260px] whitespace-pre-line rounded-[7px] border border-[var(--settings-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-[12px] leading-5 text-[var(--settings-text-primary)] shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.content}
        </div>
      )}
    </SettingsPage>
  );
}
