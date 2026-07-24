import { describe, expect, it } from "vitest";
import type { GeneratedUiCard } from "@shared";
import {
  mapPlanStepStatus,
  mapUiStatus,
  tasksFromGeneratedUi,
  tasksFromListItems,
  tasksFromMessages,
} from "./TaskOverviewPanel";

describe("mapPlanStepStatus", () => {
  it("maps plan step statuses to TaskStatus", () => {
    expect(mapPlanStepStatus("running")).toBe("running");
    expect(mapPlanStepStatus("completed")).toBe("completed");
    expect(mapPlanStepStatus("failed")).toBe("failed");
    expect(mapPlanStepStatus("blocked")).toBe("failed");
    expect(mapPlanStepStatus("pending")).toBe("pending");
    expect(mapPlanStepStatus("waiting")).toBe("pending");
  });
});

describe("mapUiStatus", () => {
  it("normalizes English and Chinese labels", () => {
    expect(mapUiStatus(undefined)).toBe("pending");
    expect(mapUiStatus("in_progress")).toBe("running");
    expect(mapUiStatus("进行中")).toBe("running");
    expect(mapUiStatus("done")).toBe("completed");
    expect(mapUiStatus("完成")).toBe("completed");
    expect(mapUiStatus("error")).toBe("failed");
    expect(mapUiStatus("失败")).toBe("failed");
    expect(mapUiStatus("unknown")).toBe("pending");
  });
});

describe("tasksFromListItems / GeneratedUi / messages", () => {
  it("skips empty labels and falls back id to name", () => {
    expect(
      tasksFromListItems([
        { id: "", label: "  ", status: "pending" },
        { id: "", label: "Step A", status: "running" },
        { id: "s2", label: "Step B", status: "done" },
      ]),
    ).toEqual([
      { id: "Step A", name: "Step A", status: "running" },
      { id: "s2", name: "Step B", status: "completed" },
    ]);
  });

  it("collects steps from relevant generated-ui sections", () => {
    const card: GeneratedUiCard = {
      version: "v1",
      id: "card-build",
      sections: [
        {
          id: "sec-steps",
          kind: "steps",
          items: [{ id: "1", label: "Build", status: "running" }],
        },
        {
          id: "sec-md",
          kind: "markdown",
          content: "ignore",
        },
      ],
    };
    expect(tasksFromGeneratedUi(card)).toEqual([
      { id: "1", name: "Build", status: "running" },
    ]);
    expect(tasksFromGeneratedUi(undefined)).toEqual([]);
  });

  it("prefers newest message card with tasks", () => {
    const messages = [
      {
        generatedUi: {
          version: "v1" as const,
          id: "old-card",
          sections: [
            {
              id: "old-sec",
              kind: "steps" as const,
              items: [{ id: "old", label: "Old", status: "done" }],
            },
          ],
        } satisfies GeneratedUiCard,
      },
      { generatedUi: undefined },
      {
        generatedUi: {
          version: "v1" as const,
          id: "new-card",
          sections: [
            {
              id: "new-sec",
              kind: "status_list" as const,
              items: [{ id: "new", label: "New", status: "running" }],
            },
          ],
        } satisfies GeneratedUiCard,
      },
    ];
    expect(tasksFromMessages(messages)).toEqual([
      { id: "new", name: "New", status: "running" },
    ]);
    expect(tasksFromMessages([])).toEqual([]);
  });

  // wave-139 residual
  it("mapUiStatus covers progress/success/skipped/blocked and mixed case", () => {
    expect(mapUiStatus("PROGRESS")).toBe("running");
    expect(mapUiStatus("Success")).toBe("completed");
    expect(mapUiStatus("SKIPPED")).toBe("completed");
    expect(mapUiStatus("Blocked")).toBe("failed");
    expect(mapUiStatus("  ")).toBe("pending");
  });

  it("collects file_list sections and ignores empty cards", () => {
    const card: GeneratedUiCard = {
      version: "v1",
      id: "files",
      sections: [
        {
          id: "files-sec",
          kind: "file_list",
          items: [
            { id: "f1", label: "src/a.ts", status: "done" },
            { id: "f2", label: "  ", status: "running" },
          ],
        },
        {
          id: "kv",
          kind: "key_value",
          items: [{ id: "k", key: "x", value: "y" }],
        },
      ],
    };
    expect(tasksFromGeneratedUi(card)).toEqual([
      { id: "f1", name: "src/a.ts", status: "completed" },
    ]);
    expect(tasksFromGeneratedUi({ version: "v1", id: "empty", sections: [] })).toEqual([]);
  });

  it("tasksFromMessages walks past empty cards to older non-empty card", () => {
    const messages = [
      {
        generatedUi: {
          version: "v1" as const,
          id: "has",
          sections: [
            {
              id: "s",
              kind: "steps" as const,
              items: [{ id: "only", label: "Only", status: "pending" }],
            },
          ],
        } satisfies GeneratedUiCard,
      },
      {
        generatedUi: {
          version: "v1" as const,
          id: "empty-steps",
          sections: [
            {
              id: "s2",
              kind: "steps" as const,
              items: [{ id: "", label: "   ", status: "running" }],
            },
          ],
        } satisfies GeneratedUiCard,
      },
    ];
    // newest card has only blank labels → empty; fall back to older card
    expect(tasksFromMessages(messages)).toEqual([
      { id: "only", name: "Only", status: "pending" },
    ]);
  });
});
