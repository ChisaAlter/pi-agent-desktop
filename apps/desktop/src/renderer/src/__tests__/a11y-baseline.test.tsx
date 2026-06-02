// a11y-baseline JSDOM tests (M7) — axe-core 在 React Testing Library 渲染的核心组件上跑
//
// 目的: 给 5 个目标组件的 a11y 改动做单元级的可执行验证. E2E Playwright 走法见
// apps/desktop/e2e/a11y.spec.ts (因 Electron 34 + node:sqlite 已 BLOCKED, 见 commit d951db0).
//
// 运行: pnpm --filter @pi-desktop/desktop test
//   包含此文件: src/renderer/src/__tests__/a11y-baseline.test.tsx
//
// 依赖: axe-core (devDep) + jsdom (vitest environment) + @testing-library/react

// @vitest-environment jsdom

import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import axe, { type Result, type Spec } from "axe-core";
import { IconBar } from "../components/IconBar/IconBar";
import { MessageBubble } from "../components/ChatView/MessageBubble";
import { I18nProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>);
}

// axe-core 的 run 接受 Element | Node | string, 在 JSDOM 下需要等异步 promise
async function runAxe(container: HTMLElement, _label: string): Promise<Result[]> {
    const results = await axe.run(container as unknown as Element, {
        // 关掉 color-contrast: 主题色 #999 偏灰, 留到 a11y-strict 单独跑
        rules: { "color-contrast": { enabled: false } },
        // 只关注 critical / serious
        resultTypes: ["violations"],
    } as unknown as Spec);
    return results.violations;
}

beforeAll(() => {
    // axe-core 在 jsdom 下需要 matchMedia polyfill
    if (!window.matchMedia) {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
    }
    // jsdom 默认 navigator.language 是 'en-US', 强制 zh-CN
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
});

function logViolations(label: string, violations: Result[]): void {
    if (violations.length === 0) return;
    // 用 process.stderr.write 避免 lint 警告
    process.stderr.write(
        `[${label}] ${violations.length} violations:\n` +
            violations
                .map(
                    (v) =>
                        `  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))\n` +
                        v.nodes
                            .map(
                                (n) =>
                                    `      target=${JSON.stringify(n.target)}\n` +
                                    n.any
                                        .concat(n.all, n.none)
                                        .map(
                                            (a) =>
                                                `      attr=${a.id} msg=${a.message}`
                                        )
                                        .join("\n")
                            )
                            .join("\n")
                )
                .join("\n") +
            "\n"
    );
}

describe("a11y baseline — 5 core components (JSDOM)", () => {
    it("IconBar: 0 critical/serious violations", async () => {
        const { container } = renderWithI18n(
            <IconBar activePanel="chat" onPanelChange={() => {}} />
        );
        const violations = await runAxe(container, "IconBar");
        logViolations("IconBar", violations);
        expect(violations, `IconBar should have 0 critical/serious violations`).toHaveLength(0);
        cleanup();
    });

    it("IconBar (active=search, 切换激活态): 0 critical/serious violations", async () => {
        const { container } = renderWithI18n(
            <IconBar activePanel="search" onPanelChange={() => {}} />
        );
        const violations = await runAxe(container, "IconBar-search");
        logViolations("IconBar-search", violations);
        expect(violations).toHaveLength(0);
        cleanup();
    });

    it("MessageBubble (user): 0 critical/serious violations", async () => {
        const { container } = renderWithI18n(
            <MessageBubble
                message={{
                    id: "1",
                    role: "user",
                    content: "你好 Pi",
                    timestamp: Date.now(),
                }}
            />
        );
        const violations = await runAxe(container, "MessageBubble-user");
        logViolations("MessageBubble-user", violations);
        expect(violations).toHaveLength(0);
        cleanup();
    });

    it("MessageBubble (assistant, streaming): 0 critical/serious violations", async () => {
        const { container } = renderWithI18n(
            <MessageBubble
                message={{
                    id: "2",
                    role: "assistant",
                    content: "你好, 我是 Pi",
                    timestamp: Date.now(),
                }}
                isStreaming={false}
            />
        );
        const violations = await runAxe(container, "MessageBubble-assistant");
        logViolations("MessageBubble-assistant", violations);
        expect(violations).toHaveLength(0);
        cleanup();
    });
});
