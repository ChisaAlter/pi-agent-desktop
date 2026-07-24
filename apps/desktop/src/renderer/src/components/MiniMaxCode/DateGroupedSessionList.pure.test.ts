import { describe, expect, it } from "vitest";
import { getDateGroupLabel, groupSessionsByDate } from "./DateGroupedSessionList";
import type { Session } from "../../stores/session-store";

const t = (key: string): string => key;
// Local calendar anchors avoid UTC/local day-boundary flakiness.
const now = new Date(2026, 6, 21, 12, 0, 0); // 2026-07-21 local

function localDate(year: number, monthIndex: number, day: number, hour = 12): Date {
  return new Date(year, monthIndex, day, hour, 0, 0);
}

function sessionAt(id: string, date: Date): Session {
  return {
    id,
    title: id,
    workspaceId: "w1",
    messages: [],
    createdAt: date,
    updatedAt: date,
  } as Session;
}

describe("getDateGroupLabel", () => {
  it("classifies today / yesterday / week / month / earlier", () => {
    expect(getDateGroupLabel(localDate(2026, 6, 21, 8), t, now)).toBe(
      "sidebar.sessions.dateGroup.today",
    );
    expect(getDateGroupLabel(localDate(2026, 6, 20, 8), t, now)).toBe(
      "sidebar.sessions.dateGroup.yesterday",
    );
    expect(getDateGroupLabel(localDate(2026, 6, 16, 8), t, now)).toBe(
      "sidebar.sessions.dateGroup.thisWeek",
    );
    expect(getDateGroupLabel(localDate(2026, 6, 1, 8), t, now)).toBe(
      "sidebar.sessions.dateGroup.thisMonth",
    );
    expect(getDateGroupLabel(localDate(2026, 4, 1, 8), t, now)).toBe(
      "sidebar.sessions.dateGroup.earlier",
    );
  });
});

