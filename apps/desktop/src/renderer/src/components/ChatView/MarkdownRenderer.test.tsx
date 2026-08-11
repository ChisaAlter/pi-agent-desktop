// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

type RenderResult = ReturnType<typeof render>;

function renderWithI18n(ui: React.ReactElement): RenderResult {
    const result = render(<I18nProvider>{ui}</I18nProvider>);
    return {
        ...result,
        rerender: (next: React.ReactNode) =>
            result.rerender(<I18nProvider>{next}</I18nProvider>),
    };
}

// settings-store 需要 mock: streamFadeEnabled 默认关, 保持词级淡入插件不启用。
vi.mock("../../stores/settings-store", () => ({
    useSettingsStore: (selector: (s: unknown) => unknown) =>
        selector({ settings: { streamFadeEnabled: false } } as unknown as never),
}));

describe("MarkdownRenderer 全量流式解析", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("流式中也渲染 h1/pre/code(全量解析, 不再是纯文本)", () => {
        const { container, rerender } = renderWithI18n(
            <MarkdownRenderer content={"# Title\n\n```js\nconst x = 1\n```"} isStreaming />,
        );
        expect(container.querySelector("h1")).toBeTruthy();
        expect(container.querySelector("pre")).toBeTruthy();
        expect(container.querySelector("code")).toBeTruthy();
        expect(container.textContent ?? "").toContain("Title");
        expect(container.textContent ?? "").toContain("const x = 1");

        // 终态不变(全量解析, 无跳变)。
        rerender(<MarkdownRenderer content={"# Title\n\n```js\nconst x = 1\n```"} isStreaming={false} />);
        expect(container.querySelector("h1")).toBeTruthy();
        expect(container.querySelector("pre")).toBeTruthy();
        expect(container.textContent ?? "").toContain("const x = 1");
    });

    it("流式中未闭合代码围栏也渲染成代码块卡片", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"```js\nconst x = 1"} isStreaming />,
        );
        expect(container.querySelector("pre")).toBeTruthy();
        expect(container.querySelector(".markdown-code-pre")).toBeTruthy();
        // 语言徽标
        expect(container.querySelector(".markdown-code-lang")?.textContent).toBe("js");
    });

    it("流式中代码块不高亮(hljs 摘除), 结束后一次性高亮", () => {
        const { container, rerender } = renderWithI18n(
            <MarkdownRenderer content={"```js\nconst x = 1\n```"} isStreaming />,
        );
        // 流式中: 无 hljs class(不 re-tokenize)
        expect(container.querySelector("code")?.className ?? "").not.toContain("hljs");

        rerender(<MarkdownRenderer content={"```js\nconst x = 1\n```"} isStreaming={false} />);
        // 结束后: hljs 高亮 class 注入
        expect(container.querySelector("code")?.className ?? "").toContain("hljs");
    });

    it("repair 默认生效: 流式中未闭合强调符补闭合(不依赖动效开关)", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"这个结果**非常重"} isStreaming />,
        );
        // repair 补闭合 → 流式中即渲染为 <strong>
        expect(container.querySelector("strong")?.textContent).toBe("非常重");
    });

    it("代码块卡片: 语言徽标 + 复制按钮(读 innerText)", async () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"```ts\ntype A = 1\n```"} />,
        );
        const lang = container.querySelector(".markdown-code-lang");
        expect(lang?.textContent).toBe("ts");
        const copyBtn = container.querySelector(".markdown-code-copy");
        expect(copyBtn).toBeTruthy();

        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        if (copyBtn) fireEvent.click(copyBtn);
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(writeText.mock.calls[0][0]).toContain("type A = 1");
    });

    it("无语言代码块: 徽标降级为 text, 卡片仍渲染", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"```\nplain\n```"} />,
        );
        expect(container.querySelector("pre")).toBeTruthy();
        expect(container.querySelector(".markdown-code-lang")?.textContent).toBe("text");
    });

    it("表格: 外层 wrap + 表头 + 单元格断行 class", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"| a | b |\n| --- | --- |\n| 1 | 2 |"} />,
        );
        const wrap = container.querySelector(".markdown-table-wrap");
        expect(wrap).toBeTruthy();
        const table = wrap?.querySelector("table");
        expect(table).toBeTruthy();
        expect(wrap?.querySelector("th")).toBeTruthy();
        expect(wrap?.querySelector("td")?.textContent).toBe("1");
    });

    it("KaTeX: $..$ 渲染为 .katex", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"公式 $x^2$ 结束"} />,
        );
        expect(container.querySelector(".katex")).toBeTruthy();
    });

    it("本地路径行内 code 可点(dispatch workspace:open-file)", () => {
        const dispatch = vi.spyOn(window, "dispatchEvent");
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"打开 `src/main/index.ts` 文件"} />,
        );
        const pathCode = container.querySelector(".markdown-path-link");
        expect(pathCode).toBeTruthy();
        if (pathCode) fireEvent.click(pathCode);
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: "workspace:open-file" }),
        );
    });

    it("本地路径链接可点, 外链新窗口", () => {
        const dispatch = vi.spyOn(window, "dispatchEvent");
        const { container } = renderWithI18n(
            <MarkdownRenderer content={"[本地](C:\\repo\\src\\index.ts)\n\n[外链](https://example.com)"} />,
        );
        const links = Array.from(container.querySelectorAll("a"));
        expect(links.length).toBeGreaterThanOrEqual(2);
        const local = links.find((a) => a.getAttribute("href")?.includes("C:"));
        const external = links.find((a) => a.getAttribute("href") === "https://example.com");
        if (local) fireEvent.click(local);
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: "workspace:open-file" }),
        );
        expect(external?.getAttribute("target")).toBe("_blank");
    });

    it("data-streaming 属性保留", () => {
        const { container, rerender } = renderWithI18n(<MarkdownRenderer content="hello" isStreaming />);
        expect(container.querySelector(".markdown-body")?.getAttribute("data-streaming")).toBe("true");
        rerender(<MarkdownRenderer content="hello" isStreaming={false} />);
        expect(container.querySelector(".markdown-body")?.getAttribute("data-streaming")).toBe("false");
    });
});

