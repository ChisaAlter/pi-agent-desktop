import type { Session } from "../../stores/session-store";

export type UsageNumberMode = "zh" | "compact";

export interface UsageOverviewOptions {
  workspaceId?: string | null;
  includeAllWorkspaces: boolean;
  includeArchived: boolean;
  days: number | "all";
  now?: Date;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionCount: number;
  messageCount: number;
  activeDays: number;
  currentStreakDays: number;
  topModel?: UsageModelBreakdown;
}

export interface UsageDayBucket {
  date: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionCount: number;
  models: UsageModelBreakdown[];
  tooltip: string;
}

export interface UsageModelBreakdown {
  key: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionCount: number;
  share: number;
  tooltip: string;
}

export interface UsageSessionRow {
  id: string;
  title: string;
  workspaceId: string;
  provider: string;
  model: string;
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  tooltip: string;
}

export interface UsageOverview {
  summary: UsageSummary;
  days: UsageDayBucket[];
  modelBreakdown: UsageModelBreakdown[];
  sessions: UsageSessionRow[];
}

interface MutableModelBucket {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionIds: Set<string>;
}

interface MutableDayBucket {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  sessionIds: Set<string>;
  models: Map<string, MutableModelBucket>;
}

function cleanFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatUsageNumber(num: number | undefined, mode: UsageNumberMode = "zh"): string {
  const value = num ?? 0;
  if (value === 0) return "0";
  if (mode === "compact") {
    if (value >= 1000000) return `${cleanFixed(value / 1000000)}M`;
    if (value >= 1000) return `${cleanFixed(value / 1000)}K`;
    return value.toLocaleString();
  }
  if (value >= 100000000) return `${cleanFixed(value / 100000000)}亿`;
  if (value >= 10000) return `${cleanFixed(value / 10000)}万`;
  return value.toLocaleString();
}

export function formatUsageCost(cost: number | undefined): string {
  const value = cost ?? 0;
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export function formatUsageDate(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(ms));
}

function toDateKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyToLabel(key: string): string {
  const [, month, day] = key.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function createDayBuckets(days: number, now: Date): Map<string, MutableDayBucket> {
  const rangeEnd = startOfDay(now);
  const rangeStart = addDays(rangeEnd, -(days - 1));
  const dayBuckets = new Map<string, MutableDayBucket>();

  for (let index = 0; index < days; index += 1) {
    const date = addDays(rangeStart, index);
    const key = toDateKey(date.getTime());
    dayBuckets.set(key, {
      date: key,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      sessionIds: new Set<string>(),
      models: new Map<string, MutableModelBucket>(),
    });
  }

  return dayBuckets;
}

function usageTotals(session: Session): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  updatedAt: number;
  provider: string;
  model: string;
} | null {
  const usage = session.usage;
  if (!usage) return null;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: usage.estimatedCostUsd ?? 0,
    updatedAt: usage.updatedAt,
    provider: usage.provider ?? "unknown",
    model: usage.model ?? "unknown",
  };
}

function addToModelBucket(
  buckets: Map<string, MutableModelBucket>,
  sessionId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  estimatedCostUsd: number,
): void {
  const key = `${provider}/${model}`;
  const bucket = buckets.get(key) ?? {
    provider,
    model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    sessionIds: new Set<string>(),
  };
  bucket.inputTokens += inputTokens;
  bucket.outputTokens += outputTokens;
  bucket.totalTokens += totalTokens;
  bucket.estimatedCostUsd += estimatedCostUsd;
  bucket.sessionIds.add(sessionId);
  buckets.set(key, bucket);
}

function finalizeModelBucket(bucket: MutableModelBucket, totalTokens: number): UsageModelBreakdown {
  const share = totalTokens > 0 ? Math.round((bucket.totalTokens / totalTokens) * 100) : 0;
  const key = `${bucket.provider}/${bucket.model}`;
  return {
    key,
    provider: bucket.provider,
    model: bucket.model,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    totalTokens: bucket.totalTokens,
    estimatedCostUsd: bucket.estimatedCostUsd,
    sessionCount: bucket.sessionIds.size,
    share,
    tooltip: [
      bucket.model,
      `${formatUsageNumber(bucket.totalTokens)} tokens`,
      `占比 ${share}%`,
      `输入 ${formatUsageNumber(bucket.inputTokens, "compact")} / 输出 ${formatUsageNumber(bucket.outputTokens, "compact")}`,
      `预估费用 ${formatUsageCost(bucket.estimatedCostUsd)}`,
      `${bucket.sessionIds.size} 个会话`,
    ].join("\n"),
  };
}

