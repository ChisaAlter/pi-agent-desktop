// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useHerdrStore } from "../../../stores/herdr-store";
import { useToastStore } from "../../../stores/toast-store";
import { MissionCockpit } from "../MissionCockpit";

const DEFAULT_GOAL = "修复认证流程、补齐回归测试，并通过独立 审查智能体 审查";

const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

/** 种子 mock 态（与 herdr-mock-data 一致）— mock 关闭时组件显示空态。 */
function seedMock(): void {
    useHerdrStore.setState({
        mock: true,
        server: "connected",
        tree: { session: "pi-desktop", workspaces: [] },
        missionStatus: "draft",
        missionSeq: 0,
        missionAttempt: 1,
        missionGoal: DEFAULT_GOAL,
        mergeConfirmOpen: false,
    });
}

/** 种子非 mock 态（默认初始化分支）。 */
function seedOffline(): void {
    useHerdrStore.setState({
        mock: false,
        server: "offline",
        tree: { session: "", workspaces: [] },
        missionStatus: "draft",
        missionSeq: 0,
        missionAttempt: 1,
        missionGoal: "",
        mergeConfirmOpen: false,
    });
}

/** 推进 mission 到 passed（规划 → 运行 → 2200ms 审查 → 修订 → 复审）。 */
function driveToPassed(): void {
    fireEvent.click(screen.getByTestId("mission-plan"));
    fireEvent.click(screen.getByTestId("mission-run"));
    act(() => {
        vi.advanceTimersByTime(2200);
    });
    fireEvent.click(screen.getByTestId("revision-btn"));
    fireEvent.click(screen.getByTestId("review-pass-btn"));
}