describe("MarkdownRenderer XSS surface (D-023/E-013)", () => {
    it("does not execute raw HTML script tags from untrusted markdown", () => {
        renderWithI18n(
            <MarkdownRenderer content={'Before <script>window.__xss=1</script><img src=x onerror="window.__xss=1"> after'} />,
        );
        expect(document.querySelector("script")).toBeNull();
        expect(document.querySelector("img[onerror]")).toBeNull();
        expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined();
        expect(screen.getByText(/Before/)).toBeTruthy();
    });

    it("renders fenced code blocks as text without interpreting HTML inside them", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer
                content={[
                    "```html",
                    "<script>alert(1)</script>",
                    "```",
                ].join("\n")}
            />,
        );
        expect(document.querySelector("script")).toBeNull();
        expect(container.querySelector("code")?.textContent ?? "").toContain("<script>alert(1)</script>");
    });

    it("does not materialize iframe/object/svg script vectors from raw HTML", () => {
        renderWithI18n(
            <MarkdownRenderer
                content={[
                    '<iframe src="javascript:alert(1)"></iframe>',
                    '<object data="javascript:alert(1)"></object>',
                    '<svg onload="window.__xss=1"><script>window.__xss=1</script></svg>',
                    '<body onload="window.__xss=1">',
                ].join("\n")}
            />,
        );
        expect(document.querySelector("iframe")).toBeNull();
        expect(document.querySelector("object")).toBeNull();
        expect(document.querySelector("svg script")).toBeNull();
        expect(document.querySelector("script")).toBeNull();
        expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined();
    });

    it("does not create executable javascript: or data: anchors from markdown links", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer
                content={[
                    "[js](javascript:alert(1))",
                    "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
                    "[vbs](vbscript:msgbox(1))",
                ].join("\n")}
            />,
        );
        for (const a of Array.from(container.querySelectorAll("a"))) {
            const href = (a.getAttribute("href") ?? "").toLowerCase();
            expect(href.startsWith("javascript:")).toBe(false);
            expect(href.startsWith("data:")).toBe(false);
            expect(href.startsWith("vbscript:")).toBe(false);
        }
        expect(document.querySelector("script")).toBeNull();
    });

    it("keeps event-handler attributes from raw HTML from becoming live DOM props", () => {
        renderWithI18n(
            <MarkdownRenderer
                content={'<a href="https://example.com" onclick="window.__xss=1">click</a><div onmouseover="window.__xss=1">x</div>'}
            />,
        );
        expect(document.querySelector("[onclick]")).toBeNull();
        expect(document.querySelector("[onmouseover]")).toBeNull();
        expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined();
    });

    it("renders markdown tables/lists without injecting raw HTML cells", () => {
        const { container } = renderWithI18n(
            <MarkdownRenderer
                content={[
                    "| a | b |",
                    "| --- | --- |",
                    "| <script>alert(1)</script> | ok |",
                    "",
                    "- item <img src=x onerror=alert(1)>",
                ].join("\n")}
            />,
        );
        expect(document.querySelector("script")).toBeNull();
        expect(document.querySelector("img[onerror]")).toBeNull();
        expect(container.textContent ?? "").toMatch(/ok/);
    });
});