export function buildUsageOverview(sessions: Session[], options: UsageOverviewOptions): UsageOverview {
  const now = options.now ?? new Date();
  const rangeDays = options.days;
  const rangeEnd = rangeDays === "all" ? null : startOfDay(now);
  const rangeStart = rangeDays === "all" ? null : addDays(startOfDay(now), -(rangeDays - 1));
  const rangeEndExclusive = rangeEnd ? addDays(rangeEnd, 1) : null;
  const dayBuckets = rangeDays === "all" ? new Map<string, MutableDayBucket>() : createDayBuckets(rangeDays, now);
  const modelBuckets = new Map<string, MutableModelBucket>();
  const sessionRows: UsageSessionRow[] = [];

  for (const session of sessions) {
    if (!options.includeAllWorkspaces) {
      if (!options.workspaceId) continue;
      if (session.workspaceId !== options.workspaceId) continue;
    }
    if (!options.includeArchived && session.archived) continue;
    const totals = usageTotals(session);
    if (!totals) continue;
    if (rangeStart && rangeEndExclusive && (totals.updatedAt < rangeStart.getTime() || totals.updatedAt >= rangeEndExclusive.getTime())) continue;

    addToModelBucket(
      modelBuckets,
      session.id,
      totals.provider,
      totals.model,
      totals.inputTokens,
      totals.outputTokens,
      totals.totalTokens,
      totals.estimatedCostUsd,
    );

    const date = toDateKey(totals.updatedAt);
    const dayBucket = dayBuckets.get(date);
    if (dayBucket) {
      dayBucket.inputTokens += totals.inputTokens;
      dayBucket.outputTokens += totals.outputTokens;
      dayBucket.totalTokens += totals.totalTokens;
      dayBucket.estimatedCostUsd += totals.estimatedCostUsd;
      dayBucket.sessionIds.add(session.id);
      addToModelBucket(
        dayBucket.models,
        session.id,
        totals.provider,
        totals.model,
        totals.inputTokens,
        totals.outputTokens,
        totals.totalTokens,
        totals.estimatedCostUsd,
      );
    }

    sessionRows.push({
      id: session.id,
      title: session.title,
      workspaceId: session.workspaceId,
      provider: totals.provider,
      model: totals.model,
      updatedAt: totals.updatedAt,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      estimatedCostUsd: totals.estimatedCostUsd,
      tooltip: [
        session.title,
        `工作区 ${session.workspaceId}`,
        `${totals.provider}/${totals.model}`,
        `输入 ${formatUsageNumber(totals.inputTokens, "compact")} / 输出 ${formatUsageNumber(totals.outputTokens, "compact")}`,
        `总计 ${formatUsageNumber(totals.totalTokens)} tokens`,
        `预估费用 ${formatUsageCost(totals.estimatedCostUsd)}`,
        `更新时间 ${formatUsageDate(totals.updatedAt)}`,
      ].join("\n"),
    });
  }

  const totalInputTokens = sessionRows.reduce((sum, row) => sum + row.inputTokens, 0);
  const totalOutputTokens = sessionRows.reduce((sum, row) => sum + row.outputTokens, 0);
  const totalTokens = sessionRows.reduce((sum, row) => sum + row.totalTokens, 0);
  const totalCost = sessionRows.reduce((sum, row) => sum + row.estimatedCostUsd, 0);
  const messageCount = sessionRows.reduce((sum, row) => {
    const source = sessions.find((session) => session.id === row.id);
    return sum + (source?.messages.length ?? 0);
  }, 0);

  const modelBreakdown = Array.from(modelBuckets.values())
    .map((bucket) => finalizeModelBucket(bucket, totalTokens))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const days = Array.from(dayBuckets.values()).map((bucket) => {
    const models = Array.from(bucket.models.values())
      .map((modelBucket) => finalizeModelBucket(modelBucket, bucket.totalTokens))
      .sort((a, b) => b.totalTokens - a.totalTokens);
    return {
      date: bucket.date,
      label: dateKeyToLabel(bucket.date),
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      totalTokens: bucket.totalTokens,
      estimatedCostUsd: bucket.estimatedCostUsd,
      sessionCount: bucket.sessionIds.size,
      models,
      tooltip: [
        bucket.date,
        `${formatUsageNumber(bucket.totalTokens, "compact")} tokens`,
        `${bucket.sessionIds.size} 个会话`,
        `输入 ${formatUsageNumber(bucket.inputTokens, "compact")} / 输出 ${formatUsageNumber(bucket.outputTokens, "compact")}`,
        `预估费用 ${formatUsageCost(bucket.estimatedCostUsd)}`,
      ].join("\n"),
    };
  });

  const activeDays = days.filter((day) => day.totalTokens > 0).length;
  let currentStreakDays = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index]?.totalTokens) currentStreakDays += 1;
    else break;
  }

  return {
    summary: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      estimatedCostUsd: totalCost,
      sessionCount: sessionRows.length,
      messageCount,
      activeDays,
      currentStreakDays,
      topModel: modelBreakdown[0],
    },
    days,
    modelBreakdown,
    sessions: sessionRows.sort((a, b) => b.totalTokens - a.totalTokens),
  };
}
