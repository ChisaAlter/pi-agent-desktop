import { describe, expect, it } from "vitest";
import { GENERATED_UI_LIMITS, contentWithGeneratedUiText, generatedUiToPlainText, normalizeGeneratedUi } from "./generated-ui";

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

describe("contentWithGeneratedUiText", () => {
  it("returns content, card text, or merged form without duplicating equal bodies", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "plain",
      title: "报告",
      sections: [
        { id: "progress", kind: "progress", items: [{ id: "p", label: "进度", value: 8, max: 10 }] },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(contentWithGeneratedUiText("", card ?? undefined)).toBe(plain);
    expect(contentWithGeneratedUiText("hello", undefined)).toBe("hello");
    expect(contentWithGeneratedUiText(plain, card ?? undefined)).toBe(plain.trim());
    expect(contentWithGeneratedUiText("note", card ?? undefined)).toBe(`note
${plain}`);
  });
});

describe("generated ui residual (wave-110)", () => {
  it("returns null for empty/non-object payloads and oversized non-card data", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi(undefined)).toBeNull();
    expect(normalizeGeneratedUi(42)).toBeNull();
    expect(normalizeGeneratedUi({})).toBeNull();
    expect(normalizeGeneratedUi({ version: "v2", id: "no-sections" })).toBeNull();
  });

  it("cloneGeneratedUiCard deep-clones and treats undefined as undefined", async () => {
    const { cloneGeneratedUiCard } = await import("./generated-ui");
    expect(cloneGeneratedUiCard(undefined)).toBeUndefined();
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "clone-me",
      title: "T",
      sections: [{ id: "md", kind: "markdown", content: "body" }],
    });
    expect(card).not.toBeNull();
    const cloned = cloneGeneratedUiCard(card!);
    expect(cloned).toEqual(card);
    expect(cloned).not.toBe(card);
    if (cloned && card) {
      cloned.title = "mutated";
      expect(card.title).toBe("T");
    }
  });

  it("renders form/list/key_value/callout/timeline plain-text lines", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "plain-sections",
      title: "交付面板",
      subtitle: "副标题",
      sections: [
        { id: "callout", kind: "callout", title: "注意", content: "检查路径" },
        {
          id: "steps",
          kind: "steps",
          items: [{ id: "s1", label: "构建", status: "done", description: "ok", path: "apps/desktop" }],
        },
        {
          id: "kv",
          kind: "key_value",
          items: [{ id: "k1", key: "环境", value: "test" }],
        },
        {
          id: "timeline",
          kind: "timeline",
          items: [{ id: "t1", time: "10:00", title: "开始", description: "init" }],
        },
        {
          id: "form",
          kind: "form",
          fields: [
            { id: "name", kind: "text", label: "名称", required: true },
            { id: "opt", kind: "text", label: "可选" },
          ],
        },
      ],
    });
    const text = generatedUiToPlainText(card ?? undefined);
    expect(text).toContain("交付面板");
    expect(text).toContain("副标题");
    expect(text).toContain("注意");
    expect(text).toContain("构建 - (done) - ok - apps/desktop");
    expect(text).toContain("环境: test");
    expect(text).toContain("10:00 开始 - init");
    expect(text).toContain("表单字段: 名称 (必填)");
    expect(text).toContain("表单字段: 可选");
    expect(text).not.toContain("表单字段: 可选 (必填)");
  });
});

