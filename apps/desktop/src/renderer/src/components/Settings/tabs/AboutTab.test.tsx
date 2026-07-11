// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../../i18n";
import { AboutTab } from "./AboutTab";
import { useUpdaterStore } from "../../../stores/updater-store";

describe("AboutTab updater card", () => {
    beforeEach(() => {
        useUpdaterStore.setState({
            state: {
                phase: "available",
                currentVersion: "0.1.0",
                latestVersion: "0.2.0",
                updateAvailable: true,
                releaseNotes: "Fixed updater card",
                progress: null,
                lastCheckedAt: 1_720_000_000_000,
                disabledReason: null,
                error: null,
                releasePageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest",
            },
            loading: false,
            error: null,
            setupListeners: vi.fn(),
            cleanupListeners: vi.fn(),
            hydrate: vi.fn(async () => undefined),
            checkForUpdates: vi.fn(async () => undefined),
            downloadUpdate: vi.fn(async () => undefined),
            installUpdate: vi.fn(async () => undefined),
        });
        Object.assign(window, {
            piAPI: {
                openPath: vi.fn(async () => ""),
                diagnosticsExport: vi.fn(async () => ({ cancelled: false, path: "C:/tmp/pi-diagnostics.json" })),
            },
        });
    });

    it("shows the latest version and download action when an update is available", () => {
        render(
            <I18nProvider>
                <AboutTab />
            </I18nProvider>,
        );

        expect(screen.getByText("当前版本: 0.1.0")).toBeTruthy();
        expect(screen.getByText("最新版本: 0.2.0")).toBeTruthy();
        expect(screen.getByText("Fixed updater card")).toBeTruthy();
        expect(screen.getByRole("button", { name: "下载更新" })).toBeTruthy();
    });

    it("shows a restart install action after download completes", () => {
        useUpdaterStore.setState({
            state: {
                phase: "downloaded",
                currentVersion: "0.1.0",
                latestVersion: "0.2.0",
                updateAvailable: true,
                releaseNotes: "Ready",
                progress: { percent: 100, bytesPerSecond: 0, transferred: 1, total: 1 },
                lastCheckedAt: 1_720_000_000_000,
                disabledReason: null,
                error: null,
                releasePageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest",
            },
        });

        render(
            <I18nProvider>
                <AboutTab />
            </I18nProvider>,
        );

        expect(screen.getByRole("button", { name: "重启并安装" })).toBeTruthy();
    });

    it("shows updater state errors from the main process", () => {
        useUpdaterStore.setState({
            state: {
                phase: "error",
                currentVersion: "0.1.0",
                latestVersion: null,
                updateAvailable: false,
                releaseNotes: null,
                progress: null,
                lastCheckedAt: 1_720_000_000_000,
                disabledReason: null,
                error: "GitHub Releases 404",
                releasePageUrl: "https://github.com/ChisaAlter/pi-agent-desktop/releases/latest",
            },
            error: null,
        });

        render(
            <I18nProvider>
                <AboutTab />
            </I18nProvider>,
        );

        expect(screen.getByText("GitHub Releases 404")).toBeTruthy();
    });

    it("exports a redacted diagnostic report from the About page", async () => {
        render(
            <I18nProvider>
                <AboutTab />
            </I18nProvider>,
        );

        fireEvent.click(screen.getByRole("button", { name: "导出诊断报告" }));

        await waitFor(() => expect(window.piAPI.diagnosticsExport).toHaveBeenCalledTimes(1));
        expect((await screen.findByRole("status")).textContent).toContain("C:/tmp/pi-diagnostics.json");
    });
});
