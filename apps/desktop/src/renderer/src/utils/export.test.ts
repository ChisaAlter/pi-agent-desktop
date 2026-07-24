import { describe, expect, it, vi } from "vitest";
import type { Session } from "../stores/session-store";
import { downloadFile, exportSessionAsHTML, exportSessionAsJSON, exportSessionAsMarkdown } from "./export";

describe("session export", () => {
  it("omits estimated cost from markdown usage statistics", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s1",
      title: "Token export",
      workspaceId: "w1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:00:00.000Z"),
      messages: [],
      usage: {
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500,
        estimatedCostUsd: 0.0123,
        updatedAt: new Date("2026-06-27T00:00:00.000Z").getTime(),
      },
    } satisfies Session);

    expect(markdown).toContain("- 总 Token: 1500");
    expect(markdown).not.toContain("预估费用");
    expect(markdown).not.toContain("$0.01");
  });

  it("includes generated ui text in markdown and html exports", () => {
    const session = {
      id: "s2",
      title: "Generated UI export",
      workspaceId: "w1",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-07-03T00:00:00.000Z"),
          generatedUi: {
            version: "v1",
            id: "ui-export",
            title: "交付结果",
            sections: [
              { id: "summary", kind: "summary", content: "已生成报告" },
              { id: "facts", kind: "key_value", items: [{ id: "k1", key: "文件", value: "docs/report.md" }] },
            ],
          },
        },
      ],
    } satisfies Session;

    const markdown = exportSessionAsMarkdown(session);
    const html = exportSessionAsHTML(session);

    expect(markdown).toContain("交付结果");
    expect(markdown).toContain("已生成报告");
    expect(markdown).toContain("文件: docs/report.md");
    expect(html).toContain("交付结果");
    expect(html).toContain("文件: docs/report.md");
  });

  // wave-105 residual
  it("exports JSON with ISO timestamps and preserves tags/summary", () => {
    const session = {
      id: "s-json",
      title: "JSON export",
      workspaceId: "w1",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-01T13:00:00.000Z"),
      tags: ["a", "b"],
      summary: "short",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hi",
          timestamp: new Date("2026-07-01T12:01:00.000Z"),
        },
      ],
    } satisfies Session;

    const parsed = JSON.parse(exportSessionAsJSON(session));
    expect(parsed.id).toBe("s-json");
    expect(parsed.createdAt).toBe("2026-07-01T12:00:00.000Z");
    expect(parsed.updatedAt).toBe("2026-07-01T13:00:00.000Z");
    expect(parsed.messages[0].timestamp).toBe("2026-07-01T12:01:00.000Z");
    expect(parsed.tags).toEqual(["a", "b"]);
    expect(parsed.summary).toBe("short");
  });

  it("includes tool-call summary in markdown and escapes HTML title", () => {
    const session = {
      id: "s3",
      title: `<script>alert("x")</script>`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "done <b>ok</b>",
          timestamp: new Date("2026-07-04T00:00:00.000Z"),
          toolCalls: [
            { id: "t1", name: "bash", status: "completed" },
            { id: "t2", name: "read", status: "error" },
          ],
        },
      ],
    } satisfies Session;

    const markdown = exportSessionAsMarkdown(session);
    expect(markdown).toContain("工具调用");
    expect(markdown).toContain("`bash`: completed");
    expect(markdown).toContain("`read`: error");

    const html = exportSessionAsHTML(session);
    expect(html).toContain("<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>");
    expect(html).toContain("done &lt;b&gt;ok&lt;/b&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("omits usage section when usage is absent and reports zero message count", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-empty",
      title: "Empty",
      workspaceId: "w1",
      createdAt: new Date("2026-07-05T00:00:00.000Z"),
      updatedAt: new Date("2026-07-05T00:00:00.000Z"),
      messages: [],
    } satisfies Session);
    expect(markdown).toContain("**消息数量**: 0");
    expect(markdown).not.toContain("## 使用统计");
  });

  // wave-114 residual
  it("accepts string message timestamps in markdown and JSON", () => {
    const session = {
      id: "s-str-ts",
      title: "String ts",
      workspaceId: "w1",
      createdAt: new Date("2026-07-06T00:00:00.000Z"),
      updatedAt: new Date("2026-07-06T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: "ping",
          timestamp: "2026-07-06T00:01:00.000Z" as unknown as Date,
        },
      ],
    } satisfies Session;

    const markdown = exportSessionAsMarkdown(session);
    expect(markdown).toContain("**你**");
    expect(markdown).toContain("ping");

    const parsed = JSON.parse(exportSessionAsJSON(session));
    expect(parsed.messages[0].timestamp).toBe("2026-07-06T00:01:00.000Z");
  });

  it("escapes ampersand and quote in HTML title and body", () => {
    const session = {
      id: "s-escape",
      title: `A & B "C"`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-06T00:00:00.000Z"),
      updatedAt: new Date("2026-07-06T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: `use A & B then "quote"`,
          timestamp: new Date("2026-07-06T00:00:00.000Z"),
        },
      ],
    } satisfies Session;

    const html = exportSessionAsHTML(session);
    // title uses escapeHtml (incl. quotes); body only escapes & < > then newlines
    expect(html).toContain("<title>A &amp; B &quot;C&quot;</title>");
    expect(html).toContain(`use A &amp; B then "quote"`);
    expect(html).toContain("共 1 条消息");
  });

  it("fills missing usage token fields with zero in markdown", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-partial-usage",
      title: "Partial usage",
      workspaceId: "w1",
      createdAt: new Date("2026-07-06T00:00:00.000Z"),
      updatedAt: new Date("2026-07-06T00:00:00.000Z"),
      messages: [],
      usage: {
        updatedAt: Date.now(),
      } as Session["usage"],
    } satisfies Session);

    expect(markdown).toContain("## 使用统计");
    expect(markdown).toContain("- 输入 Token: 0");
    expect(markdown).toContain("- 输出 Token: 0");
    expect(markdown).toContain("- 总 Token: 0");
  });

  // wave-124 residual
  it("includes tool call details in markdown export", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-tools",
      title: "Tools",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "done",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
          toolCalls: [
            { id: "t1", name: "read", status: "completed" },
            { id: "t2", name: "bash", status: "error" },
          ],
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("<details><summary>工具调用</summary>");
    expect(markdown).toContain("- `read`: completed");
    expect(markdown).toContain("- `bash`: error");
  });

  it("exports empty-title session headers without throwing", () => {
    const session = {
      id: "s-empty-title",
      title: "",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session;
    expect(exportSessionAsMarkdown(session)).toContain("# ");
    expect(exportSessionAsMarkdown(session)).toContain("**消息数量**: 0");
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.title).toBe("");
    expect(json.messages).toEqual([]);
    expect(exportSessionAsHTML(session)).toContain("<title></title>");
  });

  // wave-129 residual
  it("escapes HTML-sensitive titles and message content", () => {
    const session = {
      id: "s-xss",
      title: '<script>alert(1)</script>',
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: 'a <b>bold</b> & "q"',
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
      ],
    } satisfies Session;
    const html = exportSessionAsHTML(session);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("a &lt;b&gt;bold&lt;/b&gt; &amp; \"q\"");
  });

  it("marks user vs assistant roles in markdown export", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-roles",
      title: "Roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u1",
          role: "user",
          content: "hi",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a1",
          role: "assistant",
          content: "hello",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("### **你**");
    expect(markdown).toContain("### **AI**");
    expect(markdown).toContain("hi");
    expect(markdown).toContain("hello");
  });

  it("json export includes tags and summary when present", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-meta",
        title: "Meta",
        workspaceId: "w1",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
        messages: [],
        tags: ["a", "b"],
        summary: "short",
      } satisfies Session),
    );
    expect(json.tags).toEqual(["a", "b"]);
    expect(json.summary).toBe("short");
    expect(json.workspaceId).toBe("w1");
  });

  // wave-139 residual
  it("markdown treats non-user roles as AI and reports zero usage tokens", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-roles",
      title: "Roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "sys",
          role: "system" as Session["messages"][number]["role"],
          content: "sys-msg",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "tool",
          role: "tool" as Session["messages"][number]["role"],
          content: "tool-msg",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        updatedAt: Date.now(),
      },
    } satisfies Session);
    expect(markdown).toContain("### **AI**");
    expect(markdown).not.toContain("### **你**");
    expect(markdown).toContain("sys-msg");
    expect(markdown).toContain("tool-msg");
    expect(markdown).toContain("- 输入 Token: 0");
    expect(markdown).toContain("- 输出 Token: 0");
    expect(markdown).toContain("- 总 Token: 0");
    expect(markdown).toContain("**消息数量**: 2");
  });

  it("html labels user/assistant only and meta counts messages", () => {
    const html = exportSessionAsHTML({
      id: "s-html-roles",
      title: "HTML roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u",
          role: "user",
          content: "hi",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a",
          role: "assistant",
          content: "yo",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain('<span class="role">用户</span>');
    expect(html).toContain('<span class="role">AI</span>');
    expect(html).toContain("共 2 条消息");
    expect(html).toContain('class="message user"');
    expect(html).toContain('class="message assistant"');
  });

  it("json omits undefined tags/summary fields as nullish JSON values", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-empty-meta",
        title: "Empty meta",
        workspaceId: "w1",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
        messages: [],
      } satisfies Session),
    );
    expect(json.tags).toBeUndefined();
    expect(json.summary).toBeUndefined();
    expect(json.usage).toBeUndefined();
    expect(json.messages).toEqual([]);
  });

  // wave-144 residual
  it("markdown includes tool call summary details and escapes nothing in content", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-tools",
      title: "Tools",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "done",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
          toolCalls: [
            { id: "t1", name: "Read", status: "completed" },
            { id: "t2", name: "Bash", status: "error" },
          ],
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("工具调用");
    expect(markdown).toContain("`Read`: completed");
    expect(markdown).toContain("`Bash`: error");
  });

  it("html escapes title and message content special characters", () => {
    const html = exportSessionAsHTML({
      id: "s-escape",
      title: `A <B> & "C"`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: `<script>alert(1)</script>\nline2`,
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain("<title>A &lt;B&gt; &amp; &quot;C&quot;</title>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br>line2");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("json serializes tags/summary/usage and numeric timestamps", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-meta",
        title: "Meta",
        workspaceId: "w1",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T01:00:00.000Z"),
        tags: ["a", "b"],
        summary: "brief",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "hi",
            timestamp: 1_720_000_000_000 as never,
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          updatedAt: 99,
        },
      } satisfies Session),
    );
    expect(json.tags).toEqual(["a", "b"]);
    expect(json.summary).toBe("brief");
    expect(json.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      updatedAt: 99,
    });
    expect(json.messages[0].timestamp).toBe(1_720_000_000_000);
    expect(json.createdAt).toBe("2026-07-07T00:00:00.000Z");
  });

  it("empty session still emits markdown headers and html meta", () => {
    const session = {
      id: "s-empty",
      title: "Empty",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session;
    const markdown = exportSessionAsMarkdown(session);
    const html = exportSessionAsHTML(session);
    expect(markdown).toContain("# Empty");
    expect(markdown).toContain("**消息数量**: 0");
    expect(markdown).toContain("## 对话内容");
    expect(html).toContain("<h1>Empty</h1>");
    expect(html).toContain("共 0 条消息");
  });

  // wave-156 residual
  it("markdown labels user as 你 and assistant as AI", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-roles",
      title: "Roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u1",
          role: "user",
          content: "ping",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a1",
          role: "assistant",
          content: "pong",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("### **你**");
    expect(markdown).toContain("### **AI**");
    expect(markdown).toContain("ping");
    expect(markdown).toContain("pong");
  });

  it("markdown includes usage section only when usage is present", () => {
    const withUsage = exportSessionAsMarkdown({
      id: "s-u",
      title: "U",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, updatedAt: 0 },
    } satisfies Session);
    expect(withUsage).toContain("## 使用统计");
    expect(withUsage).toContain("输入 Token: 10");
    expect(withUsage).toContain("输出 Token: 20");
    expect(withUsage).toContain("总 Token: 30");

    const noUsage = exportSessionAsMarkdown({
      id: "s-n",
      title: "N",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session);
    expect(noUsage).not.toContain("## 使用统计");
  });

  it("json export keeps message id/role/content and omits undefined optional fields", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-j",
        title: "J",
        workspaceId: "ws",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
        messages: [
          {
            id: "m1",
            role: "user",
            content: "hi",
            timestamp: new Date("2026-07-07T00:00:00.000Z"),
          },
        ],
      } satisfies Session),
    );
    expect(json.workspaceId).toBe("ws");
    expect(json.messages[0]).toMatchObject({
      id: "m1",
      role: "user",
      content: "hi",
    });
    expect(json.messages[0].timestamp).toBe("2026-07-07T00:00:00.000Z");
    expect(json.tags).toBeUndefined();
    expect(json.summary).toBeUndefined();
  });

  // wave-164 residual
  it("html escapes title special characters and content angle brackets", () => {
    const html = exportSessionAsHTML({
      id: "s-esc",
      title: `A <B> & "C"`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: `<script>alert(1)</script> & ok`,
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain("A &lt;B&gt; &amp; &quot;C&quot;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; ok");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("class=\"message user\"");
  });

  it("markdown includes toolCalls details block with name and status", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-tools",
      title: "Tools",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "working",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
          toolCalls: [
            { id: "tc1", name: "bash", status: "completed" },
            { id: "tc2", name: "read", status: "error" },
          ],
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("<details><summary>工具调用</summary>");
    expect(markdown).toContain("`bash`: completed");
    expect(markdown).toContain("`read`: error");
  });

  it("markdown usage defaults missing token fields to 0", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-usage0",
      title: "U0",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
      usage: { updatedAt: 0 } as Session["usage"],
    } satisfies Session);
    expect(markdown).toContain("## 使用统计");
    expect(markdown).toContain("输入 Token: 0");
    expect(markdown).toContain("输出 Token: 0");
    expect(markdown).toContain("总 Token: 0");
  });

  it("html labels user as 用户 and assistant as AI", () => {
    const html = exportSessionAsHTML({
      id: "s-html-roles",
      title: "Roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u1",
          role: "user",
          content: "ping",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a1",
          role: "assistant",
          content: "pong",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain("class=\"message user\"");
    expect(html).toContain("class=\"message assistant\"");
    expect(html).toContain(">用户<");
    expect(html).toContain(">AI<");
  });

  // wave-178 residual
  it("markdown empty session still has header and zero message count", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-empty",
      title: "Empty",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session);
    expect(markdown).toContain("# Empty");
    expect(markdown).toContain("**消息数量**: 0");
    expect(markdown).toContain("## 对话内容");
    expect(markdown).not.toContain("## 使用统计");
  });

  it("json export serializes tags/summary when present and omits usage when missing", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-meta",
        title: "Meta",
        workspaceId: "ws",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T01:00:00.000Z"),
        messages: [],
        tags: ["a", "b"],
        summary: "sum",
      } satisfies Session),
    );
    expect(json.tags).toEqual(["a", "b"]);
    expect(json.summary).toBe("sum");
    expect(json.usage).toBeUndefined();
    expect(json.messages).toEqual([]);
  });

  it("markdown labels user as 你 and assistant as AI", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-roles",
      title: "Roles",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u1",
          role: "user",
          content: "hi",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a1",
          role: "assistant",
          content: "yo",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("### **你**");
    expect(markdown).toContain("### **AI**");
  });

  // wave-189 residual
  it("markdown includes usage section when present and serializes string timestamps in JSON", () => {
    const createdAt = new Date("2026-07-07T00:00:00.000Z");
    const updatedAt = new Date("2026-07-07T02:00:00.000Z");
    const session = {
      id: "s-usage",
      title: "Usage",
      workspaceId: "w1",
      createdAt,
      updatedAt,
      messages: [
        {
          id: "m1",
          role: "user" as const,
          content: "q",
          timestamp: "2026-07-07T00:30:00.000Z",
        },
      ],
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, updatedAt: 0 },
    } satisfies Session;
    const markdown = exportSessionAsMarkdown(session);
    expect(markdown).toContain("## 使用统计");
    expect(markdown).toContain("输入 Token: 10");
    expect(markdown).toContain("输出 Token: 20");
    expect(markdown).toContain("总 Token: 30");
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.createdAt).toBe(createdAt.toISOString());
    expect(json.updatedAt).toBe(updatedAt.toISOString());
    expect(json.messages[0].timestamp).toBe("2026-07-07T00:30:00.000Z");
    expect(json.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      updatedAt: 0,
    });
  });

  it("HTML escapeHtml on title quotes/ampersands; body escapes & < >", () => {
    const html = exportSessionAsHTML({
      id: "s-esc",
      title: 'A & B <C> "D"',
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "1 < 2 & 3 > 0",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain("<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>");
    expect(html).toContain("1 &lt; 2 &amp; 3 &gt; 0");
    expect(html).not.toContain("<title>A & B");
  });

  // wave-194 residual
  it("markdown includes toolCalls details block and zero usage tokens", () => {
    const session = {
      id: "s-tools",
      title: "Tools",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "done",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
          toolCalls: [
            { id: "t1", name: "bash", status: "completed" as const },
            { id: "t2", name: "read", status: "error" as const },
          ],
        },
      ],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, updatedAt: 0 },
    } satisfies Session;
    const markdown = exportSessionAsMarkdown(session);
    expect(markdown).toContain("工具调用");
    expect(markdown).toContain("`bash`: completed");
    expect(markdown).toContain("`read`: error");
    expect(markdown).toContain("输入 Token: 0");
    expect(markdown).toContain("输出 Token: 0");
    expect(markdown).toContain("总 Token: 0");
  });

  it("JSON export includes tags/summary and HTML labels 用户/AI", () => {
    const session = {
      id: "s-meta",
      title: "Meta",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      tags: ["alpha", "beta"],
      summary: "short summary",
      messages: [
        {
          id: "u",
          role: "user" as const,
          content: "hi",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a",
          role: "assistant" as const,
          content: "yo",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session;
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.tags).toEqual(["alpha", "beta"]);
    expect(json.summary).toBe("short summary");
    const html = exportSessionAsHTML(session);
    expect(html).toContain('<span class="role">用户</span>');
    expect(html).toContain('<span class="role">AI</span>');
    expect(html).toContain('class="message user"');
    expect(html).toContain('class="message assistant"');
  });

  // wave-199 residual
  it("html escapes title entities and preserves them in <title>/h1", () => {
    const html = exportSessionAsHTML({
      id: "s-esc",
      title: `A & B <C> "D"`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session);
    expect(html).toContain("<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>");
    expect(html).toContain("<h1>A &amp; B &lt;C&gt; &quot;D&quot;</h1>");
    expect(html).not.toContain("<title>A & B <C>");
  });

  it("json serializes string timestamps without Date conversion errors", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-str-ts",
        title: "ts",
        workspaceId: "w1",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
        messages: [
          {
            id: "m1",
            role: "user",
            content: "hi",
            // product accepts non-Date timestamps via ISO string passthrough
            timestamp: "2026-07-07T12:34:56.000Z" as unknown as Date,
          },
        ],
      } satisfies Session),
    );
    expect(json.messages[0].timestamp).toBe("2026-07-07T12:34:56.000Z");
  });

  it("markdown lists every toolCall name/status in details block", () => {
    const markdown = exportSessionAsMarkdown({
      id: "s-tools",
      title: "tools",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "a",
          role: "assistant",
          content: "done",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
          toolCalls: [
            { id: "t1", name: "read", status: "completed" },
            { id: "t2", name: "bash", status: "error" },
          ],
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("<details><summary>工具调用</summary>");
    expect(markdown).toContain("- `read`: completed");
    expect(markdown).toContain("- `bash`: error");
  });

  it("json omits tags/summary when undefined", () => {
    const json = JSON.parse(
      exportSessionAsJSON({
        id: "s-no-meta",
        title: "plain",
        workspaceId: "w1",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
        updatedAt: new Date("2026-07-07T00:00:00.000Z"),
        messages: [],
      } satisfies Session),
    );
    expect(json.tags).toBeUndefined();
    expect(json.summary).toBeUndefined();
    expect(json.usage).toBeUndefined();
  });

  // wave-208 residual
  it("html escapes title XSS and empty-message meta count", () => {
    const html = exportSessionAsHTML({
      id: "xss",
      title: `<script>alert(1)</script> & "t"`,
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [],
    } satisfies Session);
    expect(html).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;t&quot;</title>");
    expect(html).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;t&quot;</h1>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("共 0 条消息");
  });

  it("markdown usage defaults missing token fields to 0; user role label 你", () => {
    const markdown = exportSessionAsMarkdown({
      id: "usage-zero",
      title: "u",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      usage: {} as Session["usage"],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hello <b>",
          timestamp: new Date("2026-07-07T01:00:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(markdown).toContain("- 输入 Token: 0");
    expect(markdown).toContain("- 输出 Token: 0");
    expect(markdown).toContain("- 总 Token: 0");
    expect(markdown).toContain("**你**");
    expect(markdown).toContain("hello <b>");
    expect(markdown).toContain("**消息数量**: 1");
  });

  it("html escapes message angle brackets and maps assistant role to AI", () => {
    const html = exportSessionAsHTML({
      id: "roles",
      title: "r",
      workspaceId: "w1",
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
      messages: [
        {
          id: "u",
          role: "user",
          content: "a < b & c",
          timestamp: new Date("2026-07-07T00:00:00.000Z"),
        },
        {
          id: "a",
          role: "assistant",
          content: "ok",
          timestamp: new Date("2026-07-07T00:01:00.000Z"),
        },
      ],
    } satisfies Session);
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).toContain('class="message user"');
    expect(html).toContain('class="message assistant"');
    expect(html).toContain(">用户</span>");
    expect(html).toContain(">AI</span>");
    expect(html).toContain("共 2 条消息");
  });


  // wave-215 residual
  it("exportSessionAsMarkdown includes tool call summary and usage defaults", () => {
    const session = {
      id: "s1",
      title: "T <x>",
      workspaceId: "w1",
      createdAt: new Date("2026-01-02T03:04:00Z"),
      updatedAt: new Date("2026-01-02T04:05:00Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "hello",
          timestamp: new Date("2026-01-02T03:10:00Z"),
          toolCalls: [
            { id: "t1", name: "read", status: "completed" },
            { id: "t2", name: "bash", status: "error" },
          ],
        },
      ],
      usage: {},
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("# T <x>");
    expect(md).toContain("**消息数量**: 1");
    expect(md).toContain("输入 Token: 0");
    expect(md).toContain("输出 Token: 0");
    expect(md).toContain("总 Token: 0");
    expect(md).toContain("`read`: completed");
    expect(md).toContain("`bash`: error");
    expect(md).toContain("<details><summary>工具调用</summary>");
  });

  it("exportSessionAsHTML escapes title and content; exportSessionAsJSON serializes dates", () => {
    const session = {
      id: "s2",
      title: 'A & B <C> "D"',
      workspaceId: "w1",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-02T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: "line1\n<script>x</script>",
          timestamp: new Date("2026-02-01T01:00:00.000Z"),
        },
      ],
      tags: ["a"],
      summary: "sum",
    } as never;
    const html = exportSessionAsHTML(session);
    expect(html).toContain("A &amp; B &lt;C&gt; &quot;D&quot;");
    expect(html).toContain("line1<br>&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain('class="message user"');
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.id).toBe("s2");
    expect(json.createdAt).toBe("2026-02-01T00:00:00.000Z");
    expect(json.updatedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(json.messages[0].timestamp).toBe("2026-02-01T01:00:00.000Z");
    expect(json.tags).toEqual(["a"]);
    expect(json.summary).toBe("sum");
  });


  // wave-220 residual
  it("markdown toolCalls summary and usage defaults 0; empty title still emits headers", () => {
    const session = {
      id: "s-empty",
      title: "",
      workspaceId: "w1",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "done",
          timestamp: new Date("2026-07-21T00:01:00.000Z"),
          toolCalls: [
            { id: "t1", name: "bash", status: "completed" },
            { id: "t2", name: "read", status: "error" },
          ],
        },
      ],
      usage: {
        updatedAt: 1,
      },
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("# ");
    expect(md).toContain("**消息数量**: 1");
    expect(md).toContain("`bash`: completed");
    expect(md).toContain("`read`: error");
    expect(md).toContain("- 输入 Token: 0");
    expect(md).toContain("- 输出 Token: 0");
    expect(md).toContain("- 总 Token: 0");
  });

  it("HTML escapes ampersand quotes; JSON preserves workspaceId and usage object", () => {
    const session = {
      id: "s-esc",
      title: 'T & "Q"',
      workspaceId: "ws-1",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: 'a & b <c> "d"',
          timestamp: new Date("2026-07-21T00:01:00.000Z"),
        },
      ],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, updatedAt: 1 },
    } as never;
    const html = exportSessionAsHTML(session);
    // title uses escapeHtml (includes quotes); body content only escapes & < > + newlines
    expect(html).toContain("<title>T &amp; &quot;Q&quot;</title>");
    expect(html).toContain("<h1>T &amp; &quot;Q&quot;</h1>");
    expect(html).toContain('a &amp; b &lt;c&gt; "d"');
    expect(html).not.toContain('a & b');
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.workspaceId).toBe("ws-1");
    expect(json.usage.totalTokens).toBe(3);
    expect(json.title).toBe('T & "Q"');
  });

  // wave-256 residual
  it("markdown omits usage section when usage missing; empty messages still emit headers", () => {
    const session = {
      id: "s-empty",
      title: "Empty",
      workspaceId: "w",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      messages: [],
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("# Empty");
    expect(md).toContain("**消息数量**: 0");
    expect(md).toContain("## 对话内容");
    expect(md).not.toContain("## 使用统计");
    expect(md).not.toContain("输入 Token");
  });

  it("JSON serializes Date timestamps; HTML uses 用户/AI labels and counts messages", () => {
    const ts = new Date("2026-07-21T12:00:00.000Z");
    const session = {
      id: "s-json",
      title: "J",
      workspaceId: "ws",
      createdAt: ts,
      updatedAt: ts,
      messages: [
        { id: "m1", role: "user", content: "hi", timestamp: ts },
        { id: "m2", role: "assistant", content: "yo", timestamp: ts },
      ],
      tags: ["a"],
      summary: "sum",
    } as never;
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.createdAt).toBe(ts.toISOString());
    expect(json.messages[0].timestamp).toBe(ts.toISOString());
    expect(json.tags).toEqual(["a"]);
    expect(json.summary).toBe("sum");
    const html = exportSessionAsHTML(session);
    expect(html).toContain('<span class="role">用户</span>');
    expect(html).toContain('<span class="role">AI</span>');
    expect(html).toContain("共 2 条消息");
  });

  // wave-269 residual
  it("markdown merges generatedUi plain text; empty content uses card only", () => {
    const session = {
      id: "s-gui",
      title: "G",
      workspaceId: "w",
      createdAt: new Date("2026-07-22T00:00:00.000Z"),
      updatedAt: new Date("2026-07-22T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "hello",
          timestamp: new Date("2026-07-22T00:00:00.000Z"),
          generatedUi: {
            version: "v1",
            id: "g1",
            title: "Card",
            sections: [{ id: "s1", kind: "summary", content: "card-body" }],
          },
        },
        {
          id: "m2",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-07-22T00:00:00.000Z"),
          generatedUi: {
            version: "v1",
            id: "g2",
            title: "OnlyCard",
            sections: [{ id: "s2", kind: "summary", content: "only-card" }],
          },
        },
      ],
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("hello");
    expect(md).toContain("card-body");
    expect(md).toContain("only-card");
    const html = exportSessionAsHTML(session);
    expect(html).toContain("card-body");
    expect(html).toContain("only-card");
  });

  it("markdown toolCalls details + JSON string timestamps + HTML escapes generatedUi content", () => {
    const ts = "2026-07-22T01:00:00.000Z";
    const session = {
      id: "s-mix",
      title: 'Title <script>',
      workspaceId: "ws",
      createdAt: new Date(ts),
      updatedAt: new Date(ts),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "body",
          timestamp: ts,
          toolCalls: [
            { id: "t1", name: "bash", status: "completed" },
            { id: "t2", name: "read", status: "error" },
          ],
          generatedUi: {
            version: "v1",
            id: "g",
            title: "T",
            sections: [{ id: "s", kind: "summary", content: "x <y> & z" }],
          },
        },
      ],
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("`bash`: completed");
    expect(md).toContain("`read`: error");
    expect(md).toContain("工具调用");
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.messages[0].timestamp).toBe(ts);
    expect(json.createdAt).toBe(new Date(ts).toISOString());
    const html = exportSessionAsHTML(session);
    expect(html).toContain("Title &lt;script&gt;");
    expect(html).toContain("x &lt;y&gt; &amp; z");
  });

  // wave-282 residual
  it("markdown usage missing token fields coerce to 0; HTML roles and title escape quotes", () => {
    const session = {
      id: "s-282",
      title: 'Say "hello"',
      workspaceId: "ws",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      usage: {},
      messages: [
        {
          id: "m-u",
          role: "user",
          content: "hi",
          timestamp: new Date("2026-07-21T00:01:00.000Z"),
        },
        {
          id: "m-a",
          role: "assistant",
          content: "yo",
          timestamp: new Date("2026-07-21T00:02:00.000Z"),
        },
      ],
    } as never;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("- 输入 Token: 0");
    expect(md).toContain("- 输出 Token: 0");
    expect(md).toContain("- 总 Token: 0");
    expect(md).toContain("**你**");
    expect(md).toContain("**AI**");
    const html = exportSessionAsHTML(session);
    expect(html).toContain("Say &quot;hello&quot;");
    expect(html).toContain('class="message user"');
    expect(html).toContain('class="message assistant"');
    expect(html).toContain(">用户<");
    expect(html).toContain(">AI<");
    expect(html).toContain("共 2 条消息");
  });

  it("downloadFile creates blob link, clicks, cleans up, and revokes object URL", () => {
    const clicks: string[] = [];
    const appendChild = vi.fn((el: unknown) => el);
    const removeChild = vi.fn((el: unknown) => el);
    const createElement = vi.fn((tag: string) => {
      expect(tag).toBe("a");
      return {
        href: "",
        download: "",
        click(this: { download: string; href: string }) {
          clicks.push(`${this.download}|${this.href}`);
        },
      };
    });
    const createObjectURL = vi.fn(() => "blob:wave-282");
    const revokeObjectURL = vi.fn();

    const g = globalThis as Record<string, unknown>;
    const prevDoc = g.document;
    const prevBlob = g.Blob;
    const prevURL = g.URL;
    g.document = {
      createElement,
      body: { appendChild, removeChild },
    };
    g.Blob = class MockBlob {
      parts: unknown[];
      options: { type?: string };
      constructor(parts: unknown[], options: { type?: string } = {}) {
        this.parts = parts;
        this.options = options;
      }
    };
    g.URL = { createObjectURL, revokeObjectURL };

    try {
      downloadFile("body", "session.md", "text/markdown");
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createElement).toHaveBeenCalledWith("a");
      expect(appendChild).toHaveBeenCalledTimes(1);
      expect(removeChild).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:wave-282");
      expect(clicks).toEqual(["session.md|blob:wave-282"]);
      const anchor = createElement.mock.results[0]?.value as { download: string; href: string };
      expect(anchor.download).toBe("session.md");
      expect(anchor.href).toBe("blob:wave-282");
    } finally {
      g.document = prevDoc;
      g.Blob = prevBlob;
      g.URL = prevURL;
    }
  });





  // wave-314 residual
  it("exportSessionAsMarkdown headers, usage defaults, toolCalls details, user/AI roles", () => {
    const session = {
      id: "e314",
      title: "Export <Title>",
      workspaceId: "w1",
      createdAt: new Date("2026-07-21T08:00:00.000Z"),
      updatedAt: new Date("2026-07-21T09:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hello",
          timestamp: new Date("2026-07-21T08:01:00.000Z"),
        },
        {
          id: "m2",
          role: "assistant",
          content: "world",
          timestamp: new Date("2026-07-21T08:02:00.000Z"),
          toolCalls: [
            { id: "t1", name: "bash", status: "completed" },
            { id: "t2", name: "read", status: "error" },
          ],
        },
      ],
      usage: { inputTokens: 10, outputTokens: undefined, totalTokens: 10 },
    } as Session;
    const md = exportSessionAsMarkdown(session);
    expect(md).toContain("# Export <Title>");
    expect(md).toContain("**消息数量**: 2");
    expect(md).toContain("- 输入 Token: 10");
    expect(md).toContain("- 输出 Token: 0");
    expect(md).toContain("- 总 Token: 10");
    expect(md).toContain("**你**");
    expect(md).toContain("**AI**");
    expect(md).toContain("`bash`: completed");
    expect(md).toContain("`read`: error");
    expect(md).toContain("<details><summary>工具调用</summary>");
  });

  it("exportSessionAsJSON ISO timestamps and fields; HTML escapes title and content", () => {
    const session = {
      id: "j314",
      title: "A & B <C>",
      workspaceId: "w2",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-21T01:00:00.000Z"),
      messages: [
        {
          id: "m",
          role: "user",
          content: "a <b> & c",
          timestamp: new Date("2026-07-21T00:30:00.000Z"),
        },
      ],
      tags: ["t1"],
      summary: "sum",
    } as Session;
    const json = JSON.parse(exportSessionAsJSON(session));
    expect(json.id).toBe("j314");
    expect(json.createdAt).toBe("2026-07-21T00:00:00.000Z");
    expect(json.updatedAt).toBe("2026-07-21T01:00:00.000Z");
    expect(json.messages[0].timestamp).toBe("2026-07-21T00:30:00.000Z");
    expect(json.tags).toEqual(["t1"]);
    expect(json.summary).toBe("sum");
    const html = exportSessionAsHTML(session);
    expect(html).toContain("A &amp; B &lt;C&gt;");
    expect(html).toContain("a &lt;b&gt; &amp; c");
    expect(html).toContain("用户");
    expect(html).toContain("共 1 条消息");
    expect(html).toContain("<!DOCTYPE html>");
  });
});