// wave-122 residual
describe("generated ui residual (wave-122)", () => {
  it("drops unknown section kinds while keeping valid ones", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "mixed",
      title: "Mixed",
      sections: [
        { id: "md", kind: "markdown", content: "hello" },
        { id: "bad", kind: "not-a-kind", content: "x" },
        // v2 sanitize path keeps callout; bare "summary" is not a v2 section kind
        { id: "call", kind: "callout", title: "Note", content: "done" },
      ],
    });
    expect(card).not.toBeNull();
    const kinds = (card as { sections: Array<{ kind: string }> }).sections.map((s) => s.kind);
    expect(kinds).toEqual(["markdown", "callout"]);
    expect(kinds).not.toContain("not-a-kind");
  });

  it("returns null when all sections are invalid", () => {
    expect(
      normalizeGeneratedUi({
        version: "v2",
        id: "empty-valid",
        title: "T",
        sections: [{ id: "x", kind: "nope" }],
      }),
    ).toBeNull();
  });

  it("generatedUiToPlainText returns empty for undefined/null cards", async () => {
    const { generatedUiToPlainText } = await import("./generated-ui");
    expect(generatedUiToPlainText(undefined)).toBe("");
    expect(generatedUiToPlainText(null as never)).toBe("");
  });

  it("contentWithGeneratedUiText merges distinct content and card text", async () => {
    const { contentWithGeneratedUiText } = await import("./generated-ui");
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "c1",
      title: "Title",
      sections: [{ id: "md", kind: "markdown", content: "from-ui" }],
    });
    // product: non-empty content + different card text → merge with newline
    expect(contentWithGeneratedUiText("body text", card ?? undefined)).toBe("body text\nTitle\nfrom-ui");
    // empty/whitespace content falls back to card text only
    expect(contentWithGeneratedUiText("", card ?? undefined)).toContain("Title");
    expect(contentWithGeneratedUiText("   ", card ?? undefined)).toContain("from-ui");
    // equal bodies do not duplicate
    const plain = contentWithGeneratedUiText("Title\nfrom-ui", card ?? undefined);
    expect(plain).toBe("Title\nfrom-ui");
  });

  // wave-128 residual
  it("normalizeGeneratedUi rejects non-objects and missing sections", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi("card")).toBeNull();
    expect(normalizeGeneratedUi(42)).toBeNull();
    expect(normalizeGeneratedUi({ version: "v2", id: "x", title: "t" })).toBeNull();
  });

  it("contentWithGeneratedUiText returns content alone when card missing", async () => {
    const { contentWithGeneratedUiText } = await import("./generated-ui");
    expect(contentWithGeneratedUiText("only-body", undefined)).toBe("only-body");
    expect(contentWithGeneratedUiText("", undefined)).toBe("");
  });

  // wave-142 residual
  it("normalizes v1 cards with markdown fallback content and title-only", () => {
    const withFallback = normalizeGeneratedUi({
      version: "v1",
      id: "v1-fb",
      title: "计划",
      sections: [],
      content: "fallback body",
    });
    expect(withFallback).toMatchObject({
      version: "v1",
      id: "v1-fb",
      title: "计划",
    });
    expect(withFallback?.sections).toEqual([
      expect.objectContaining({ kind: "markdown", content: "fallback body" }),
    ]);

    const titleOnly = normalizeGeneratedUi({
      version: "v1",
      id: "title-only",
      title: "仅标题",
      sections: [],
    });
    expect(titleOnly).toMatchObject({ version: "v1", title: "仅标题", sections: [] });
  });

  it("cloneGeneratedUiCard deep-clones and returns undefined for missing card", async () => {
    const { cloneGeneratedUiCard } = await import("./generated-ui");
    expect(cloneGeneratedUiCard(undefined)).toBeUndefined();
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "clone-me",
      title: "T",
      sections: [{ id: "kv", kind: "key_value", items: [{ id: "k1", key: "a", value: "1" }] }],
    });
    expect(card).not.toBeNull();
    const cloned = cloneGeneratedUiCard(card ?? undefined);
    expect(cloned).toEqual(card);
    expect(cloned).not.toBe(card);
    if (cloned && card && "sections" in cloned && "sections" in card) {
      expect(cloned.sections).not.toBe(card.sections);
    }
  });

  it("generatedUiToPlainText covers key_value, action_bar, form, and subtitle", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "plain",
      title: "标题",
      subtitle: "副标题",
      sections: [
        { id: "kv", kind: "key_value", items: [{ id: "i1", key: "文件", value: "a.ts" }] },
        {
          id: "ab",
          kind: "action_bar",
          actions: [{ id: "c", label: "复制", kind: "copy-text", value: "done" }],
        },
        {
          id: "fm",
          kind: "form",
          fields: [{ id: "f1", kind: "text", label: "名称", required: true }],
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("标题");
    expect(plain).toContain("副标题");
    expect(plain).toContain("文件: a.ts");
    expect(plain).toContain("操作: 复制 -> done");
    expect(plain).toContain("表单字段: 名称 (必填)");
  });

  // wave-155 residual
  it("treats non-v2 version with sections array as v1 (product fallthrough)", () => {
    // product: only version === "v2" takes normalizeV2; other versions with sections
    // arrays are accepted as v1 cards
    const card = normalizeGeneratedUi({
      version: "v3",
      id: "x",
      title: "t",
      sections: [],
    });
    expect(card).toMatchObject({ version: "v1", id: "x", title: "t", sections: [] });
  });

  it("contentWithGeneratedUiText appends plain text when card present", async () => {
    const { contentWithGeneratedUiText, generatedUiToPlainText } = await import("./generated-ui");
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "append",
      title: "卡片",
      sections: [{ id: "md", kind: "markdown", content: "正文" }],
    });
    expect(card).not.toBeNull();
    const plain = generatedUiToPlainText(card ?? undefined);
    const combined = contentWithGeneratedUiText("用户消息", card ?? undefined);
    expect(combined).toContain("用户消息");
    expect(combined).toContain(plain);
  });

  it("normalizeGeneratedUi accepts markdown-only v2 section cards", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "md-only",
      title: "说明",
      sections: [{ id: "s1", kind: "markdown", content: "# Hello" }],
    });
    expect(card).toMatchObject({
      version: "v2",
      id: "md-only",
      title: "说明",
    });
    expect(card?.sections?.[0]).toMatchObject({ kind: "markdown", content: "# Hello" });
  });
});

