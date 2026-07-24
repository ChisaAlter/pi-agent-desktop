import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSessionSummaryTools, createMemoryTools, createAssetInventoryTools } = vi.hoisted(
  () => ({
    createSessionSummaryTools: vi.fn(() => [{ name: "session_summary_search" }]),
    createMemoryTools: vi.fn(() => [{ name: "memory_search" }, { name: "memory_write" }]),
    createAssetInventoryTools: vi.fn(() => [{ name: "skill_list" }]),
  }),
);

vi.mock("../tools/session-summary-tools", () => ({
  createSessionSummaryTools,
}));
vi.mock("../tools/memory-tools", () => ({
  createMemoryTools,
}));
vi.mock("../tools/asset-inventory-tools", () => ({
  createAssetInventoryTools,
}));

import {
  buildSubagentCustomTools,
  formatSubagentSummary,
  type SpawnableSubagentType,
} from "../spawn-handler";

describe("formatSubagentSummary", () => {
  it.each([
    ["success", { status: "success", lastAssistantText: "done" }, "[dream] done"],
    ["success default text", { status: "success" }, "[dream] completed"],
    ["cancelled", { status: "cancelled" }, "[dream] cancelled"],
    ["timeout", { status: "timeout" }, "[distill] timed out"],
    ["failed with error", { status: "failed", error: "boom" }, "[distill] failed: boom"],
    ["failed default", { status: "failed" }, "[dream] failed: unknown error"],
    ["unknown status", { status: "running" }, ""],
  ] as const)("%s", (_label, result, expected) => {
    const command: SpawnableSubagentType = expected.includes("distill") ? "distill" : "dream";
    expect(formatSubagentSummary(command, result)).toBe(expected);
  });
});