describe("groupSessionsByDate", () => {
  it("orders groups and sorts sessions by activity desc", () => {
    const sessions = [
      sessionAt("old", localDate(2026, 4, 1, 10)),
      sessionAt("today-late", localDate(2026, 6, 21, 18)),
      sessionAt("today-early", localDate(2026, 6, 21, 9)),
      sessionAt("yest", localDate(2026, 6, 20, 10)),
    ];
    const groups = groupSessionsByDate(sessions, t, now);
    expect(groups.map((g) => g.label)).toEqual([
      "sidebar.sessions.dateGroup.today",
      "sidebar.sessions.dateGroup.yesterday",
      "sidebar.sessions.dateGroup.earlier",
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["today-late", "today-early"]);
  });

  // wave-106 residual
  it("returns empty groups for empty input", () => {
    expect(groupSessionsByDate([], t, now)).toEqual([]);
  });

  it("classifies boundary days and future dates as product-defined buckets", () => {
    // diffDays === 7 → thisWeek; diffDays === 8 → thisMonth; diffDays === 30 → thisMonth; 31 → earlier
    expect(getDateGroupLabel(localDate(2026, 6, 14, 8), t, now)).toBe("sidebar.sessions.dateGroup.thisWeek");
    expect(getDateGroupLabel(localDate(2026, 6, 13, 8), t, now)).toBe("sidebar.sessions.dateGroup.thisMonth");
    expect(getDateGroupLabel(localDate(2026, 5, 21, 8), t, now)).toBe("sidebar.sessions.dateGroup.thisMonth");
    expect(getDateGroupLabel(localDate(2026, 5, 20, 8), t, now)).toBe("sidebar.sessions.dateGroup.earlier");
    // future dates yield negative diffDays → fall into thisWeek (<=7)
    expect(getDateGroupLabel(localDate(2026, 6, 22, 8), t, now)).toBe("sidebar.sessions.dateGroup.thisWeek");
  });
});


// wave-294 residual
describe("DateGroupedSessionList pure residual (wave-294)", () => {
  it("prefers updatedAt over createdAt via sessionActivityTime for bucketing and sort", () => {
    const createdOld = localDate(2026, 4, 1, 10);
    const updatedToday = localDate(2026, 6, 21, 15);
    const s = {
      id: "moved",
      title: "moved",
      workspaceId: "w1",
      messages: [],
      createdAt: createdOld,
      updatedAt: updatedToday,
    } as Session;
    // getDateGroupLabel on activity time would be today; groupSessionsByDate uses sessionActivityTime
    const groups = groupSessionsByDate([s], t, now);
    expect(groups.map((g) => g.label)).toEqual(["sidebar.sessions.dateGroup.today"]);
    expect(groups[0]?.sessions[0]?.id).toBe("moved");
  });

  it("omits empty buckets and keeps fixed group order when only week+earlier present", () => {
    const sessions = [
      sessionAt("week", localDate(2026, 6, 16, 10)),
      sessionAt("earlier", localDate(2026, 1, 1, 10)),
    ];
    const groups = groupSessionsByDate(sessions, t, now);
    expect(groups.map((g) => g.label)).toEqual([
      "sidebar.sessions.dateGroup.thisWeek",
      "sidebar.sessions.dateGroup.earlier",
    ]);
  });

  it("boundary: diffDays 0/1 exact and midnight session still uses calendar day floor", () => {
    expect(getDateGroupLabel(localDate(2026, 6, 21, 0), t, now)).toBe(
      "sidebar.sessions.dateGroup.today",
    );
    expect(getDateGroupLabel(localDate(2026, 6, 20, 23), t, now)).toBe(
      "sidebar.sessions.dateGroup.yesterday",
    );
    // same calendar day as now even if hour is later than now's clock
    expect(getDateGroupLabel(localDate(2026, 6, 21, 23), t, now)).toBe(
      "sidebar.sessions.dateGroup.today",
    );
  });
});

// wave-305 residual
describe("DateGroupedSessionList pure residual (wave-305)", () => {
  it("diffDays boundaries: 7 week, 8 month, 30 month, 31 earlier; negative future → thisWeek", () => {
    expect(getDateGroupLabel(localDate(2026, 6, 14, 12), t, now)).toBe("sidebar.sessions.dateGroup.thisWeek");
    expect(getDateGroupLabel(localDate(2026, 6, 13, 12), t, now)).toBe("sidebar.sessions.dateGroup.thisMonth");
    expect(getDateGroupLabel(localDate(2026, 5, 21, 12), t, now)).toBe("sidebar.sessions.dateGroup.thisMonth");
    expect(getDateGroupLabel(localDate(2026, 5, 20, 12), t, now)).toBe("sidebar.sessions.dateGroup.earlier");
    expect(getDateGroupLabel(localDate(2026, 6, 28, 12), t, now)).toBe("sidebar.sessions.dateGroup.thisWeek");
  });

  it("groupSessionsByDate sorts newest-first within group and preserves fixed order", () => {
    const sessions = [
      sessionAt("month", localDate(2026, 6, 1, 10)),
      sessionAt("today-a", localDate(2026, 6, 21, 8)),
      sessionAt("today-b", localDate(2026, 6, 21, 20)),
      sessionAt("yest", localDate(2026, 6, 20, 12)),
    ];
    const groups = groupSessionsByDate(sessions, t, now);
    expect(groups.map((g) => g.label)).toEqual([
      "sidebar.sessions.dateGroup.today",
      "sidebar.sessions.dateGroup.yesterday",
      "sidebar.sessions.dateGroup.thisMonth",
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["today-b", "today-a"]);
  });

  it("empty input yields empty array; single earlier session one group", () => {
    expect(groupSessionsByDate([], t, now)).toEqual([]);
    const only = groupSessionsByDate([sessionAt("old", localDate(2025, 1, 1, 10))], t, now);
    expect(only).toHaveLength(1);
    expect(only[0]?.label).toBe("sidebar.sessions.dateGroup.earlier");
  });
});
