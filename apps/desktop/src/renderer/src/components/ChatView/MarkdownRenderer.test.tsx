// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer XSS surface (D-023/E-013)", () => {
    it("does not execute raw HTML script tags from untrusted markdown", () => {
        render(
            <MarkdownRenderer content={'Before <script>window.__xss=1</script><img src=x onerror="window.__xss=1"> after'} />,
        );

        // react-markdown without rehype-raw should treat HTML as text or drop unsafe tags,
        // never create a live <script> element.
        expect(document.querySelector("script")).toBeNull();
        expect(document.querySelector("img[onerror]")).toBeNull();
        expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined();
        expect(screen.getByText(/Before/)).toBeTruthy();
    });

    it("renders fenced code blocks as text without interpreting HTML inside them", () => {
        const { container } = render(
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

    it("sets data-streaming for streaming mode consumers", () => {
        const { container, rerender } = render(<MarkdownRenderer content="hello" isStreaming />);
        expect(container.querySelector(".markdown-body")?.getAttribute("data-streaming")).toBe("true");
        rerender(<MarkdownRenderer content="hello" isStreaming={false} />);
        expect(container.querySelector(".markdown-body")?.getAttribute("data-streaming")).toBe("false");
    });

    // wave-90 residual — broader XSS payload matrix (D-023/E-013)
    it("does not materialize iframe/object/svg script vectors from raw HTML", () => {
        render(
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
        const { container } = render(
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
            // react-markdown may drop or neutralize dangerous schemes; never leave a live js/data/vbs href
            expect(href.startsWith("javascript:")).toBe(false);
            expect(href.startsWith("data:")).toBe(false);
            expect(href.startsWith("vbscript:")).toBe(false);
        }
        expect(document.querySelector("script")).toBeNull();
    });

    it("keeps event-handler attributes from raw HTML from becoming live DOM props", () => {
        render(
            <MarkdownRenderer
                content={'<a href="https://example.com" onclick="window.__xss=1">click</a><div onmouseover="window.__xss=1">x</div>'}
            />,
        );
        expect(document.querySelector("[onclick]")).toBeNull();
        expect(document.querySelector("[onmouseover]")).toBeNull();
        expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined();
    });

    it("renders markdown tables/lists without injecting raw HTML cells", () => {
        const { container } = render(
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