describe("buildSubagentCustomTools", () => {
  beforeEach(() => {
    createSessionSummaryTools.mockClear();
    createMemoryTools.mockClear();
    createAssetInventoryTools.mockClear();
  });

  it("returns empty when optional services are omitted", () => {
    expect(
      buildSubagentCustomTools({
        subagentType: "dream",
        workspaceId: "ws",
        workspacePath: "C:/w",
        sessionId: "s1",
      }),
    ).toEqual([]);
  });

  it("wires session summary + memory tools for dream", () => {
    const sessionSummaryService = { list: vi.fn() } as never;
    const memoryService = { search: vi.fn() } as never;
    const tools = buildSubagentCustomTools({
      subagentType: "dream",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s1",
      sessionSummaryService,
      memoryService,
    });
    expect(createSessionSummaryTools).toHaveBeenCalledWith(sessionSummaryService);
    expect(createMemoryTools).toHaveBeenCalled();
    expect(createAssetInventoryTools).not.toHaveBeenCalled();
    expect(tools.map((t) => (t as { name: string }).name)).toEqual([
      "session_summary_search",
      "memory_search",
      "memory_write",
    ]);
  });

  it("adds asset inventory tools only for distill when resourceLoader present", () => {
    const resourceLoader = { getSkills: vi.fn() } as never;
    const tools = buildSubagentCustomTools({
      subagentType: "distill",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s1",
      resourceLoader,
    });
    expect(createAssetInventoryTools).toHaveBeenCalledWith(resourceLoader);
    expect(tools.map((t) => (t as { name: string }).name)).toEqual(["skill_list"]);
  });

  it("does not add inventory tools for dream even with resourceLoader", () => {
    buildSubagentCustomTools({
      subagentType: "dream",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s1",
      resourceLoader: { getSkills: vi.fn() } as never,
    });
    expect(createAssetInventoryTools).not.toHaveBeenCalled();
  });

  // wave-227 residual
  it("distill wires summary + memory + inventory when all services present", () => {
    const sessionSummaryService = { list: vi.fn() } as never;
    const memoryService = { search: vi.fn() } as never;
    const resourceLoader = { getSkills: vi.fn() } as never;
    const tools = buildSubagentCustomTools({
      subagentType: "distill",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s1",
      sessionSummaryService,
      memoryService,
      resourceLoader,
    });
    expect(createSessionSummaryTools).toHaveBeenCalledWith(sessionSummaryService);
    expect(createMemoryTools).toHaveBeenCalled();
    expect(createAssetInventoryTools).toHaveBeenCalledWith(resourceLoader);
    expect(tools.map((t) => (t as { name: string }).name)).toEqual([
      "session_summary_search",
      "memory_search",
      "memory_write",
      "skill_list",
    ]);
  });

  it("formatSubagentSummary uses lastAssistantText only on success status", () => {
    expect(
      formatSubagentSummary("dream", {
        status: "failed",
        lastAssistantText: "should-not-appear",
        error: "e1",
      }),
    ).toBe("[dream] failed: e1");
    // product uses ?? so empty string is kept (not defaulted to "completed")
    expect(
      formatSubagentSummary("distill", {
        status: "success",
        lastAssistantText: "",
      }),
    ).toBe("[distill] ");
    expect(
      formatSubagentSummary("distill", {
        status: "success",
      }),
    ).toBe("[distill] completed");
    expect(formatSubagentSummary("dream", { status: "cancelled", lastAssistantText: "x" })).toBe(
      "[dream] cancelled",
    );
  });


  // wave-310 residual
  it("formatSubagentSummary tags command; default/unknown empty; timeout/failed messages", () => {
    expect(formatSubagentSummary("dream", { status: "timeout" })).toBe("[dream] timed out");
    expect(formatSubagentSummary("distill", { status: "failed" })).toBe("[distill] failed: unknown error");
    expect(formatSubagentSummary("distill", { status: "failed", error: "boom" })).toBe("[distill] failed: boom");
    expect(formatSubagentSummary("dream", { status: "running" })).toBe("");
    expect(formatSubagentSummary("dream", { status: "success", lastAssistantText: "ok" })).toBe("[dream] ok");
    // product ?? keeps empty string; cancelled ignores lastAssistantText
    expect(formatSubagentSummary("dream", { status: "success", lastAssistantText: "" })).toBe("[dream] ");
    expect(formatSubagentSummary("distill", { status: "cancelled", lastAssistantText: "x" })).toBe("[distill] cancelled");
  });

  it("buildSubagentCustomTools empty without optional services; dream ignores resourceLoader", () => {
    expect(
      buildSubagentCustomTools({
        subagentType: "dream",
        workspaceId: "ws",
        workspacePath: "C:/w",
        sessionId: "s",
      }),
    ).toEqual([]);
    expect(
      buildSubagentCustomTools({
        subagentType: "distill",
        workspaceId: "ws",
        workspacePath: "C:/w",
        sessionId: "s",
      }),
    ).toEqual([]);
    buildSubagentCustomTools({
      subagentType: "dream",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s",
      resourceLoader: { getSkills: vi.fn() } as never,
    });
    expect(createAssetInventoryTools).not.toHaveBeenCalled();
  });

  it("buildSubagentCustomTools wires only provided services; distill+loader adds inventory", () => {
    const sessionSummaryService = { list: vi.fn() } as never;
    const memoryService = { search: vi.fn() } as never;
    const onlySummary = buildSubagentCustomTools({
      subagentType: "dream",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s",
      sessionSummaryService,
    });
    expect(onlySummary.map((t) => (t as { name: string }).name)).toEqual(["session_summary_search"]);
    const onlyMemory = buildSubagentCustomTools({
      subagentType: "dream",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s",
      memoryService,
    });
    expect(onlyMemory.map((t) => (t as { name: string }).name)).toEqual(["memory_search", "memory_write"]);
    const distill = buildSubagentCustomTools({
      subagentType: "distill",
      workspaceId: "ws",
      workspacePath: "C:/w",
      sessionId: "s",
      resourceLoader: { getSkills: vi.fn() } as never,
    });
    expect(distill.map((t) => (t as { name: string }).name)).toEqual(["skill_list"]);
  });
});
