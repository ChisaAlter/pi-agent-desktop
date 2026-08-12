// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { HerdrPaneTerminal } from "../HerdrPaneTerminal";
import { I18nProvider } from "../../../i18n";
import { buildHerdrTree, useHerdrStore } from "../../../stores/herdr-store";
import { HERDR_MOCK_AGENTS, HERDR_MOCK_SESSION, HERDR_MOCK_TERMINAL_LINES } from "../../../stores/herdr-mock-data";
import { useToastStore } from "../../../stores/toast-store";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

type HerdrStoreState = ReturnType<typeof useHerdrStore.getState>;

/** 用原型同款 mock 数据种子 store（auth-worker 默认 blocked）。 */
function seedMockStore(overrides: Partial<HerdrStoreState> = {}): void {
    useHerdrStore.setState({
        mock: true,
        server: "connected",
        view: "pane",
        selectedAgent: "auth-worker",
        attached: true,
        stateSeq: 184,
        agents: HERDR_MOCK_AGENTS,
        tree: buildHerdrTree(HERDR_MOCK_SESSION, HERDR_MOCK_AGENTS),
        terminalLog: [...HERDR_MOCK_TERMINAL_LINES],
        ...overrides,
    });
}

beforeEach(() => {
    useToastStore.setState({ toasts: [] });
});

