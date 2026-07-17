import { describe, expect, it } from "vitest";
import { GENERATED_UI_LIMITS, generatedUiToPlainText, normalizeGeneratedUi } from "./generated-ui";

describe("generated ui v2 normalization", () => {
  it("normalizes comprehensive v2 sections and filters unsafe actions", () => {
    const card = normalizeGeneratedUi({
      operation: "upsert",
      card: {
        version: "v2",
        id: "delivery",
        title: "交付",
        sections: [
          { id: "metrics", kind: "metric_grid", items: [{ id: "tests", label: "测试", value: 12 }] },
          { id: "table", kind: "table", columns: [{ key: "name", label: "名称", sortable: true }], rows: [{ name: "A" }] },
          { id: "chart", kind: "chart", chartType: "bar", xKey: "name", summary: "A 最高", series: [{ key: "value" }], data: [{ name: "A", value: 3 }] },
          { id: "form", kind: "form", fields: [{ id: "target", kind: "select", label: "环境", options: [{ label: "测试", value: "test" }] }] },
          { id: "actions", kind: "action_bar", actions: [
            { id: "copy", label: "复制", kind: "copy-text", value: "done" },
            { id: "unsafe", label: "执行", kind: "run-command", value: "rm -rf ." },
            { id: "bad-url", label: "链接", kind: "open-url", value: "javascript:alert(1)" },
          ] },
        ],
      },
    });

    expect(card).toMatchObject({ version: "v2", id: "delivery", title: "交付" });
    expect(card?.sections.map((section) => section.kind)).toEqual(["metric_grid", "table", "chart", "form", "action_bar"]);
    const actionSection = card?.sections.find((section) => section.kind === "action_bar");
    expect(actionSection && "actions" in actionSection ? actionSection.actions : []).toEqual([
      expect.objectContaining({ id: "copy", kind: "copy-text" }),
    ]);
  });

  it("enforces collection limits and rejects oversized payloads", () => {
    const rows = Array.from({ length: GENERATED_UI_LIMITS.maxTableRows + 20 }, (_, index) => ({ name: `row-${index}` }));
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "limited",
      sections: [{ id: "table", kind: "table", columns: [{ key: "name", label: "名称" }], rows }],
    });
    const table = card?.sections.find((section) => section.kind === "table");
    expect(table && "rows" in table ? table.rows : []).toHaveLength(GENERATED_UI_LIMITS.maxTableRows);
    expect(normalizeGeneratedUi({ version: "v2", id: "huge", sections: [{ id: "md", kind: "markdown", content: "x".repeat(GENERATED_UI_LIMITS.maxBytes) }] })).toBeNull();
  });

  it("keeps v1 compatibility and exports v2 as readable text", () => {
    const legacy = normalizeGeneratedUi({ id: "legacy", kind: "result-summary", title: "结果", content: "完成" });
    expect(legacy).toMatchObject({ version: "v1", id: "legacy" });

    const card = normalizeGeneratedUi({
      version: "v2",
      id: "plain",
      title: "报告",
      sections: [
        { id: "progress", kind: "progress", items: [{ id: "p", label: "进度", value: 8, max: 10 }] },
        { id: "chart", kind: "chart", chartType: "line", xKey: "x", summary: "趋势向上", series: [{ key: "y" }], data: [{ x: 1, y: 2 }] },
      ],
    });
    expect(generatedUiToPlainText(card ?? undefined)).toContain("进度: 8/10");
    expect(generatedUiToPlainText(card ?? undefined)).toContain("趋势向上");
  });
});