// wave-168 residual
describe("generated ui residual (wave-168)", () => {
  it("returns null for non-objects, empty objects, and oversized payloads", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi("card")).toBeNull();
    expect(normalizeGeneratedUi([])).toBeNull();
    expect(normalizeGeneratedUi({})).toBeNull();
    const huge = { title: "x", content: "y".repeat(GENERATED_UI_LIMITS.maxBytes + 1) };
    expect(normalizeGeneratedUi(huge)).toBeNull();
  });

  it("unwraps operation upsert card envelope", () => {
    const card = normalizeGeneratedUi({
      operation: "upsert",
      card: {
        version: "v1",
        id: "env",
        title: "Env",
        sections: [{ id: "s", kind: "summary", content: "ok" }],
      },
    });
    expect(card).toMatchObject({ version: "v1", id: "env", title: "Env" });
  });

  it("falls back content field to markdown section when sections empty", () => {
    const card = normalizeGeneratedUi({
      id: "fb",
      title: "T",
      sections: [],
      content: "fallback body",
    });
    expect(card?.sections).toEqual([
      expect.objectContaining({ id: "markdown_fallback", kind: "markdown", content: "fallback body" }),
    ]);
  });

  it("cloneGeneratedUiCard deep-clones nested sections", async () => {
    const { cloneGeneratedUiCard } = await import("./generated-ui");
    const original = normalizeGeneratedUi({
      version: "v1",
      id: "c1",
      title: "t",
      sections: [{ id: "s1", kind: "key_value", items: [{ id: "k1", key: "a", value: "1" }] }],
    });
    expect(original).not.toBeNull();
    const cloned = cloneGeneratedUiCard(original!);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    if (cloned && original && cloned.sections[0] && "items" in cloned.sections[0]) {
      expect(cloned.sections[0]).not.toBe(original.sections[0]);
    }
  });

  it("generatedUiToPlainText renders key_value and action_bar lines", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "plain",
      title: "标题",
      sections: [
        { id: "kv", kind: "key_value", items: [{ id: "i1", key: "文件", value: "a.ts" }] },
        {
          id: "ab",
          kind: "action_bar",
          actions: [{ id: "a1", label: "复制", kind: "copy-text", value: "x" }],
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("标题");
    expect(plain).toContain("文件: a.ts");
    expect(plain).toContain("操作: 复制 -> x");
  });

  it("contentWithGeneratedUiText prefers content when equal to plain card text after trim", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "eq",
      title: "Same",
      sections: [{ id: "s", kind: "summary", content: "body" }],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(contentWithGeneratedUiText(plain, card ?? undefined)).toBe(plain.trim());
    expect(contentWithGeneratedUiText(`  ${plain}  `, card ?? undefined)).toBe(plain.trim());
  });
});

