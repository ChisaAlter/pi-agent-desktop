// 快捷键中央注册表测试 (可用度-C)
// 覆盖: SHORTCUTS 内容 / matchesCombo / findMatchingShortcut / dispatchShortcut
//       / registerShortcutHandler 注册与反注册

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    SHORTCUTS,
    matchesCombo,
    findMatchingShortcut,
    getShortcutById,
    registerShortcutHandler,
    dispatchShortcut,
    groupByCategory,
    __resetShortcutHandlersForTest,
    type ShortcutCombo,
} from "../registry";

function makeKeyEvent(init: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("shortcuts/registry", () => {
    beforeEach(() => {
        __resetShortcutHandlersForTest();
        window.localStorage.removeItem("pi-desktop-shortcut-overrides");
    });

    describe("SHORTCUTS 静态数据", () => {
        it("至少包含 6 条 (含 4 个核心 + ? + Shift+/ + Esc)", () => {
            expect(SHORTCUTS.length).toBeGreaterThanOrEqual(6);
        });

        it("每个 id 在视觉上唯一 (允许 ? 和 Shift+/ 共享 id, 其它应唯一)", () => {
            const ids = SHORTCUTS.map((s) => s.id);
            const unique = new Set(ids);
            // 唯一 id 数应该比总条数少 1 (因为 ? / Shift+/ 同 id)
            expect(unique.size).toBe(ids.length - 1);
        });

        it("包含 6 个 task 要求的快捷键 (Ctrl+K, Ctrl+`, Ctrl+,, Ctrl+N, Ctrl+B, ?)", () => {
            const labels = SHORTCUTS.map((s) => s.keys);
            expect(labels).toContain("Ctrl+K");
            expect(labels).toContain("Ctrl+`");
            expect(labels).toContain("Ctrl+,");
            expect(labels).toContain("Ctrl+N");
            expect(labels).toContain("Ctrl+B");
            // ? 或 Shift+/ 至少有一个
            expect(labels.some((l) => l === "?" || l === "Shift+/")).toBe(true);
        });
    });

    describe("matchesCombo", () => {
        it("Ctrl+K 命中", () => {
            const combo: ShortcutCombo = { mod: true, key: "k" };
            expect(matchesCombo(makeKeyEvent({ ctrlKey: true, key: "k" }), combo)).toBe(true);
            // Meta 替代 Ctrl (macOS)
            expect(matchesCombo(makeKeyEvent({ metaKey: true, key: "k" }), combo)).toBe(true);
            // 大写 K 也算
            expect(matchesCombo(makeKeyEvent({ ctrlKey: true, key: "K" }), combo)).toBe(true);
        });

        it("Ctrl+K 不命中无 mod 的输入", () => {
            const combo: ShortcutCombo = { mod: true, key: "k" };
            expect(matchesCombo(makeKeyEvent({ key: "k" }), combo)).toBe(false);
        });

        it("Ctrl+K 不命中 Ctrl+Shift+K (有 shift 修饰)", () => {
            const combo: ShortcutCombo = { mod: true, key: "k" };
            expect(matchesCombo(makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "k" }), combo)).toBe(false);
        });

        it("? 命中 shift+?", () => {
            const combo: ShortcutCombo = { shift: true, key: "?" };
            expect(matchesCombo(makeKeyEvent({ shiftKey: true, key: "?" }), combo)).toBe(true);
        });

        it("? 不命中无 shift 的 /", () => {
            const combo: ShortcutCombo = { shift: true, key: "?" };
            expect(matchesCombo(makeKeyEvent({ key: "/" }), combo)).toBe(false);
        });

        it("Shift+/ 命中 shift+/", () => {
            const combo: ShortcutCombo = { shift: true, key: "/" };
            expect(matchesCombo(makeKeyEvent({ shiftKey: true, key: "/" }), combo)).toBe(true);
        });

        it("Esc / Escape 两种 key 都能匹配", () => {
            const combo: ShortcutCombo = { key: "escape" };
            expect(matchesCombo(makeKeyEvent({ key: "Escape" }), combo)).toBe(true);
            expect(matchesCombo(makeKeyEvent({ key: "Esc" }), combo)).toBe(true);
        });
    });

    describe("findMatchingShortcut", () => {
        it("Ctrl+K → open-command-palette", () => {
            const s = findMatchingShortcut(makeKeyEvent({ ctrlKey: true, key: "k" }));
            expect(s?.id).toBe("open-command-palette");
        });

        it("Ctrl+N → new-chat", () => {
            const s = findMatchingShortcut(makeKeyEvent({ ctrlKey: true, key: "n" }));
            expect(s?.id).toBe("new-chat");
        });

        it("Shift+? → show-shortcuts-question", () => {
            const s = findMatchingShortcut(makeKeyEvent({ shiftKey: true, key: "?" }));
            expect(s?.id).toBe("show-shortcuts-question");
        });

        it("Shift+/ → show-shortcuts-question (同 id, 不同 keys 字符串)", () => {
            const s = findMatchingShortcut(makeKeyEvent({ shiftKey: true, key: "/" }));
            expect(s?.id).toBe("show-shortcuts-question");
            expect(s?.keys).toBe("Shift+/");
        });

        it("无匹配时返回 null", () => {
            const s = findMatchingShortcut(makeKeyEvent({ key: "F1" }));
            expect(s).toBeNull();
        });

        it("在 input 内输入 ? 不会命中 (ignoreInEditable)", () => {
            const input = document.createElement("input");
            document.body.appendChild(input);
            const event = makeKeyEvent({ shiftKey: true, key: "?" });
            // 模拟事件从 input 派发
            Object.defineProperty(event, "target", { value: input, configurable: true });
            const s = findMatchingShortcut(event);
            expect(s).toBeNull();
            document.body.removeChild(input);
        });

        it("honors persisted shortcut overrides at runtime", () => {
            window.localStorage.setItem(
                "pi-desktop-shortcut-overrides",
                JSON.stringify([{ id: "open-command-palette", keys: "Ctrl+Shift+Y" }]),
            );

            const newShortcut = findMatchingShortcut(makeKeyEvent({ ctrlKey: true, shiftKey: true, key: "Y" }));
            const oldShortcut = findMatchingShortcut(makeKeyEvent({ ctrlKey: true, key: "K" }));

            expect(newShortcut?.id).toBe("open-command-palette");
            expect(newShortcut?.keys).toBe("Ctrl+Shift+Y");
            expect(oldShortcut).toBeNull();
        });
    });

    describe("dispatchShortcut + registerShortcutHandler", () => {
        it("注册 handler 后, 命中事件触发 handler 并 preventDefault", () => {
            const handler = vi.fn();
            registerShortcutHandler("open-command-palette", handler);

            const e = makeKeyEvent({ ctrlKey: true, key: "k" });
            const ok = dispatchShortcut(e);
            expect(ok).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(e.defaultPrevented).toBe(true);
        });

        it("无 handler 注册时不 preventDefault, 返回 false", () => {
            const e = makeKeyEvent({ ctrlKey: true, key: "k" });
            const ok = dispatchShortcut(e);
            expect(ok).toBe(false);
            expect(e.defaultPrevented).toBe(false);
        });

        it("unregister 后 handler 失效", () => {
            const handler = vi.fn();
            const unregister = registerShortcutHandler("open-command-palette", handler);
            unregister();

            const e = makeKeyEvent({ ctrlKey: true, key: "k" });
            const ok = dispatchShortcut(e);
            expect(ok).toBe(false);
            expect(handler).not.toHaveBeenCalled();
        });

        it("后注册的同名 handler 覆盖前一个; cleanup 时只清自己", () => {
            const a = vi.fn();
            const b = vi.fn();
            const unA = registerShortcutHandler("open-command-palette", a);
            const unB = registerShortcutHandler("open-command-palette", b);
            dispatchShortcut(makeKeyEvent({ ctrlKey: true, key: "k" }));
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledTimes(1);

            // 清 A, 不会影响 B
            unA();
            dispatchShortcut(makeKeyEvent({ ctrlKey: true, key: "k" }));
            expect(b).toHaveBeenCalledTimes(2);

            unB();
        });
    });

    describe("groupByCategory", () => {
        it("按 category 分组且保持 SHORTCUTS 出现顺序", () => {
            const groups = groupByCategory(SHORTCUTS);
            // 至少 4 个 group (nav / chat / panel / edit / help)
            expect(groups.length).toBeGreaterThanOrEqual(4);
            const order = groups.map((g) => g.category);
            // 顺序应当是 registry 里写的固定顺序 (v1.0.4: 改用 i18n key)
            expect(order).toEqual(["nav", "chat", "panel", "edit", "help"]);
        });

        it("每个 group 的 items 都是对应 category", () => {
            const groups = groupByCategory(SHORTCUTS);
            for (const g of groups) {
                for (const item of g.items) {
                    expect(item.category).toBe(g.category);
                }
            }
        });
    });

    describe("getShortcutById", () => {
        it("查找存在的 id", () => {
            const s = getShortcutById("open-command-palette");
            expect(s?.keys).toBe("Ctrl+K");
        });

        it("不存在的 id 返回 undefined", () => {
            expect(getShortcutById("nope")).toBeUndefined();
        });
    });
});
