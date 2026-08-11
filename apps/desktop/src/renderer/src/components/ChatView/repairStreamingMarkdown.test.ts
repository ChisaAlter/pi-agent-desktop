import { describe, expect, it } from "vitest";
import { repairStreamingMarkdown } from "./repairStreamingMarkdown";

describe("repairStreamingMarkdown — 未闭合代码围栏", () => {
    it("未闭合 ``` 补闭合", () => {
        expect(repairStreamingMarkdown("```js\nconst x = 1")).toBe("```js\nconst x = 1\n```");
    });

    it("未闭合 ``` 且文末已换行: 直接拼闭合(不重复换行)", () => {
        expect(repairStreamingMarkdown("```js\nconst x = 1\n")).toBe("```js\nconst x = 1\n```");
    });

    it("已闭合围栏不追加", () => {
        expect(repairStreamingMarkdown("```js\nconst x = 1\n```\n\n# 总结")).toBe(
            "```js\nconst x = 1\n```\n\n# 总结",
        );
    });

    it("~ 围栏同样处理", () => {
        expect(repairStreamingMarkdown("~~~ts\nlet a")).toBe("~~~ts\nlet a\n~~~");
    });
});

describe("repairStreamingMarkdown — 强调符补齐", () => {
    it("未配对 ** 补闭合", () => {
        expect(repairStreamingMarkdown("这个结果**非常重")).toBe("这个结果**非常重**");
    });

    it("未配对 * 补闭合", () => {
        expect(repairStreamingMarkdown("这是*斜体")).toBe("这是*斜体*");
    });

    it("已配对不补", () => {
        expect(repairStreamingMarkdown("**完整加粗**")).toBe("**完整加粗**");
    });

    it("跨行强调符不修(补了会破坏结构)", () => {
        const md = "**第一行\n第二行";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });

    it("行首列表标记 `- x` 不算斜体符", () => {
        expect(repairStreamingMarkdown("- 列表项")).toBe("- 列表项");
    });

    it("含反引号不修(inline code 可能半开)", () => {
        const md = "**code `x** tail";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });

    it("`***` 复合 run 不修", () => {
        const md = "***abc";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });
});

describe("repairStreamingMarkdown — 半截图片/链接降级", () => {
    it("半截图片 `![alt](partial` → alt 文本", () => {
        expect(repairStreamingMarkdown("看图 ![logo](https://exa")).toBe("看图 logo");
    });

    it("半截链接 `[text](partial` → 文本", () => {
        expect(repairStreamingMarkdown("看 [文档](https://exa")).toBe("看 文档");
    });

    it("完整图片不动", () => {
        const md = "![logo](https://exa.com/a.png)";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });
});

describe("repairStreamingMarkdown — 保守边界", () => {
    it("空串原样返回", () => {
        expect(repairStreamingMarkdown("")).toBe("");
    });

    it("围栏内反引号奇数不修(inline code 半开, 后续星号可能在代码里)", () => {
        const md = "代码是 `foo 后面还有";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });

    it("开符后接空白不构成 opener, 不补", () => {
        const md = "文本 ** ";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });

    it("开符悬在文末不补(下一 chunk 才有正文)", () => {
        const md = "文本 **";
        expect(repairStreamingMarkdown(md)).toBe(md);
    });
});