// wave-186 residual
describe("generated ui residual (wave-186)", () => {
  it("contentWithGeneratedUiText uses card-only when content blank and content-only when card empty", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "c",
      title: "T",
      sections: [{ id: "s", kind: "summary", content: "body" }],
    });
    expect(contentWithGeneratedUiText("", card ?? undefined)).toBe(generatedUiToPlainText(card ?? undefined));
    expect(contentWithGeneratedUiText("   ", card ?? undefined)).toBe(generatedUiToPlainText(card ?? undefined));
    expect(contentWithGeneratedUiText("hello", undefined)).toBe("hello");
    expect(contentWithGeneratedUiText("hello", normalizeGeneratedUi({ version: "v1", id: "empty", sections: [] }) ?? undefined)).toBe("hello");
  });

  it("contentWithGeneratedUiText concatenates when content and card text differ", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "c2",
      title: "CardTitle",
      sections: [{ id: "s", kind: "summary", content: "card-body" }],
    });
    const out = contentWithGeneratedUiText("user content", card ?? undefined);
    expect(out).toContain("user content");
    expect(out).toContain("CardTitle");
    expect(out).toContain("card-body");
    expect(out).toBe(`user content\n${generatedUiToPlainText(card ?? undefined)}`);
  });

  it("normalizeGeneratedUi returns null for empty objects and non-objects", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi(undefined)).toBeNull();
    expect(normalizeGeneratedUi(42)).toBeNull();
    expect(normalizeGeneratedUi("x")).toBeNull();
    expect(normalizeGeneratedUi({})).toBeNull();
    expect(normalizeGeneratedUi({ version: "v1", sections: [] })).toBeNull();
  });

  it("generatedUiToPlainText returns empty for undefined and title-only cards", () => {
    expect(generatedUiToPlainText(undefined)).toBe("");
    const titled = normalizeGeneratedUi({ version: "v1", id: "t", title: "OnlyTitle", sections: [] });
    expect(generatedUiToPlainText(titled ?? undefined)).toBe("OnlyTitle");
  });
});

// wave-193 residual
describe("generated ui residual (wave-193)", () => {
  it("unwraps upsert envelope and keeps markdown fallback when sections empty", () => {
    const card = normalizeGeneratedUi({
      operation: "upsert",
      card: {
        version: "v1",
        id: "env",
        title: "EnvTitle",
        content: "fallback body",
        sections: [],
      },
    });
    expect(card).toMatchObject({ version: "v1", id: "env", title: "EnvTitle" });
    expect(card?.sections).toEqual([
      expect.objectContaining({ id: "markdown_fallback", kind: "markdown", content: "fallback body" }),
    ]);
  });

  it("key_value and progress sections render as plain lines", () => {
    // key_value is valid v1; progress is a v2 section kind
    const v1 = normalizeGeneratedUi({
      version: "v1",
      id: "kv",
      title: "Stats",
      sections: [
        { id: "kv1", kind: "key_value", items: [{ key: "files", value: "3" }] },
      ],
    });
    expect(generatedUiToPlainText(v1 ?? undefined)).toContain("files: 3");

    const v2 = normalizeGeneratedUi({
      version: "v2",
      id: "prog",
      title: "Build",
      sections: [
        {
          id: "p1",
          kind: "progress",
          items: [{ id: "i1", label: "build", value: 2, max: 5 }],
        },
      ],
    });
    const plain = generatedUiToPlainText(v2 ?? undefined);
    expect(plain).toContain("Build");
    expect(plain).toContain("build: 2/5");
  });

  it("contentWithGeneratedUiText returns content as-is when it equals plain card text", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "eq",
      title: "Same",
      sections: [{ id: "s", kind: "summary", content: "body" }],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(contentWithGeneratedUiText(plain, card ?? undefined)).toBe(plain);
    // leading/trailing whitespace on content is trimmed before equality
    expect(contentWithGeneratedUiText(`  ${plain}  `, card ?? undefined)).toBe(plain);
  });

  it("rejects oversized payloads via GENERATED_UI_LIMITS.maxBytes", () => {
    const huge = "x".repeat(GENERATED_UI_LIMITS.maxBytes + 1024);
    expect(
      normalizeGeneratedUi({
        version: "v1",
        id: "big",
        title: "T",
        sections: [{ id: "s", kind: "summary", content: huge }],
      }),
    ).toBeNull();
  });
});

