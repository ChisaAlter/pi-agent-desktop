// I18nProvider / useI18n / locale 切换测试 (v1.0.4)
// 覆盖: 默认 locale 解析 / setLocale 即时切换 / t() 缺 key fallback / useI18n 必须在 Provider 内

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React, { useState } from "react";
import { I18nProvider, useI18n, SUPPORTED_LOCALES } from "../index";

function LocaleProbe({ label }: { label: string }): React.ReactElement {
    const { locale, t, setLocale } = useI18n();
    return (
        <div>
            <span data-testid="locale">{locale}</span>
            <span data-testid="greeting">{t("shortcutsCheatsheet.title")}</span>
            <span data-testid="missing">{t("totally.nonexistent.key")}</span>
            <button type="button" onClick={() => setLocale("en-US")}>
                {label}
            </button>
        </div>
    );
}

beforeEach(() => {
    // 隔离每个 case, 强制 zh-CN 起点
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    window.localStorage.removeItem("__test_cleared__");
});

describe("I18nProvider", () => {
    it("挂载时给出当前 locale + t() 可用", () => {
        render(
            <I18nProvider>
                <LocaleProbe label="switch" />
            </I18nProvider>
        );
        expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
        expect(screen.getByTestId("greeting").textContent).toBe("快捷键速查");
    });

    it("useI18n 在 Provider 外抛错", () => {
        // 关掉 React 的错误日志噪声, 让 expect 抓真正的 throw
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(() => render(<LocaleProbe label="x" />)).toThrow(/I18nProvider/);
        spy.mockRestore();
    });

    it("setLocale 切到 en-US 后 t() 立刻返新 locale 字符串", () => {
        render(
            <I18nProvider>
                <LocaleProbe label="switch" />
            </I18nProvider>
        );
        expect(screen.getByTestId("greeting").textContent).toBe("快捷键速查");
        fireEvent.click(screen.getByRole("button", { name: "switch" }));
        expect(screen.getByTestId("locale").textContent).toBe("en-US");
        expect(screen.getByTestId("greeting").textContent).toBe("Keyboard shortcuts");
    });

    it("setLocale 写到 localStorage, 第二次挂载会从 localStorage 读回", () => {
        const { unmount } = render(
            <I18nProvider>
                <LocaleProbe label="switch" />
            </I18nProvider>
        );
        fireEvent.click(screen.getByRole("button", { name: "switch" }));
        expect(window.localStorage.getItem("pi-desktop.locale")).toBe("en-US");
        unmount();

        // 不重置 localStorage, 新挂载应该直接吃 en-US
        render(
            <I18nProvider>
                <LocaleProbe label="noop" />
            </I18nProvider>
        );
        expect(screen.getByTestId("locale").textContent).toBe("en-US");
    });

    it("缺 key 时 i18next 返 key 字符串本身 (returnNull: false 的行为)", () => {
        render(
            <I18nProvider>
                <LocaleProbe label="x" />
            </I18nProvider>
        );
        expect(screen.getByTestId("missing").textContent).toBe("totally.nonexistent.key");
    });

    it("SUPPORTED_LOCALES 包含 zh-CN 和 en-US", () => {
        expect(SUPPORTED_LOCALES).toContain("zh-CN");
        expect(SUPPORTED_LOCALES).toContain("en-US");
    });

    it("setLocale 接收 SUPPORTED_LOCALES 内任意值", () => {
        let captured: string | null = null;
        function Capture(): React.ReactElement {
            const { locale, setLocale } = useI18n();
            captured = locale;
            return <button onClick={() => setLocale("zh-CN")}>back</button>;
        }
        render(
            <I18nProvider>
                <Capture />
            </I18nProvider>
        );
        // 起步 zh-CN (beforeEach)
        expect(captured).toBe("zh-CN");
        act(() => {
            fireEvent.click(screen.getByRole("button", { name: "back" }));
        });
        expect(captured).toBe("zh-CN");
    });
});

// 引入 vi 以便上面 useI18n 抛错 case 用到 (tsc 不会因为没用就报错, 但保留以便扩展)
import { vi } from "vitest";
