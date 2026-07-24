// Onboarding 组件测试 (可用度-D)
// 覆盖：3 步流程跳转、跳过、完成时写 localStorage
// v1.0.4: 渲染时包 I18nProvider, 强制 zh-CN locale 让中文断言继续过

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Onboarding } from "./Onboarding";
import { I18nProvider } from "../../i18n";

// 共享测试用的最小 piAPI mock
function installMockPiAPI(opts: { installed?: boolean; withWorkspaceDir?: boolean; selectDirectoryResult?: unknown } = {}) {
    const { installed = true, withWorkspaceDir = true, selectDirectoryResult } = opts;
    const listeners: Array<(s: { installed: boolean; localVersion: string | null; latestVersion: string | null; updateAvailable: boolean; executablePath: string | null; installMethod: string; configExists: boolean; defaultProvider: string | null; defaultModel: string | null }) => void> = [];

    const piAPI = {
        getStatus: vi.fn(async () => ({
            installed,
            localVersion: installed ? "0.75.5" : null,
            latestVersion: "0.76.0",
            updateAvailable: false,
            executablePath: installed ? "/usr/local/bin/pi" : null,
            installMethod: "npm",
            configExists: false,
            defaultProvider: null,
            defaultModel: null,
        })),
        refreshPiStatus: vi.fn(async () => ({
            installed,
            localVersion: installed ? "0.75.5" : null,
            latestVersion: "0.76.0",
            updateAvailable: false,
            executablePath: installed ? "/usr/local/bin/pi" : null,
            installMethod: "npm",
            configExists: false,
            defaultProvider: null,
            defaultModel: null,
        })),
        installPi: vi.fn(async () => ({ installed: true, localVersion: "0.75.5", latestVersion: null, updateAvailable: false, executablePath: null, installMethod: "npm", configExists: false, defaultProvider: null, defaultModel: null })),
        selectDirectory: vi.fn(async () => selectDirectoryResult ?? (withWorkspaceDir ? "/tmp/my-project" : null)),
        createWorkspace: vi.fn(async (name: string, path: string) => ({
            id: "ws-1",
            name,
            path,
            createdAt: Date.now(),
        })),
        selectWorkspace: vi.fn(async () => undefined),
        onPiStatusChanged: vi.fn((cb: (s: unknown) => void) => {
            listeners.push(cb as never);
            return () => {
                const i = listeners.indexOf(cb as never);
                if (i >= 0) listeners.splice(i, 1);
            };
        }),
        onPiInstallProgress: vi.fn(() => () => undefined),
    };

    // 在 window 上挂 piAPI 但保留 jsdom 的 localStorage / 其他字段
    (window as unknown as { piAPI: unknown }).piAPI = piAPI;
    return piAPI;
}

function renderWithI18n(ui: React.ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
    // jsdom 默认 navigator.language 是 'en-US', 强制 zh-CN 让中文断言继续过
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
});

describe("Onboarding", () => {
    it("renders the first step title", async () => {
        installMockPiAPI();
        renderWithI18n(<Onboarding onComplete={vi.fn()} />);
        expect(await screen.findByText("检查 Pi CLI")).toBeTruthy();
        // role="dialog" + aria-modal
        const dialog = screen.getByRole("dialog");
        expect(dialog.getAttribute("aria-modal")).toBe("true");
    });

    it("advances from step 1 to step 2 when Pi is installed", async () => {
        installMockPiAPI({ installed: true });
        renderWithI18n(<Onboarding onComplete={vi.fn()} />);
        const next = await screen.findByText("下一步");
        fireEvent.click(next);
        expect(await screen.findByText("选择工作区")).toBeTruthy();
    });

    it("shows 'install' button when Pi is not installed", async () => {
        installMockPiAPI({ installed: false });
        renderWithI18n(<Onboarding onComplete={vi.fn()} />);
        expect(await screen.findByText("立即安装")).toBeTruthy();
    });

    it("completes the wizard and writes localStorage on finish", async () => {
        installMockPiAPI({ installed: true });
        const onComplete = vi.fn();
        renderWithI18n(<Onboarding onComplete={onComplete} />);

        // step 1 → 2
        fireEvent.click(await screen.findByText("下一步"));

        // step 2: 选 workspace
        fireEvent.click(await screen.findByText("选择目录"));
        // 等 store 异步更新
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });

        // 下一步 → step 3
        fireEvent.click(await screen.findByText("下一步"));
        expect(await screen.findByText("准备就绪")).toBeTruthy();

        // 完成 — 走 stepper 之外的那个大黑按钮 (用 getAllByText 拿最后一个)
        const finishButtons = screen.getAllByText("完成");
        fireEvent.click(finishButtons[finishButtons.length - 1]);

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    });

    it("shows workspace picker IPC errors inline", async () => {
        installMockPiAPI({
            installed: true,
            selectDirectoryResult: {
            code: "ipcErrors.workspace.selectDirectoryFailed",
            fallback: "打开目录选择器失败: dialog unavailable",
            },
        });
        renderWithI18n(<Onboarding onComplete={vi.fn()} />);

        fireEvent.click(await screen.findByText("下一步"));
        fireEvent.click(await screen.findByText("选择目录"));

        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByRole("alert").textContent).toContain("打开目录选择器失败: dialog unavailable");
    });

    it("'skip' button writes localStorage and fires onComplete", async () => {
        installMockPiAPI({ installed: true });
        const onComplete = vi.fn();
        renderWithI18n(<Onboarding onComplete={onComplete} />);
        fireEvent.click(await screen.findByText("跳过引导"));
        expect(onComplete).toHaveBeenCalled();
        expect(window.localStorage.getItem("pi-desktop:firstLaunchDone")).toBe("true");
    });

    it("exposes primary onboarding action focus-visible rings for keyboard a11y", async () => {
        installMockPiAPI({ installed: true });
        renderWithI18n(<Onboarding onComplete={vi.fn()} />);

        const next = await screen.findByRole("button", { name: "下一步" });
        expect(next.className).toContain("focus-visible:ring-2");
        expect(screen.getByRole("button", { name: "跳过引导" }).className).toContain(
            "focus-visible:ring-2",
        );
    });
});
