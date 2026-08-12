// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, AgentRuntimeState, AgentTab, ExtensionUiRequest } from "@shared";
import { AgentsPanel } from "../AgentsPanel";
import { I18nProvider } from "../../../i18n";
import { useAgentStore } from "../../../stores/agent-store";
import { useSubagentStore } from "../../../stores/subagent-store";
import { usePermissionStore } from "../../../stores/permission-store";
import { useWorkspaceStore } from "../../../stores/workspace-store";
import { usePlanStore } from "../../../stores/plan-store";
import { useFleetSignalsStore } from "../../../stores/fleet-signals-store";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function makeAgent(overrides: Partial<AgentTab> = {}): AgentTab {
    return {
        id: "agent-1",
        workspaceId: "ws-1",
        title: "重构分支",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
        id: `m-${Math.random()}`,
        agentId: "agent-1",
        role: "assistant",
        content: "已完成重构",
        createdAt: 2,
        ...overrides,
    };
}

const unsub = (): void => undefined;

beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
        value: {
            agentsList: vi.fn(async () => []),
            agentsCreate: vi.fn(async (input: unknown) => makeAgent({ id: "agent-new", title: (input as { title?: string }).title ?? "Agent" })),
            agentsMessages: vi.fn(async () => []),
            agentsRuntimeState: vi.fn(async () => ({ agentId: "agent-1", status: "idle", isStreaming: false })),
            agentsPrompt: vi.fn(async () => undefined),
            agentsStop: vi.fn(async () => undefined),
            agentsRestart: vi.fn(async () => makeAgent()),
            agentsSetCurrent: vi.fn(async () => undefined),
            subagentListInstances: vi.fn(async () => []),
            subagentCancel: vi.fn(async () => null),
            onAgentsState: vi.fn(() => unsub),
            onAgentMessages: vi.fn(() => unsub),
            onAgentRuntimeState: vi.fn(() => unsub),
            onAgentEvent: vi.fn(() => unsub),
            onSubagentEvent: vi.fn(() => unsub),
            getGitStatus: vi.fn(async () => null),
            gitDiff: vi.fn(async () => ""),
        },
        configurable: true,
    });
    useAgentStore.setState({
        agents: [],
        currentAgentId: null,
        messagesByAgent: {},
        runtimeByAgent: {},
        initialized: true,
    });
    useSubagentStore.setState({ byAgent: {}, initialized: true });
    usePermissionStore.setState({ pending: [], mode: "smart" });
    usePlanStore.setState({ decisionRequest: null });
    useFleetSignalsStore.setState({ queueBlockedByAgent: {}, approvalByRequest: {}, approvalPendingByWorkspace: {} });
    useWorkspaceStore.setState({
        workspaces: [{ id: "ws-1", name: "主项目", path: "C:\\proj", createdAt: 1 }],
        currentWorkspaceId: "ws-1",
    });
});

