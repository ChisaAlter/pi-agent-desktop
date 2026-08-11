import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./MarkdownRenderer";

describe("normalizeMathDelimiters — LaTeX 定界符 → dollar", () => {
    it("行内 \\(...\\) → $...$", () => {
        expect(normalizeMathDelimiters("公式 \\(x^2\\) 结束")).toBe("公式 $x^2$ 结束");
    });

    it("整行 \\[...\\] → $$...$$", () => {
        expect(normalizeMathDelimiters("\\[\\frac{a}{b}\\]")).toBe(
            "$$\n\\frac{a}{b}\n$$",
        );
    });

    it("围栏代码内的 LaTeX 字符串不改", () => {
        const md = "```ts\nconst s = \"\\\\(x^2\\\\)\"\n```";
        expect(normalizeMathDelimiters(md)).toBe(md);
    });

    it("无定界符原样返回", () => {
        const md = "普通文本 $x$ 也有";
        expect(normalizeMathDelimiters(md)).toBe(md);
    });

    it("转义的反斜杠开符不改(\\\\( 不匹配)", () => {
        expect(normalizeMathDelimiters("a \\\\(x\\\\) b")).toBe("a \\\\(x\\\\) b");
    });
});
