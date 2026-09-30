// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { I18nProvider } from "../../../i18n";
import { useHerdrStore } from "../../../stores/herdr-store";
import { HerdrTab } from "../tabs/HerdrTab";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function seedRealConnected(): void {
    useHerdrStore.setState({
        mock: false,
        server: "connected",
        runtimeStatus: {
            connection: "connected",
            source: "external",
            version: "0.8.0-preview.2026-08-04-d78e3d3b5126",
            protocol: 19,
            pid: 4321,
            owned: false,
            compatibility: "compatible",
            error: null,
        },
        tree: { session: "pi-e2e", workspaces: [] },
    });
}

function seedRealOffline(): void {
    useHerdrStore.setState({
        mock: false,
        server: "offline",
        runtimeStatus: null,
        tree: { session: "", workspaces: [] },
    });
}

function connectedProjection() {
    return {
        revision: 2,
        status: {
            connection: "connected" as const,
            source: "env" as const,
            version: "0.8.0-preview.2026-08-04-d78e3d3b5126",
            protocol: 19,
            pid: null,
            owned: true,
            compatibility: "compatible" as const,
            error: null,
        },
        agents: [],
        tree: { session: "pi-e2e", workspaces: [] },
    };
}

beforeEach(() => {
    useHerdrStore.getState().reset();
    Object.defineProperty(window, "piAPI", {
        value: {
            herdrStartServer: vi.fn(async () => connectedProjection()),
            herdrStopServer: vi.fn(async () => undefined),
            herdrInstallIntegration: vi.fn(async () => undefined),
        },
        configurable: true,
    });
});

describe("HerdrTab — 设置「智能体」分组（真实数据驱动）", () => {
    it("未连接：显示断线、来源未知、无能力；连接按钮可用", () => {
        seedRealOffline();
        renderWithI18n(<HerdrTab />);

        expect(screen.getByTestId("herdr-diag-connection").textContent).toContain("未连接");
        expect(screen.getByTestId("herdr-source-pill").textContent).toContain("未知");
        expect(screen.getByTestId("herdr-capabilities-offline")).toBeTruthy();
        const connect = screen.getByTestId("herdr-connect") as HTMLButtonElement;
        expect(connect.disabled).toBe(false);
        expect(connect.textContent).toContain("连接");
        // 假流程按钮不存在
        expect(screen.queryByTestId("check-update")).toBeNull();
        expect(screen.queryByTestId("verify-update")).toBeNull();
        expect(screen.queryByTestId("switch-update")).toBeNull();
        expect(screen.queryByText("自动检查更新")).toBeNull();
        expect(screen.queryByText("自动切换稳定版")).toBeNull();
    });

    it("已连接：显示真实版本/协议/兼容性/来源与已接入能力", () => {
        seedRealConnected();
        renderWithI18n(<HerdrTab />);

        expect(screen.getByTestId("herdr-diag-connection").textContent).toContain("正常");
        expect(screen.getByTestId("herdr-source-pill").textContent).toContain("系统安装");
        expect(screen.getByTestId("herdr-compat-pill").textContent).toContain("完全兼容");
        expect(screen.getByText("0.8.0-preview.2026-08-04-d78e3d3b5126")).toBeTruthy();
        expect(screen.getByText("protocol v19")).toBeTruthy();
        expect(screen.getByText("session.snapshot")).toBeTruthy();
        expect(screen.getByText("agent.prompt")).toBeTruthy();
        // 未接入的能力不展示
        expect(screen.queryByText("terminal.attach")).toBeNull();
        expect(screen.queryByText("resume")).toBeNull();
        // 已连接时连接按钮禁用
        expect((screen.getByTestId("herdr-connect") as HTMLButtonElement).disabled).toBe(true);
    });

    it("连接按钮 → 调用 herdrStartServer", () => {
        seedRealOffline();
        renderWithI18n(<HerdrTab />);
        fireEvent.click(screen.getByTestId("herdr-connect"));
        expect(window.piAPI.herdrStartServer).toHaveBeenCalledOnce();
    });

    it("停止服务：确认模态后才调用 herdrStopServer({confirmed:true})", async () => {
        seedRealConnected();
        renderWithI18n(<HerdrTab />);
        fireEvent.click(screen.getByTestId("herdr-stop"));
        expect(screen.getByTestId("herdr-stop-modal")).toBeTruthy();
        fireEvent.click(screen.getByTestId("herdr-stop-confirm"));
        await waitFor(() => {
            expect(window.piAPI.herdrStopServer).toHaveBeenCalledWith({ confirmed: true });
        });
        expect(screen.queryByTestId("herdr-stop-modal")).toBeNull();
    });

    it("安装 Pi 集成：确认模态后才调用 herdrInstallIntegration({target:'pi', confirmed:true})", async () => {
        seedRealOffline();
        renderWithI18n(<HerdrTab />);
        fireEvent.click(screen.getByTestId("herdr-install-pi"));
        expect(screen.getByTestId("herdr-install-modal")).toBeTruthy();
        fireEvent.click(screen.getByTestId("herdr-install-confirm"));
        await waitFor(() => {
            expect(window.piAPI.herdrInstallIntegration).toHaveBeenCalledWith({ target: "pi", confirmed: true });
        });
        expect(screen.queryByTestId("herdr-install-modal")).toBeNull();
    });

    it("诊断区数据目录显示官方路径", () => {
        seedRealOffline();
        renderWithI18n(<HerdrTab />);
        expect(screen.getByText("%APPDATA%/herdr")).toBeTruthy();
    });
});