// wave-199 residual
describe("generated ui residual (wave-199)", () => {
  it("table and form sections render caption/headers/rows and required fields", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "tf",
      title: "Report",
      sections: [
        {
          id: "t1",
          kind: "table",
          caption: "Stats",
          columns: [
            { key: "name", label: "Name", align: "left", format: "text" },
            { key: "n", label: "Count", align: "right", format: "number" },
          ],
          rows: [{ name: "a", n: 1 }, { name: "b", n: 2 }],
        },
        {
          id: "f1",
          kind: "form",
          fields: [
            { id: "q", kind: "text", label: "Question", required: true },
            { id: "opt", kind: "text", label: "Optional" },
          ],
          submitLabel: "Go",
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("Report");
    expect(plain).toContain("Stats");
    expect(plain).toContain("Name | Count");
    expect(plain).toContain("a | 1");
    expect(plain).toContain("b | 2");
    expect(plain).toContain("表单字段: Question (必填)");
    expect(plain).toContain("表单字段: Optional");
  });

  it("chart requires chartType/xKey/summary/series/data; invalid chart drops section", () => {
    expect(
      normalizeGeneratedUi({
        version: "v2",
        id: "bad-chart",
        sections: [
          {
            id: "c1",
            kind: "chart",
            chartType: "bar",
            xKey: "x",
            // missing summary → null section → whole card null if only section
          },
        ],
      }),
    ).toBeNull();

    const ok = normalizeGeneratedUi({
      version: "v2",
      id: "ok-chart",
      title: "C",
      sections: [
        {
          id: "c1",
          kind: "chart",
          chartType: "line",
          xKey: "t",
          summary: "trend up",
          series: [{ key: "v", label: "Value" }],
          data: [{ t: "1", v: 3 }],
        },
      ],
    });
    expect(ok).toMatchObject({ version: "v2", id: "ok-chart" });
    expect(generatedUiToPlainText(ok ?? undefined)).toContain("trend up");
  });

  it("callout and metric_grid appear in plain text; boolean table cells stringify", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "cm",
      sections: [
        { id: "co", kind: "callout", title: "Warn", content: "careful", tone: "warning" },
        {
          id: "mg",
          kind: "metric_grid",
          items: [{ id: "m1", label: "ok", value: 1, detail: "yes" }],
        },
        {
          id: "tb",
          kind: "table",
          columns: [{ key: "flag", label: "Flag" }],
          rows: [{ flag: false }],
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("Warn");
    expect(plain).toContain("careful");
    expect(plain).toContain("ok: 1 - yes");
    expect(plain).toContain("false");
  });

  it("table columns default align left and format text; sortable only when true", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "col",
      sections: [
        {
          id: "t",
          kind: "table",
          columns: [
            { key: "a", label: "A", align: "bogus", format: "bogus", sortable: "yes" },
            { key: "b", label: "B", align: "center", format: "percent", sortable: true },
          ],
          rows: [{ a: "x", b: 50 }],
        },
      ],
    });
    expect(card?.version).toBe("v2");
    if (card?.version !== "v2") return;
    const table = card.sections.find((s) => s.kind === "table");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.columns[0]).toMatchObject({ align: "left", format: "text", sortable: false });
    expect(table.columns[1]).toMatchObject({ align: "center", format: "percent", sortable: true });
  });
});

