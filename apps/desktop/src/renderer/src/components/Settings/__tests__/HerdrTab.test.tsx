// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useHerdrStore, buildHerdrTree } from "../../../stores/herdr-store";
import { HERDR_MOCK_AGENTS, HERDR_MOCK_SESSION } from "../../../stores/herdr-mock-data";
import { HerdrTab } from "../tabs/HerdrTab";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function seedMockConnected(): void {
    useHerdrStore.setState({
        mock: true,
        server: "connected",
        agents: HERDR_MOCK_AGENTS,
        tree: buildHerdrTree(HERDR_MOCK_SESSION, HERDR_MOCK_AGENTS),
    });
}

beforeEach(() => {
    useHerdrStore.getState().reset();
});

describe("HerdrTab — 设置「智能体」分组", () => {
    it("通用区：来源选择 + 自动检查/自动切换开关", () => {
        seedMockConnected();
        renderWithI18n(<HerdrTab />);
        expect(screen.getByText("来源")).toBeTruthy();
        expect(screen.getByText("自动检查更新")).toBeTruthy();
        expect(screen.getByText("自动切换稳定版")).toBeTruthy();
        // 开关 = 通用区 2 个 + 诊断区运行策略 2 个
        const switches = screen.getAllByRole("switch");
        expect(switches).toHaveLength(4);
        expect(switches[0]?.getAttribute("aria-checked")).toBe("true");
    });

    it("兼容性与能力：当前版本/兼容性 pill/能力清单（10 项）", () => {
        seedMockConnected();
        renderWithI18n(<HerdrTab />);
        expect(screen.getByText(/Desktop 托管 · v0.9.0 · API v3/)).toBeTruthy();
        expect(screen.getByTestId("herdr-compat-pill").textContent).toContain("完全兼容");
        for (const cap of ["agent.start", "agent.prompt", "agent.wait", "agent.read", "agent.send_keys", "agent.focus", "worktree.create", "events.subscribe", "terminal.attach", "resume"]) {
            expect(screen.getByText(cap)).toBeTruthy();
        }
    });

    it("更新流程：检查→候选面板→验证→已验证（不静默重启语义）", () => {
        seedMockConnected();
        renderWithI18n(<HerdrTab />);
        // 初始无更新面板
        expect(screen.queryByTestId("verify-update")).toBeNull();
        fireEvent.click(screen.getByTestId("check-update"));
        expect(screen.getByTestId("verify-update")).toBeTruthy();
        expect(screen.getByText(/v0.9.1 · 官方发行版/)).toBeTruthy();
        fireEvent.click(screen.getByTestId("verify-update"));
        expect(screen.getByText("已验证")).toBeTruthy();
        expect(screen.getByText("18/18 项能力契约通过")).toBeTruthy();
    });

    it("安全切换 → 等待安全切换点模态（有智能体排队不静默重启）", () => {
        seedMockConnected();
        renderWithI18n(<HerdrTab />);
        fireEvent.click(screen.getByTestId("check-update"));
        fireEvent.click(screen.getByTestId("verify-update"));
        fireEvent.click(screen.getByTestId("switch-update"));
        expect(screen.getByTestId("herdr-switch-modal")).toBeTruthy();
        expect(screen.getAllByText("等待安全切换点").length).toBeGreaterThan(0);
        fireEvent.click(screen.getByTestId("herdr-switch-confirm"));
        expect(screen.queryByTestId("herdr-switch-modal")).toBeNull();
    });

    it("诊断区：连接状态读取 store（非 mock → 未连接，不伪造）", () => {
        // 非 mock：断线空态
        renderWithI18n(<HerdrTab />);
        expect(screen.getByTestId("herdr-diag-connection").textContent).toContain("未连接");
    });

    it("诊断区：mock 连接显示原型值", () => {
        seedMockConnected();
        renderWithI18n(<HerdrTab />);
        expect(screen.getAllByText(/server：已连接 · 会话 pi-desktop/).length).toBeGreaterThan(0);
    });
});