describe("HerdrPaneTerminal — 实时终端视图", () => {
    it("渲染身份面板 7 项 + 面包屑 + 终端初始日志与配色", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        // 面包屑 = session / workspace / tab / pane.name
        expect(screen.getByTestId("pane-crumb").textContent).toBe("pi-desktop / primary / implementation / auth-worker");

        // 身份面板 7 项：智能体 / 窗格／终端 / 状态权威来源 / 状态变更序号 / 原生会话 / 工作树 / 传输方式
        const info = screen.getByTestId("pane-info");
        expect(info).toBeTruthy();
        expect(screen.getByText("运行时身份")).toBeTruthy();
        expect(screen.getByText("智能体")).toBeTruthy();
        expect(screen.getByText("认证实现智能体 · Pi")).toBeTruthy();
        expect(screen.getByText("窗格／终端")).toBeTruthy();
        expect(screen.getByText("p-02 / term-7f12")).toBeTruthy();
        expect(screen.getByText("状态权威来源")).toBeTruthy();
        expect(screen.getByText("Herdr Pi 生命周期钩子")).toBeTruthy();
        expect(screen.getByText("状态变更序号")).toBeTruthy();
        expect(screen.getByTestId("state-seq").textContent).toBe("184");
        expect(screen.getByText("原生会话")).toBeTruthy();
        expect(screen.getByText("auth.jsonl")).toBeTruthy();
        expect(screen.getByText("工作树")).toBeTruthy();
        expect(screen.getByText("wt/auth-fix")).toBeTruthy();
        expect(screen.getByText("传输方式")).toBeTruthy();
        expect(screen.getByText("二进制客户端 · 实时")).toBeTruthy();

        // 终端逐行渲染 mock 日志；prompt 行绿 / 命令蓝 / 警告琥珀（与原型 span 语义一致：
        // ❯ 仅符号绿、◆ 整行琥珀、Herdr 集成已连接 整行蓝）
        const terminal = screen.getByTestId("pane-terminal");
        expect(terminal.textContent).toContain("Herdr 集成已连接 · 窗格 p-02 · 状态来源 herdr:pi");
        expect(terminal.textContent).toContain("◆ 正在等待审批…");
        const lines = Array.from(terminal.querySelectorAll("div"));
        const promptLine = lines.find((el) => el.textContent?.startsWith("❯"));
        expect(promptLine?.querySelector("span")?.className).toContain("text-[#65d6a6]");
        expect(promptLine?.querySelectorAll("span")[1]?.className).not.toContain("text-[#65d6a6]");
        const warnLine = lines.find((el) => el.textContent?.startsWith("◆"));
        expect(warnLine?.querySelector("span")?.className).toContain("text-[#ffcc76]");
        const cmdLine = lines.find((el) => el.textContent?.startsWith("Herdr 集成已连接"));
        expect(cmdLine?.querySelector("span")?.className).toContain("text-[#7cb8ff]");
    });

    it("blocked 横幅出现；点击主按钮后消失 + stateSeq 前进 + terminalLog 追加", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        // mock 数据 auth-worker 为 blocked → 横幅可见
        expect(screen.getByTestId("block-banner")).toBeTruthy();
        expect(screen.getByText("智能体被阻塞")).toBeTruthy();
        expect(screen.getByText("Pi 正在等待命令执行审批；请在真实终端窗格中处理。")).toBeTruthy();

        fireEvent.click(screen.getByTestId("resolve-block"));

        // 进入真实 pane 处理（mock 模拟生命周期上报 working）→ 横幅消失
        expect(screen.queryByTestId("block-banner")).toBeNull();
        expect(screen.getByTestId("state-seq").textContent).toBe("185");
        expect(screen.getByText("✓ 已在终端窗格中批准")).toBeTruthy();
        expect(screen.getByText("● 正在运行 pnpm test auth…")).toBeTruthy();
        expect(useToastStore.getState().toasts.some((x) => x.message === "审批在真实 Herdr 终端窗格内完成，生命周期钩子上报「工作中」")).toBe(true);
    });

    it("attach 切换：pill 状态与按钮文案随 attached 翻转 + 对应 toast", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        const pill = screen.getByTestId("attach-pill");
        expect(pill.textContent).toBe("● 已实时连接");
        expect(pill.getAttribute("data-attached")).toBe("true");

        fireEvent.click(screen.getByRole("button", { name: "断开连接" }));
        expect(pill.textContent).toBe("○ 已断开");
        expect(pill.getAttribute("data-attached")).toBe("false");
        expect(screen.getByRole("button", { name: "重新连接" })).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
        expect(pill.textContent).toBe("● 已实时连接");
        expect(pill.getAttribute("data-attached")).toBe("true");

        const messages = useToastStore.getState().toasts.map((x) => x.message);
        expect(messages).toContain("客户端已断开；Herdr 终端窗格继续运行");
        expect(messages).toContain("已通过官方二进制传输协议建立实时连接");
    });

    it("发送 prompt：terminalLog 追加 + stateSeq 前进 + toast", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        fireEvent.change(screen.getByTestId("prompt-input"), { target: { value: "修复认证测试，并运行相关测试" } });
        fireEvent.click(screen.getByTestId("send-prompt"));

        const terminal = screen.getByTestId("pane-terminal");
        expect(terminal.textContent).toContain("❯ 通过 agent.prompt 注入指令");
        expect(terminal.textContent).toContain("修复认证测试，并运行相关测试");
        expect(terminal.textContent).toContain("● 工作中…");
        expect(screen.getByTestId("state-seq").textContent).toBe("185");
        expect(useToastStore.getState().toasts.some((x) => x.message === "指令生效序号已前进；开始等待空闲／完成")).toBe(true);
    });

    it("聚焦 / 调整尺寸 / 发送按键 / 读取历史输出 → toast（不伪造效果）", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        fireEvent.click(screen.getByRole("button", { name: "聚焦" }));
        fireEvent.click(screen.getByRole("button", { name: "调整尺寸" }));
        fireEvent.click(screen.getByRole("button", { name: "发送按键" }));
        fireEvent.click(screen.getByTestId("read-history"));

        const messages = useToastStore.getState().toasts.map((x) => x.message);
        expect(messages).toContain("已调用 Herdr agent.focus 并标记已查看");
        expect(messages).toContain("已通过官方终端传输协议 发送 142×38 尺寸调整事件");
        expect(messages).toContain("发送按键面板：Ctrl+C / 回车 / 自定义键序列");
        expect(messages).toContain("读取 agent.read 历史；与实时连接的终端 明确分离");
        // 读取历史不触碰实时 terminalLog
        expect(screen.getByTestId("pane-terminal").textContent).not.toContain("读取 agent.read 历史");
    });

    it("非 mock → 空态，不渲染终端", () => {
        seedMockStore({ mock: false, selectedAgent: null, server: "offline", attached: false, stateSeq: 0, agents: [], tree: { session: "", workspaces: [] }, terminalLog: [] });
        renderWithI18n(<HerdrPaneTerminal />);

        expect(screen.getByTestId("herdr-pane-view")).toBeTruthy();
        expect(screen.getByText("未连接 Herdr 运行时 — 实时终端不可用")).toBeTruthy();
        expect(screen.queryByTestId("pane-terminal")).toBeNull();
        expect(screen.queryByTestId("prompt-input")).toBeNull();
    });

    it("mock 但未选中 agent → 空态", () => {
        seedMockStore({ selectedAgent: null });
        renderWithI18n(<HerdrPaneTerminal />);

        expect(screen.getByText("未连接 Herdr 运行时 — 实时终端不可用")).toBeTruthy();
        expect(screen.queryByTestId("pane-terminal")).toBeNull();
    });

    it("负向：除「进入终端并批准」外不存在其他含「批准」的按钮，解决后完全消失", () => {
        seedMockStore();
        renderWithI18n(<HerdrPaneTerminal />);

        const approveButtons = screen.getAllByRole("button").filter((b) => b.textContent?.includes("批准"));
        expect(approveButtons.map((b) => b.textContent)).toEqual(["进入终端并批准"]);

        fireEvent.click(screen.getByTestId("resolve-block"));
        const remaining = screen.getAllByRole("button").filter((b) => b.textContent?.includes("批准"));
        expect(remaining).toHaveLength(0);
    });
});