// wave-207 residual
describe("generated ui residual (wave-207)", () => {
  it("v1 title-only card without sections is kept; empty object is null", () => {
    const titled = normalizeGeneratedUi({ title: "Only title", sections: [] });
    expect(titled).toMatchObject({ version: "v1", title: "Only title" });
    expect(titled?.sections).toEqual([]);
    expect(normalizeGeneratedUi({})).toBeNull();
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi("string")).toBeNull();
  });

  it("form required fields and timeline appear in plain text; null primitive cells empty", () => {
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "form-tl",
      title: "Card",
      subtitle: "Sub",
      sections: [
        {
          id: "f",
          kind: "form",
          fields: [
            { id: "n", kind: "text", label: "Name", required: true },
            { id: "o", kind: "text", label: "Optional", required: false },
          ],
        },
        {
          id: "tl",
          kind: "timeline",
          items: [
            { id: "i1", title: "Start", time: "10:00", description: "kickoff" },
            { id: "i2", title: "End" },
          ],
        },
        {
          id: "tb",
          kind: "table",
          columns: [{ key: "v", label: "V" }],
          rows: [{ v: null }, { v: true }, { v: 0 }],
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("Card");
    expect(plain).toContain("Sub");
    expect(plain).toContain("表单字段: Name (必填)");
    expect(plain).toContain("表单字段: Optional");
    expect(plain).not.toContain("Optional (必填)");
    expect(plain).toContain("10:00 Start - kickoff");
    expect(plain).toContain("End");
    expect(plain).toContain("true");
    expect(plain).toContain("0");
    // null cell becomes empty string between pipes — still has column header
    expect(plain).toContain("V");
  });

  it("contentWithGeneratedUiText keeps original content when card plain is empty", () => {
    // v2 card with only empty markdown content after sanitize may drop sections
    const emptySections = normalizeGeneratedUi({
      version: "v2",
      id: "emptyish",
      sections: [{ id: "m", kind: "markdown", content: "   " }],
    });
    // product: empty markdown content → section dropped → whole card null
    expect(emptySections).toBeNull();
    expect(contentWithGeneratedUiText("keep-me", undefined)).toBe("keep-me");
  });
});


// wave-216 residual
describe("generated ui residual (wave-216)", () => {
  it("rejects oversized payloads beyond GENERATED_UI_LIMITS.maxBytes", () => {
    const huge = {
      version: "v2",
      id: "huge",
      title: "t",
      sections: [
        {
          id: "m",
          kind: "markdown",
          content: "x".repeat(GENERATED_UI_LIMITS.maxBytes),
        },
      ],
    };
    expect(normalizeGeneratedUi(huge)).toBeNull();
  });

  it("caps v2 sections at maxSections and drops unknown section kinds", () => {
    const sections = Array.from({ length: GENERATED_UI_LIMITS.maxSections + 5 }, (_, i) => ({
      id: `s${i}`,
      kind: i === 0 ? "not_a_real_kind" : "markdown",
      content: `c${i}`,
    }));
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "cap",
      title: "Cap",
      sections,
    });
    expect(card?.version).toBe("v2");
    if (card?.version !== "v2") return;
    // slice(0, maxSections) then sanitize/filter: unknown at index 0 is dropped
    // → surviving markdown count is maxSections - 1
    expect(card.sections.length).toBe(GENERATED_UI_LIMITS.maxSections - 1);
    expect(card.sections.every((s) => s.kind === "markdown")).toBe(true);
  });

  it("contentWithGeneratedUiText appends plain card text to original content", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      title: "Report",
      sections: [{ id: "s", kind: "summary", content: "all green" }],
    });
    expect(contentWithGeneratedUiText("prefix", card ?? undefined)).toContain("prefix");
    expect(contentWithGeneratedUiText("prefix", card ?? undefined)).toContain("all green");
    expect(contentWithGeneratedUiText("", card ?? undefined)).toContain("Report");
  });

  // wave-259 residual
  it("normalizeGeneratedUi rejects non-objects; missing version falls through to v1 title card", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi("card")).toBeNull();
    // product: non-v2 with title becomes v1 even when sections empty
    const bare = normalizeGeneratedUi({ title: "x", sections: [] });
    expect(bare?.version).toBe("v1");
    if (bare?.version === "v1") {
      expect(bare.title).toBe("x");
      expect(bare.sections).toEqual([]);
    }
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "g1",
      title: "T",
      sections: [{ id: "s1", kind: "summary", content: "ok" }],
    });
    expect(card?.version).toBe("v1");
    if (card?.version !== "v1") return;
    expect(card.sections).toHaveLength(1);
    expect(card.sections[0]).toMatchObject({ kind: "summary", content: "ok" });
  });

  it("contentWithGeneratedUiText leaves content alone when card undefined/null-normalized", () => {
    expect(contentWithGeneratedUiText("only", undefined)).toBe("only");
    expect(contentWithGeneratedUiText("only", normalizeGeneratedUi(null) ?? undefined)).toBe("only");
  });


  // wave-271 residual
  it("generatedUiToPlainText includes title, key_value, callout, and action_bar lines", () => {
    // product: callout is v2-only; v1 sanitize drops unknown kinds
    const card = normalizeGeneratedUi({
      version: "v2",
      id: "g",
      title: "TitleLine",
      sections: [
        { id: "kv", kind: "key_value", items: [{ key: "env", value: "prod" }] },
        { id: "c", kind: "callout", title: "Note", content: "be careful" },
        {
          id: "a",
          kind: "action_bar",
          actions: [{ id: "copy", label: "复制", kind: "copy-text", value: "payload" }],
        },
      ],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(plain).toContain("TitleLine");
    expect(plain).toContain("env: prod");
    expect(plain).toContain("Note");
    expect(plain).toContain("be careful");
    expect(plain).toContain("操作: 复制 -> payload");
  });

  it("contentWithGeneratedUiText dedupes when content equals card plain text", () => {
    const card = normalizeGeneratedUi({
      version: "v1",
      id: "g",
      title: "Same",
      sections: [{ id: "s", kind: "summary", content: "body" }],
    });
    const plain = generatedUiToPlainText(card ?? undefined);
    expect(contentWithGeneratedUiText(plain, card ?? undefined)).toBe(plain);
    expect(contentWithGeneratedUiText("  ", card ?? undefined)).toBe(plain);
    expect(contentWithGeneratedUiText("prefix", card ?? undefined)).toBe(`prefix\n${plain}`);
  });


  // wave-279 residual
  it("normalizeGeneratedUi drops v1 callout; keeps summary; missing version becomes v1", () => {
    const v1 = normalizeGeneratedUi({
      id: "g",
      title: "T",
      sections: [
        { id: "s", kind: "summary", content: "sum" },
        { id: "c", kind: "callout", title: "N", content: "c" },
      ],
    });
    expect(v1?.version).toBe("v1");
    expect(v1?.sections.map((s) => s.kind)).toEqual(["summary"]);
    const plain = generatedUiToPlainText(v1 ?? undefined);
    expect(plain).toContain("T");
    expect(plain).toContain("sum");
    expect(plain).not.toContain("callout");
  });

  it("normalizeGeneratedUi returns null for non-object; empty sections card still has title", () => {
    expect(normalizeGeneratedUi(null)).toBeNull();
    expect(normalizeGeneratedUi("x")).toBeNull();
    const card = normalizeGeneratedUi({ version: "v1", id: "g", title: "OnlyTitle", sections: [] });
    expect(card?.title).toBe("OnlyTitle");
    expect(generatedUiToPlainText(card ?? undefined)).toContain("OnlyTitle");
  });

});
