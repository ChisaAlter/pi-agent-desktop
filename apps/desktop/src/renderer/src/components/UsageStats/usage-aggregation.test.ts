import { describe, expect, it } from "vitest";
import type { Session } from "../../stores/session-store";
import { buildUsageOverview, formatUsageDate, formatUsageNumber } from "./usage-aggregation";

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
    expect(overview.modelBreakdown[0]?.tooltip).not.toContain("预估费用");
    expect(overview.days.find((day) => day.date === "2026-06-20")?.tooltip).not.toContain("预估费用");
    expect(overview.sessions[0]?.tooltip).not.toContain("预估费用");
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

  it("formats usage numbers for dashboard labels", () => {
    expect(formatUsageNumber(180000000)).toBe("1.8亿");
    expect(formatUsageNumber(12000)).toBe("1.2万");
    expect(formatUsageNumber(1500, "compact")).toBe("1.5K");
  });

  // wave-137 residual
  it("formats compact M/K floors and undefined as 0", () => {
    expect(formatUsageNumber(undefined)).toBe("0");
    expect(formatUsageNumber(0, "compact")).toBe("0");
    expect(formatUsageNumber(999, "compact")).toBe("999");
    expect(formatUsageNumber(1_000_000, "compact")).toBe("1M");
    expect(formatUsageNumber(2_500_000, "compact")).toBe("2.5M");
    expect(formatUsageNumber(10_000)).toBe("1万");
    expect(formatUsageNumber(100_000_000)).toBe("1亿");
  });

  it("computes multi-day streak from contiguous end activity", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-a",
          usage: {
            inputTokens: 10,
            outputTokens: 0,
            updatedAt: new Date("2026-06-18T10:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-b",
          usage: {
            inputTokens: 20,
            outputTokens: 0,
            updatedAt: new Date("2026-06-19T10:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-c",
          usage: {
            inputTokens: 30,
            outputTokens: 0,
            updatedAt: new Date("2026-06-20T10:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );
    expect(overview.summary.activeDays).toBe(3);
    expect(overview.summary.currentStreakDays).toBe(3);
  });

  it("breaks streak when the latest day is idle", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-old",
          usage: {
            inputTokens: 50,
            outputTokens: 0,
            updatedAt: new Date("2026-06-18T10:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );
    expect(overview.summary.activeDays).toBe(1);
    expect(overview.summary.currentStreakDays).toBe(0);
  });

  it("splits model share and counts messages from messageCount or messages.length", () => {
    const overview = buildUsageOverview(
      [
        session({
          id: "s-1",
          messageCount: 4,
          usage: {
            provider: "a",
            model: "m1",
            inputTokens: 75,
            outputTokens: 0,
            updatedAt: new Date("2026-06-20T10:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-2",
          messages: [{ role: "user" }, { role: "assistant" }] as Session["messages"],
          usage: {
            provider: "b",
            model: "m2",
            inputTokens: 25,
            outputTokens: 0,
            updatedAt: new Date("2026-06-20T11:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );
    expect(overview.summary.totalTokens).toBe(100);
    expect(overview.summary.messageCount).toBe(6);
    expect(overview.modelBreakdown).toHaveLength(2);
    expect(overview.modelBreakdown[0]?.share).toBe(75);
    expect(overview.modelBreakdown[1]?.share).toBe(25);
  });

  it("skips sessions without usage and out-of-range timestamps", () => {
    const overview = buildUsageOverview(
      [
        session({ id: "no-usage" }),
        session({
          id: "too-old",
          usage: {
            inputTokens: 100,
            outputTokens: 0,
            updatedAt: new Date("2026-05-01T00:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "ok",
          usage: {
            inputTokens: 5,
            outputTokens: 5,
            totalTokens: 99,
            estimatedCostUsd: 1.5,
            updatedAt: new Date("2026-06-20T01:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );
    expect(overview.summary.sessionCount).toBe(1);
    // totalTokens prefers explicit usage.totalTokens
    expect(overview.summary.totalTokens).toBe(99);
    expect(overview.summary.estimatedCostUsd).toBe(1.5);
    expect(overview.summary.topModel?.provider).toBe("unknown");
  });

  // wave-300 residual
  it("formatUsageNumber cleanFixed strips trailing .0; zh/compact thresholds", () => {
    expect(formatUsageNumber(1000, "compact")).toBe("1K");
    expect(formatUsageNumber(1500, "compact")).toBe("1.5K");
    expect(formatUsageNumber(999, "compact")).toBe("999");
    expect(formatUsageNumber(1_000_000, "compact")).toBe("1M");
    expect(formatUsageNumber(1_500_000, "compact")).toBe("1.5M");
    expect(formatUsageNumber(10_000)).toBe("1万");
    expect(formatUsageNumber(15_000)).toBe("1.5万");
    expect(formatUsageNumber(100_000_000)).toBe("1亿");
    expect(formatUsageNumber(180_000_000)).toBe("1.8亿");
    expect(formatUsageNumber(9999)).toBe((9999).toLocaleString());
    expect(formatUsageNumber(undefined)).toBe("0");
  });

  it("buildUsageOverview exclusive day end; unknown provider/model; sessions sort by tokens; share 0 when empty", () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const overview = buildUsageOverview(
      [
        session({
          id: "s-hi",
          title: "High",
          usage: {
            provider: "p1",
            model: "m-hi",
            inputTokens: 90,
            outputTokens: 0,
            updatedAt: new Date("2026-06-20T01:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-lo",
          title: "Low",
          usage: {
            inputTokens: 10,
            outputTokens: 0,
            updatedAt: new Date("2026-06-19T01:00:00.000Z").getTime(),
          },
        }),
        session({
          id: "s-old",
          usage: {
            inputTokens: 999,
            outputTokens: 0,
            updatedAt: new Date("2026-06-01T00:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 3,
        now,
      },
    );
    expect(overview.summary.sessionCount).toBe(2);
    expect(overview.sessions.map((s) => s.id)).toEqual(["s-hi", "s-lo"]);
    expect(overview.sessions[0]?.totalTokens).toBeGreaterThan(overview.sessions[1]?.totalTokens ?? 0);
    expect(overview.sessions[1]?.provider).toBe("unknown");
    expect(overview.sessions[1]?.model).toBe("unknown");
    expect(overview.summary.topModel?.model).toBe("m-hi");
    expect(overview.days).toHaveLength(3);
    expect(overview.days.every((d) => /\d+月\d+日/.test(d.label))).toBe(true);
    expect(overview.modelBreakdown[0]?.tooltip).toContain("占比");
    expect(overview.modelBreakdown[0]?.share).toBe(90);

    const empty = buildUsageOverview([], {
      workspaceId: "ws-main",
      includeAllWorkspaces: false,
      includeArchived: false,
      days: 2,
      now,
    });
    expect(empty.summary.totalTokens).toBe(0);
    expect(empty.summary.topModel).toBeUndefined();
    expect(empty.modelBreakdown).toEqual([]);
    expect(empty.summary.currentStreakDays).toBe(0);
  });

  it("formatUsageDate uses zh-CN month/day; messageCount prefers messageCount over messages.length", () => {
    const ms = new Date("2026-06-20T10:00:00.000Z").getTime();
    const label = formatUsageDate(ms);
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);

    const overview = buildUsageOverview(
      [
        session({
          id: "s-mc",
          messageCount: 10,
          messages: [{ role: "user" }] as Session["messages"],
          usage: {
            inputTokens: 1,
            outputTokens: 0,
            updatedAt: new Date("2026-06-20T10:00:00.000Z").getTime(),
          },
        }),
      ],
      {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: false,
        days: 7,
        now: new Date("2026-06-20T12:00:00.000Z"),
      },
    );
    expect(overview.summary.messageCount).toBe(10);
    expect(overview.sessions[0]?.tooltip).toContain("更新时间");
  });




  // wave-306 residual
  describe("usage-aggregation residual (wave-306)", () => {
    it("formatUsageNumber zero and negative paths; compact under 1000 uses toLocaleString", () => {
      expect(formatUsageNumber(0)).toBe("0");
      expect(formatUsageNumber(0, "compact")).toBe("0");
      expect(formatUsageNumber(999, "compact")).toBe((999).toLocaleString());
      expect(formatUsageNumber(1000, "compact")).toBe("1K");
      expect(formatUsageNumber(9999)).toBe((9999).toLocaleString());
      expect(formatUsageNumber(10000)).toBe("1万");
      // cleanFixed: 2.0M strips trailing .0
      expect(formatUsageNumber(2_000_000, "compact")).toBe("2M");
      expect(formatUsageNumber(2_000_000_000)).toBe("20亿");
    });

    it("buildUsageOverview days=all grows dayBuckets only for observed dates; cost sums estimatedCostUsd", () => {
      const now = new Date("2026-07-15T12:00:00.000Z");
      const overview = buildUsageOverview(
        [
          session({
            id: "a",
            title: "A",
            usage: {
              provider: "p",
              model: "m1",
              inputTokens: 100,
              outputTokens: 50,
              estimatedCostUsd: 0.1,
              updatedAt: new Date("2026-01-01T08:00:00.000Z").getTime(),
            },
          }),
          session({
            id: "b",
            title: "B",
            usage: {
              provider: "p",
              model: "m2",
              inputTokens: 10,
              outputTokens: 5,
              estimatedCostUsd: 0.05,
              updatedAt: new Date("2026-07-15T08:00:00.000Z").getTime(),
            },
          }),
          session({
            id: "no-usage",
            title: "Skip",
          }),
        ],
        {
          workspaceId: "ws-main",
          includeAllWorkspaces: false,
          includeArchived: false,
          days: "all",
          now,
        },
      );
      expect(overview.summary.sessionCount).toBe(2);
      expect(overview.summary.inputTokens).toBe(110);
      expect(overview.summary.outputTokens).toBe(55);
      expect(overview.summary.estimatedCostUsd).toBeCloseTo(0.15);
      // days=all only includes dates that appeared (no zero-fill range)
      expect(overview.days.length).toBe(0); // product only fills dayBuckets via createDayBuckets when days !== "all"; for "all" Map starts empty and only updates when dayBucket exists → no day rows
      // sessions sorted by totalTokens desc
      expect(overview.sessions.map((s) => s.id)).toEqual(["a", "b"]);
      expect(overview.modelBreakdown).toHaveLength(2);
      expect(overview.summary.topModel?.model).toBe("m1");
    });

    it("workspace filter: missing workspaceId with includeAllWorkspaces false drops all; archived filter", () => {
      const now = new Date("2026-07-15T12:00:00.000Z");
      const sessions = [
        session({
          id: "keep",
          usage: {
            inputTokens: 5,
            outputTokens: 0,
            updatedAt: now.getTime(),
          },
        }),
        session({
          id: "arch",
          archived: true,
          usage: {
            inputTokens: 999,
            outputTokens: 0,
            updatedAt: now.getTime(),
          },
        }),
        session({
          id: "other-ws",
          workspaceId: "ws-other",
          usage: {
            inputTokens: 50,
            outputTokens: 0,
            updatedAt: now.getTime(),
          },
        }),
      ];
      const missingWs = buildUsageOverview(sessions, {
        workspaceId: null,
        includeAllWorkspaces: false,
        includeArchived: true,
        days: 7,
        now,
      });
      expect(missingWs.summary.sessionCount).toBe(0);

      const withArchived = buildUsageOverview(sessions, {
        workspaceId: "ws-main",
        includeAllWorkspaces: false,
        includeArchived: true,
        days: 7,
        now,
      });
      expect(withArchived.summary.sessionCount).toBe(2);
      expect(withArchived.sessions.map((s) => s.id).sort()).toEqual(["arch", "keep"]);

      const allWs = buildUsageOverview(sessions, {
        workspaceId: null,
        includeAllWorkspaces: true,
        includeArchived: false,
        days: 7,
        now,
      });
      expect(allWs.summary.sessionCount).toBe(2);
      expect(allWs.sessions.map((s) => s.id).sort()).toEqual(["keep", "other-ws"]);
    });
  });

});
