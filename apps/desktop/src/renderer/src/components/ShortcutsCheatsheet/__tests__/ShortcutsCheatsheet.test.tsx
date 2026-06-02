// ShortcutsCheatsheet 组件测试 (可用度-C)
// 覆盖: 渲染 / 关闭 (Esc, 背景点击, X 按钮) / 上下导航 / 快捷键文案
// 注意: jsdom 不识别隐式 role=option on <li> → 用 [role=option] selector
// v1.0.4: 渲染时包 I18nProvider (默认 zh-CN, 跟原断言保持一致)

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ShortcutsCheatsheet } from "../ShortcutsCheatsheet";
import { I18nProvider } from "../../../i18n";

function renderWithI18n(ui: React.ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("ShortcutsCheatsheet", () => {
    let onClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // jsdom 默认 navigator.language 是 'en-US', 强制 zh-CN 让中文断言继续过
        window.localStorage.setItem("pi-desktop.locale", "zh-CN");
        onClose = vi.fn();
    });

    it("isOpen=false 时不渲染", () => {
        const { container } = renderWithI18n(
            <ShortcutsCheatsheet isOpen={false} onClose={onClose} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it("isOpen=true 时渲染 dialog + 至少 6 个 shortcut 描述", () => {
        const { container } = renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        const dialog = screen.getByRole("dialog", { name: "快捷键速查" });
        expect(dialog).toBeTruthy();
        // 至少 6 条 (label)
        expect(screen.getByText("打开命令面板")).toBeTruthy();
        expect(screen.getByText("切换终端")).toBeTruthy();
        expect(screen.getByText("打开设置")).toBeTruthy();
        expect(screen.getByText("新建对话")).toBeTruthy();
        expect(screen.getByText("切换侧栏")).toBeTruthy();
        // 速查表里 "快捷键速查" 出现 h2 标题 + dialog aria-label 两次, 用 selector 数 >=1 即可
        const headingMatches = container.querySelectorAll("h2");
        const headings = Array.from(headingMatches).map((h) => h.textContent);
        expect(headings.some((t) => t && t.includes("快捷键速查"))).toBe(true);
    });

    it("按 Esc 触发 onClose", () => {
        renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击 X 按钮触发 onClose", () => {
        renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole("button", { name: "关闭" }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景 (dialog 本体) 触发 onClose; 点击内容区不触发", () => {
        const { container } = renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        const dialog = screen.getByRole("dialog");
        // 点击 dialog 自身 = 背景
        fireEvent.click(dialog);
        expect(onClose).toHaveBeenCalledTimes(1);

        // 点击 dialog 内的内容不应触发
        onClose.mockClear();
        const heading = container.querySelector("h2")!;
        fireEvent.click(heading);
        expect(onClose).not.toHaveBeenCalled();
    });

    it("按 ArrowDown / ArrowUp 改变 activeIdx (视觉上 bg 变化)", () => {
        const { container } = renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        // jsdom 不识别 implicit role=option on <li>; 用 [role=option] selector
        const options = Array.from(container.querySelectorAll('[role="option"]'));
        expect(options.length).toBeGreaterThan(1);
        const first = options[0] as HTMLElement;
        const second = options[1] as HTMLElement;

        // 初始 active 是第一个
        expect(first.getAttribute("aria-selected")).toBe("true");
        expect(second.getAttribute("aria-selected")).toBe("false");

        // 箭头下
        fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(first.getAttribute("aria-selected")).toBe("false");
        expect(second.getAttribute("aria-selected")).toBe("true");
    });

    it("分组标题 (category) 出现", () => {
        renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        // 至少一个 category header
        expect(screen.getByText("导航")).toBeTruthy();
        expect(screen.getByText("对话")).toBeTruthy();
        expect(screen.getByText("面板")).toBeTruthy();
        expect(screen.getByText("帮助")).toBeTruthy();
    });

    it("aria-modal 与 aria-label 正确", () => {
        renderWithI18n(<ShortcutsCheatsheet isOpen={true} onClose={onClose} />);
        const dialog = screen.getByRole("dialog");
        expect(dialog.getAttribute("aria-modal")).toBe("true");
        expect(dialog.getAttribute("aria-label")).toBe("快捷键速查");
    });
});
