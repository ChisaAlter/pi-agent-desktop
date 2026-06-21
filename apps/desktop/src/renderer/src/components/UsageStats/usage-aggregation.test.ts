import { describe, expect, it } from "vitest";
import type { Session } from "../../stores/session-store";
import { buildUsageOverview, formatUsageCost, formatUsageNumber } from "./usage-aggregation";

const baseSession = {
  workspaceId: "ws-main",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-20T00:00:00.000Z"),
  messages: [],
} satisfies Partial<Session>;

function session(input: Partial<Session>): Session {
  return {
    ...baseSession,
    id: "s-test",
    title: "Test session",
    ...input,
  } as Session;
}

describe("usage aggregation", () => {
  it("aggregates token totals, model breakdown, dates, and archived filters", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-1",
          title: "Current workspace",
          usage: {
            provider: "glm",
            model: "GLM-5.2",
            inputTokens: 1000,
            outputTokens: 500,
            estimatedCostUsd: 0.012,
            updatedAt: new Date("2026-06-20T10:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-2",
          title: "Archived",
          archived: true,
          usage: {
            provider: "glm",
            model: "glm-5.1",
            inputTokens: 300,
            outputTokens: 200,
            totalTokens: 500,
            estimatedCostUsd: 0.02,
            updatedAt: new Date("2026-06-19T10:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-3",
          title: "Other workspace",
          workspaceId: "ws-other",
          usage: {
            inputTokens: 999,
            outputTokens: 1,
            updatedAt: new Date("2026-06-20T10:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 30,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );

    expect(overview.summary.totalTokens).toBe(1500);
    expect(overview.summary.inputTokens).toBe(1000);
    expect(overview.summary.outputTokens).toBe(500);
    expect(overview.summary.sessionCount).toBe(1);
    expect(overview.summary.messageCount).toBe(0);
    expect(overview.summary.activeDays).toBe(1);
    expect(overview.summary.currentStreakDays).toBe(1);
    expect(overview.summary.topModel?.model).toBe("GLM-5.2");
    expect(overview.modelBreakdown[0]?.share).toBe(100);
    expect(overview.days.find((day) => day.date === "2026-06-20")?.tooltip).toContain("1.5K tokens");
    expect(overview.sessions[0]?.tooltip).toContain("输入 1K");
  });

  it("can include all workspaces and archived sessions", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-1",
          usage: { inputTokens: 1, outputTokens: 1, updatedAt: new Date("2026-06-20T00:00:00.000Z").getTime() },
        }),
        session({
          id: "s-2",
          workspaceId: "ws-other",
          archived: true,
          usage: { inputTokens: 2, outputTokens: 3, updatedAt: new Date("2026-06-20T00:00:00.000Z").getTime() },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: true,
        includeArchived: true,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );

    expect(overview.summary.totalTokens).toBe(7);
    expect(overview.summary.sessionCount).toBe(2);
  });

  it("can aggregate all-time usage without dropping old sessions", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-old",
          usage: {
            inputTokens: 40,
            outputTokens: 60,
            updatedAt: new Date("2026-04-01T00:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-recent",
          usage: {
            inputTokens: 10,
            outputTokens: 15,
            updatedAt: new Date("2026-06-20T00:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: "all",
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );

    expect(overview.summary.totalTokens).toBe(125);
    expect(overview.summary.sessionCount).toBe(2);
    expect(overview.days).toEqual([]);
  });

  it("returns an empty current-workspace overview when the workspace id is missing", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-1",
          usage: { inputTokens: 100, outputTokens: 50, updatedAt: new Date("2026-06-20T00:00:00.000Z").getTime() },
        }),
        session({
          id: "s-2",
          workspaceId: "ws-other",
          usage: { inputTokens: 20, outputTokens: 30, updatedAt: new Date("2026-06-20T00:00:00.000Z").getTime() },
        }),
      ],
      {
        workspaceId: undefined,
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );

    expect(overview.summary.totalTokens).toBe(0);
    expect(overview.summary.sessionCount).toBe(0);
    expect(overview.days).toHaveLength(7);
    expect(overview.days.every((day) => day.totalTokens === 0)).toBe(true);
  });

  it("formats usage numbers and estimated cost for dashboard labels", () => {
    expect(formatUsageNumber(180000000)).toBe("1.8亿");
    expect(formatUsageNumber(12000)).toBe("1.2万");
    expect(formatUsageNumber(1500, "compact")).toBe("1.5K");
    expect(formatUsageCost(0)).toBe("$0.00");
    expect(formatUsageCost(0.004)).toBe("<$0.01");
    expect(formatUsageCost(18.424)).toBe("$18.42");
  });
});
