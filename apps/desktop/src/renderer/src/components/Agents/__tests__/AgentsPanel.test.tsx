// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPanel } from "../AgentsPanel";
import { I18nProvider } from "../../../i18n";
import { useHerdrStore, buildHerdrTree } from "../../../stores/herdr-store";
import { HERDR_MOCK_AGENTS, HERDR_MOCK_SESSION } from "../../../stores/herdr-mock-data";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

/** 种子: mock 模式 + 原型同款数据 */
function seedMockStore(overrides: Partial<{ server: "connected" | "offline" | "reconnecting"; selected: string }> = {}): void {
    const { server = "connected", selected = "auth-worker" } = overrides;
    useHerdrStore.setState({
        mock: true,
        server,
        selectedAgent: selected,
        stateSeq: 184,
        agents: HERDR_MOCK_AGENTS,
        tree: buildHerdrTree(HERDR_MOCK_SESSION, HERDR_MOCK_AGENTS),
    });
}

beforeEach(() => {
    useHerdrStore.getState().reset();
    vi.restoreAllMocks();
});

describe("AgentsPanel — Herdr 舰队视图", () => {
    it("按 workspace 分组渲染卡片；工作区行显示计数摘要", () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);

        const groups = screen.getAllByTestId("fleet-workspace-group");
        expect(groups).toHaveLength(2);
        expect(groups[0].getAttribute("data-workspace")).toBe("primary");
        expect(groups[1].getAttribute("data-workspace")).toBe("wt/auth-fix");
        // primary 摘要: 3 个智能体 · 2 个标签页 · 仓库 pi-desktop
        expect(groups[0].textContent).toContain("3 个智能体 · 2 个标签页 · 仓库 pi-desktop");
        // worktree 摘要: 分支 herdr/auth-fix（从 worktree 名推导，与原型一致）
        expect(groups[1].textContent).toContain("分支 herdr/auth-fix");
    });

    it("卡片显示 显示名/kind·窗格/任务/会话/工作树/状态来源 + 状态徽章", () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);

        expect(screen.getByText("规划智能体")).toBeTruthy();
        expect(screen.getByText(/Pi · 窗格 p-01 · primary/)).toBeTruthy();
        expect(screen.getByText("拆解任务并验证任务依赖")).toBeTruthy();
        expect(screen.getByText("pi-plan.jsonl")).toBeTruthy();
        expect(screen.getAllByText("Herdr Pi 生命周期钩子").length).toBeGreaterThan(0);
        // 状态徽章（role=status 非 name-from-content 角色，直接断言文本）
        expect(screen.getByText("工作中")).toBeTruthy();
    });

    it("无彩色侧边框（NL-003 负向）：卡片无 border-l-* 类", () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);
        const cards = screen.getAllByTestId("agent-card");
        for (const card of cards) {
            expect(card.className).not.toMatch(/border-l-/);
        }
    });

    it("done 卡片主 CTA=标记已查看；点击后状态变空闲（seen 语义）", async () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);

        const doneCard = document.querySelector('[data-agent="tests-worker"]') as HTMLElement;
        expect(doneCard.textContent).toContain("已完成 · 待查看");
        const primary = doneCard.querySelector('[data-testid="card-primary-action"]') as HTMLButtonElement;
        expect(primary.textContent).toContain("标记已查看");
        fireEvent.click(primary);
        await waitFor(() => {
            expect(document.querySelector('[data-agent="tests-worker"]')?.textContent).toContain("空闲");
        });
    });

    it("blocked 卡片主 CTA=处理阻塞 → 进入 pane 视图；状态由生命周期上报模拟（不伪造批准）", () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);

        const blockedCard = document.querySelector('[data-agent="auth-worker"]') as HTMLElement;
        const primary = blockedCard.querySelector('[data-testid="card-primary-action"]') as HTMLButtonElement;
        expect(primary.textContent).toContain("处理阻塞");
        fireEvent.click(primary);
        expect(useHerdrStore.getState().view).toBe("pane");
        // 原型行为: 在真实 pane 中处理后由生命周期钩子上报「工作中」（mock 模拟上报）;
        // 关键点: 无 GUI 内「批准」按钮, 动作入口是进入终端
        expect(useHerdrStore.getState().agents.find((a) => a.name === "auth-worker")?.state).toBe("working");
        expect(useHerdrStore.getState().stateSeq).toBe(185);
    });

    it("其他状态卡片主 CTA=打开终端", () => {
        seedMockStore();
        renderWithI18n(<AgentsPanel />);

        const idleCard = document.querySelector('[data-agent="reviewer"]') as HTMLElement;
        const primary = idleCard.querySelector('[data-testid="card-primary-action"]') as HTMLButtonElement;
        expect(primary.textContent).toContain("打开终端");
        fireEvent.click(primary);
        expect(useHerdrStore.getState().view).toBe("pane");
    });

    it("断线 → 卡片 data-state=disconnected，禁陈旧 done", () => {
        seedMockStore({ server: "offline" });
        renderWithI18n(<AgentsPanel />);

        const cards = screen.getAllByTestId("agent-card");
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
            expect(card.getAttribute("data-state")).toBe("disconnected");
        }
    });

    it("非 mock（无运行时）→ 空态，不渲染假数据", () => {
        useHerdrStore.setState({ mock: false, server: "offline", agents: [], tree: { session: "", workspaces: [] } });
        renderWithI18n(<AgentsPanel />);
        expect(screen.getByTestId("agents-panel").textContent).toContain("该工作区暂无智能体");
    });
});
