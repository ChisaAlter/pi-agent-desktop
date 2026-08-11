import { describe, expect, it } from "vitest";
import {
    createWordFadeState,
    rehypeStreamWordFade,
    markSettledFromAnimationEnd,
    splitWords,
} from "./rehypeStreamWordFade";

interface HastEl {
    type: "element";
    tagName: string;
    properties: Record<string, unknown>;
    children: HastNode[];
}
type HastNode = HastEl | { type: "text"; value: string };

function text(value: string): HastNode {
    return { type: "text", value };
}

function el(tagName: string, children: HastNode[], props: Record<string, unknown> = {}): HastEl {
    return { type: "element", tagName, properties: props, children };
}

function p(children: HastNode[]): HastEl {
    return el("p", children);
}

function runPlugin(tree: HastEl, state: ReturnType<typeof createWordFadeState>, now = 1000): void {
    const nowFn = () => now;
    const withClock = { ...state, nowFn } as typeof state;
    const transform = rehypeStreamWordFade(withClock);
    transform(tree);
}

describe("rehypeStreamWordFade — 逐词包 span", () => {
    it("把文本节点切词并包 stream-word span(含 delay 与 key)", () => {
        const tree = p([text("hello world")]);
        const state = createWordFadeState();
        runPlugin(tree, state);

        const spans = tree.children.filter((c) => c.type === "element" && c.tagName === "span");
        expect(spans.length).toBe(2);
        const first = spans[0] as HastEl;
        expect((first.properties.className as string[])).toContain("stream-word");
        expect(typeof first.properties.dataWfKey).toBe("string");
        expect(String(first.properties.style)).toMatch(/--wf-delay:-?\d+ms/);
        expect((first.children[0] as { value: string }).value).toBe("hello ");
        expect(((spans[1] as HastEl).children[0] as { value: string }).value).toBe("world");
    });

    it("CJK 无空格也按词切(Intl.Segmenter)", () => {
        const words = splitWords("你好世界");
        expect(words.join("")).toBe("你好世界");
        expect(words.length).toBeGreaterThan(1);
    });

    it("空白并入前一词", () => {
        const words = splitWords("a b");
        expect(words).toEqual(["a ", "b"]);
    });

    it("代码块跳过(不包 span)", () => {
        const tree = p([el("code", [text("const x = 1")])]);
        const state = createWordFadeState();
        runPlugin(tree, state);
        const code = tree.children[0] as HastEl;
        expect(code.children[0]).toEqual(text("const x = 1"));
    });
});

describe("rehypeStreamWordFade — 稳定 key 与 settled", () => {
    it("同位置内容延续复用 key(不重播)", () => {
        const state = createWordFadeState();
        // tick 1: "hello"
        const tree1 = p([text("hello")]);
        runPlugin(tree1, state, 1000);
        const key1 = (tree1.children[0] as HastEl).properties.dataWfKey as string;

        // tick 2: "hello world"(前缀延续)
        const tree2 = p([text("hello world")]);
        runPlugin(tree2, state, 1100);
        const spans2 = tree2.children.filter((c) => c.type === "element");
        expect((spans2[0] as HastEl).properties.dataWfKey).toBe(key1); // hello 复用
        expect((spans2[1] as HastEl).properties.dataWfKey).not.toBe(key1); // world 新 key
    });

    it("settled 的词还原为纯文本, 不再包 span", () => {
        const state = createWordFadeState();
        const tree1 = p([text("hello world")]);
        runPlugin(tree1, state, 1000);
        const keys = (tree1.children as HastEl[])
            .map((c) => c.properties.dataWfKey as string);

        // 模拟 animationend 落袋两个词
        for (const key of keys) {
            markSettledFromAnimationEnd(state, {
                animationName: "stream-word-in",
                target: { dataset: { wfKey: key } } as unknown as EventTarget,
            });
        }

        // 下一 tick 全文已 settled → 槽位不改树(仍是纯文本)
        const tree2 = p([text("hello world")]);
        runPlugin(tree2, state, 1200);
        expect(tree2.children).toEqual([text("hello world")]);
    });

    it("animationName 不匹配时不落袋", () => {
        const state = createWordFadeState();
        markSettledFromAnimationEnd(state, {
            animationName: "other-anim",
            target: { dataset: { wfKey: "wf-0" } } as unknown as EventTarget,
        });
        expect(state.settled.size).toBe(0);
    });

    it("marker: li 借用第一个词的 key", () => {
        const tree = el("ul", [el("li", [text("item one")])]);
        const state = createWordFadeState();
        runPlugin(tree, state, 1000);
        const li = tree.children[0] as HastEl;
        expect(li.properties.dataStreamMarker).toBe(true);
        expect(typeof li.properties.dataWfKey).toBe("string");
    });
});