describe("AgentsPanel — 舰队面板", () => {
    it("空态: 无 agent 时显示引导文案", () => {
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.getByText("还没有 Agent")).toBeTruthy();
        expect(screen.getAllByText("新建 Agent").length).toBeGreaterThanOrEqual(1);
    });

    it("渲染 agent 卡: 标题 + 工作区 + 空闲徽章", () => {
        useAgentStore.setState({ agents: [makeAgent()] });
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.getByText("重构分支")).toBeTruthy();
        expect(screen.getAllByText("主项目").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("空闲").length).toBeGreaterThanOrEqual(1);
    });

    it("running 状态显示「运行中」", () => {
        useAgentStore.setState({
            agents: [makeAgent({ status: "running" })],
            runtimeByAgent: { "agent-1": { agentId: "agent-1", status: "running", isStreaming: true } },
        });
        const { container } = renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.getAllByText("运行中").length).toBeGreaterThanOrEqual(1);
        expect(container.querySelectorAll('[data-agent-status="working"]').length).toBeGreaterThanOrEqual(1);
    });

    it("挂起审批 → 阻塞徽章 + 原因「等待审批」", () => {
        useAgentStore.setState({
            agents: [makeAgent({ status: "running" })],
            runtimeByAgent: { "agent-1": { agentId: "agent-1", status: "running", isStreaming: true } },
        });
        const pending: ExtensionUiRequest = {
            requestId: "req-1",
            agentId: "agent-1",
            workspaceId: "ws-1",
            kind: "confirm",
            source: "permission",
            title: "允许执行 bash",
            createdAt: 1,
        };
        usePermissionStore.setState({ pending: [pending], mode: "smart" });
        const { container } = renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.getAllByText("阻塞").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("等待审批").length).toBeGreaterThanOrEqual(1);
        expect(container.querySelectorAll('[data-agent-status="blocked"]').length).toBeGreaterThanOrEqual(1);
    });

    it("已产出消息的 idle agent → 已完成", () => {
        useAgentStore.setState({
            agents: [makeAgent()],
            messagesByAgent: { "agent-1": [makeMessage()] },
        });
        const { container } = renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(1);
        expect(container.querySelectorAll('[data-agent-status="done"]').length).toBeGreaterThanOrEqual(1);
    });

    it("展开卡显示最近消息与子代理", async () => {
        useAgentStore.setState({
            agents: [makeAgent()],
            messagesByAgent: { "agent-1": [makeMessage({ role: "user", content: "帮我重构" }), makeMessage()] },
        });
        useSubagentStore.setState({
            byAgent: {
                "agent-1": [
                    {
                        actorId: "explore-abc123",
                        agentId: "agent-1",
                        workspaceId: "ws-1",
                        subagentType: "explore",
                        description: "检索 API 文档",
                        status: "running",
                        turnCount: 1,
                        createdAt: 1,
                    },
                ],
            },
        });
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        fireEvent.click(screen.getByText("重构分支"));
        expect(screen.getAllByText("检索 API 文档").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("子代理")).toBeTruthy();
        expect(screen.getByText("最近消息")).toBeTruthy();
        expect(screen.getAllByText("已完成重构").length).toBeGreaterThanOrEqual(1);
    });

    it("新建弹窗: 选工作区 + 输入描述 → 创建并发送 prompt", async () => {
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        fireEvent.click(screen.getAllByText("新建 Agent")[0]);
        expect(screen.getByTestId("new-agent-dialog")).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText("描述要它完成的任务（可选，创建后立即执行）"), {
            target: { value: "重构 App.tsx" },
        });
        fireEvent.click(screen.getByText("创建"));

        const createMock = window.piAPI.agentsCreate as ReturnType<typeof vi.fn>;
        const promptMock = window.piAPI.agentsPrompt as ReturnType<typeof vi.fn>;
        await waitFor(() => expect(createMock).toHaveBeenCalled());
        expect(promptMock).toHaveBeenCalled();
    });

    it("点「打开对话」回调 onOpenAgent", () => {
        const onOpenAgent = vi.fn();
        useAgentStore.setState({ agents: [makeAgent()] });
        renderWithI18n(<AgentsPanel onOpenAgent={onOpenAgent} />);
        fireEvent.click(screen.getByText("打开对话"));
        expect(onOpenAgent).toHaveBeenCalledWith("agent-1");
    });

    it("approval 挂起信号 → 阻塞徽章 + 原因「等待审批」", () => {
        useAgentStore.setState({
            agents: [makeAgent({ status: "running" })],
            runtimeByAgent: { "agent-1": { agentId: "agent-1", status: "running", isStreaming: true } },
        });
        useFleetSignalsStore.setState({ approvalPendingByWorkspace: { "ws-1": 1 } });
        const { container } = renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(container.querySelectorAll('[data-agent-status="blocked"]').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("等待审批").length).toBeGreaterThanOrEqual(1);
    });

    it("done 卡显示「收割结果」按钮, 点击展开产出区", () => {
        useAgentStore.setState({
            agents: [makeAgent()],
            messagesByAgent: { "agent-1": [makeMessage()] },
        });
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        const harvestButton = screen.getByTestId("harvest-button");
        expect(harvestButton).toBeTruthy();
        fireEvent.click(harvestButton);
        expect(screen.getByTestId("agent-harvest")).toBeTruthy();
        // 产出区渲染完整 markdown 消息 (MarkdownRenderer 路径)
        expect(screen.getAllByText("已完成重构").length).toBeGreaterThanOrEqual(1);
    });

    it("非 done 卡不显示收割按钮", () => {
        useAgentStore.setState({ agents: [makeAgent({ status: "running" })] });
        renderWithI18n(<AgentsPanel onOpenAgent={() => undefined} />);
        expect(screen.queryByTestId("harvest-button")).toBeNull();
    });
});