function toastMessages(): string[] {
    return useToastStore.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
    seedMock();
    useToastStore.setState({ toasts: [] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("MissionCockpit — 任务驾驶舱", () => {
    it("draft 初始态: hero + 草稿徽章 + 横幅 seq=0 + DAG 空态 + 三栏等待态", () => {
        renderWithI18n(<MissionCockpit />);
        expect(screen.getByTestId("mission-hero")).toBeTruthy();
        expect(screen.getByTestId("mission-status").textContent).toBe("草稿");
        const goalInput = screen.getByTestId("mission-goal") as HTMLInputElement;
        expect(goalInput.value).toBe(DEFAULT_GOAL);
        expect(screen.getByTestId("mission-banner")).toBeTruthy();
        expect(screen.getByTestId("mission-seq").textContent).toContain("0");
        expect(screen.getByTestId("mission-dag")).toBeTruthy();
        expect(screen.getByTestId("dag-empty")).toBeTruthy();
        expect(screen.queryAllByTestId("dag-node")).toHaveLength(0);
        expect(screen.getByTestId("mission-artifacts").textContent).toContain("等待执行智能体交付");
        expect(screen.getByTestId("mission-review").textContent).toContain("等待审查智能体");
        expect(screen.getByTestId("mission-integration").textContent).toContain("等待通过审查的提交");
    });

    it("生成任务图 → 已规划 + 4 个 ready 节点 + toast, 按钮禁用", () => {
        renderWithI18n(<MissionCockpit />);
        fireEvent.click(screen.getByTestId("mission-plan"));
        expect(screen.getByTestId("mission-status").textContent).toBe("已规划");
        expect(screen.getByTestId("mission-seq").textContent).toContain("1");
        const nodes = screen.getAllByTestId("dag-node");
        expect(nodes).toHaveLength(4);
        nodes.forEach((node) => expect(node.getAttribute("data-status")).toBe("ready"));
        expect(screen.queryByTestId("dag-empty")).toBeNull();
        expect(toastMessages()).toContain("规划智能体已生成 4 个任务节点；尚未启动执行智能体");
        expect((screen.getByTestId("mission-plan") as HTMLButtonElement).disabled).toBe(true);
    });

    it("开始任务 → 执行中, 2200ms 后审查中 + 驳回按钮", () => {
        vi.useFakeTimers();
        renderWithI18n(<MissionCockpit />);
        fireEvent.click(screen.getByTestId("mission-plan"));
        fireEvent.click(screen.getByTestId("mission-run"));
        expect(screen.getByTestId("mission-status").textContent).toBe("执行中");
        const running = screen.getAllByTestId("dag-node").map((node) => node.getAttribute("data-status"));
        expect(running).toEqual(["passed", "running", "running", "ready"]);
        act(() => {
            vi.advanceTimersByTime(2200);
        });
        expect(screen.getByTestId("mission-status").textContent).toBe("审查中");
        expect(screen.getByTestId("mission-review").textContent).toContain("审查未通过");
        expect(screen.getByTestId("revision-btn")).toBeTruthy();
        // 交付物栏出现归属/轮次/摘要
        expect(screen.getByTestId("mission-artifacts").textContent).toContain("auth-worker");
        expect(screen.getByTestId("mission-artifacts").textContent).toContain("轮次 1");
    });

    it("修订 → 复审 → 已通过（轮次 2 + 整合就绪）", () => {
        vi.useFakeTimers();
        renderWithI18n(<MissionCockpit />);
        fireEvent.click(screen.getByTestId("mission-plan"));
        fireEvent.click(screen.getByTestId("mission-run"));
        act(() => {
            vi.advanceTimersByTime(2200);
        });
        fireEvent.click(screen.getByTestId("revision-btn"));
        expect(screen.getByTestId("mission-status").textContent).toBe("修订中");
        expect(screen.getByTestId("mission-review").textContent).toContain("正在执行修订");
        expect(screen.getByTestId("review-pass-btn")).toBeTruthy();
        expect(screen.getByTestId("mission-artifacts").textContent).toContain("轮次 2");
        expect(toastMessages()).toContain("已通过 Herdr 启动／指令接口 创建修订轮次 2");
        fireEvent.click(screen.getByTestId("review-pass-btn"));
        expect(screen.getByTestId("mission-status").textContent).toBe("已通过");
        expect(screen.getByTestId("mission-review").textContent).toContain("审查已通过");
        expect(screen.getByTestId("mission-integration").textContent).toContain("已进入待整合工作树");
        expect(toastMessages()).toContain("真实审查智能体二次审查通过");
    });

    it("请求合入 → 模态出现; 取消关闭 / 确认后关闭 + toast", () => {
        vi.useFakeTimers();
        renderWithI18n(<MissionCockpit />);
        driveToPassed();
        fireEvent.click(screen.getByTestId("merge-btn"));
        const modal = screen.getByTestId("merge-confirm-modal");
        expect(modal.textContent).toContain("最终合入确认");
        expect(screen.getByTestId("merge-confirm-action")).toBeTruthy();
        // 取消 → 关闭模态（closeMergeConfirm）
        fireEvent.click(screen.getByText("取消"));
        expect(screen.queryByTestId("merge-confirm-modal")).toBeNull();
        // 再次请求合入 → 确认 → 关闭 + toast
        fireEvent.click(screen.getByTestId("merge-btn"));
        fireEvent.click(screen.getByTestId("merge-confirm-action"));
        expect(screen.queryByTestId("merge-confirm-modal")).toBeNull();
        expect(toastMessages()).toContain("已记录用户合入确认");
    });

    it("draft 直接点开始任务 → toast 提示, 状态不推进", () => {
        vi.useFakeTimers();
        renderWithI18n(<MissionCockpit />);
        fireEvent.click(screen.getByTestId("mission-run"));
        expect(screen.getByTestId("mission-status").textContent).toBe("草稿");
        expect(toastMessages()).toContain("请先生成任务图");
        act(() => {
            vi.advanceTimersByTime(2200);
        });
        expect(screen.getByTestId("mission-status").textContent).toBe("草稿");
        expect(screen.queryByTestId("revision-btn")).toBeNull();
    });

    it("非 mock（无运行时）→ herdr.mission.empty 空态", () => {
        seedOffline();
        renderWithI18n(<MissionCockpit />);
        expect(screen.getByText("未连接 Herdr 运行时 — 任务编排不可用")).toBeTruthy();
        expect(screen.queryByTestId("mission-hero")).toBeNull();
        expect(screen.queryByTestId("mission-dag")).toBeNull();
    });
});
