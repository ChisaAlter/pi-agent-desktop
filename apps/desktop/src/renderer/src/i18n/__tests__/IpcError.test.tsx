// IpcError 契约 + translateIpcError 翻译测试 (v1.0.6.1)
//
// 覆盖:
// 1. isIpcError 类型守卫
// 2. translateIpcError: 命中 i18n 词条 + params 插值
// 3. translateIpcError: 缺词条 → 降级 fallback
// 4. translateIpcError: 词条值等于 code → 也降级 fallback (i18next 缺 key 的标志)
// 5. translateIpcError: 跟 locale 切换: zh-CN / en-US 都正确

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { IpcError } from "@shared";
import { I18nProvider, translateIpcError, useTranslateIpcError, isIpcError } from "../index";

beforeEach(() => {
    // 强制 zh-CN 让中文断言继续过
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
});

// 简单 t() 替身: 模拟 i18next 行为
//   - 命中 → 翻译 + 插值
//   - 缺 key → 返 key 本身 (i18next returnNull: false 的默认行为)
function fakeT(dict: Record<string, string>): (key: string, options?: Record<string, unknown>) => string {
    return (key, options) => {
        const tmpl = dict[key];
        if (tmpl === undefined) return key; // 缺 key 返 key
        return tmpl.replace(/\{\{(\w+)\}\}/g, (_, name) => {
            const v = (options as Record<string, unknown> | undefined)?.[name];
            return v === undefined || v === null ? `{{${name}}}` : String(v);
        });
    };
}

// ── isIpcError 类型守卫 ──────────────────────────────────────────

describe("isIpcError", () => {
    it("null / undefined / 非对象 → false", () => {
        expect(isIpcError(null)).toBe(false);
        expect(isIpcError(undefined)).toBe(false);
        expect(isIpcError(42)).toBe(false);
        expect(isIpcError("string")).toBe(false);
    });

    it("缺 code / fallback → false", () => {
        expect(isIpcError({})).toBe(false);
        expect(isIpcError({ code: "x" })).toBe(false);
        expect(isIpcError({ fallback: "x" })).toBe(false);
    });

    it("code + fallback 都是 string → true", () => {
        expect(isIpcError({ code: "ipcErrors.x", fallback: "兜底" })).toBe(true);
        expect(
            isIpcError({ code: "ipcErrors.x", fallback: "兜底", params: { path: "/a" } })
        ).toBe(true);
    });
});

// ── translateIpcError 翻译行为 ────────────────────────────────────

describe("translateIpcError", () => {
    it("命中 i18n 词条 + 参数插值", () => {
        const err: IpcError = {
            code: "ipcErrors.files.scanFailed",
            fallback: "兜底",
            params: { path: "/tmp/foo" },
        };
        const t = fakeT({
            "ipcErrors.files.scanFailed": "文件扫描失败: {{path}}",
        });
        expect(translateIpcError(err, t)).toBe("文件扫描失败: /tmp/foo");
    });

    it("缺词条 (i18next 返 key 本身) → 降级 fallback", () => {
        const err: IpcError = {
            code: "ipcErrors.never.registered",
            fallback: "兜底中文文案",
        };
        const t = fakeT({}); // 字典空 → 任何 key 返 key
        expect(translateIpcError(err, t)).toBe("兜底中文文案");
    });

    it("params 缺字段 → 占位符保留, 不抛", () => {
        const err: IpcError = {
            code: "ipcErrors.x",
            fallback: "fallback",
            params: { path: "/a" }, // message 字段缺
        };
        const t = fakeT({ "ipcErrors.x": "前缀 {{path}} / {{message}}" });
        // message 缺 → 保留 {{message}}, 不抛
        expect(translateIpcError(err, t)).toBe("前缀 /a / {{message}}");
    });
});

// ── 真实 i18n Provider 跑通 ──────────────────────────────────────

describe("translateIpcError with real I18nProvider", () => {
    it("zh-CN: 命中 i18n 词条", () => {
        const err: IpcError = {
            code: "ipcErrors.pi.installFailed",
            fallback: "兜底",
            params: { message: "npm not found" },
        };
        render(
            <I18nProvider>
                <ProbeTranslate err={err} />
            </I18nProvider>
        );
        expect(screen.getByTestId("translated").textContent).toBe(
            "Pi CLI 安装失败: npm not found"
        );
    });

    it("en-US: 切 locale 后命中英文词条", () => {
        window.localStorage.setItem("pi-desktop.locale", "en-US");
        const err: IpcError = {
            code: "ipcErrors.files.scanFailed",
            fallback: "兜底",
            params: { path: "/etc/passwd" },
        };
        render(
            <I18nProvider>
                <ProbeTranslate err={err} />
            </I18nProvider>
        );
        // en.json 模板: "File scan failed at {{path}}: {{message}}"
        // message 不在 params → 占位符保留原样
        expect(screen.getByTestId("translated").textContent).toBe(
            "File scan failed at /etc/passwd: {{message}}"
        );
    });
});

function ProbeTranslate({ err }: { err: IpcError }): React.ReactElement {
    const translate = useTranslateIpcError();
    return <span data-testid="translated">{translate(err)}</span>;
}
