// TaskProgressPanel 测试 (T4 右侧活动面板 - 加分项)
//
// 覆盖:
//  - 空状态: 渲染 "暂无任务"
//  - 1 个 task: 渲染任务名
//  - status 4 种状态都能渲染(icon 不崩)
//  - 有 progress 时显示进度条
//  - 点击触发 onTaskClick
//  - a11y: role=list / role=listitem / button
//
// 约定: 本组件不依赖 i18n,无需 I18nProvider 包裹。

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TaskProgressPanel, type TaskProgressItem } from "./TaskProgressPanel";

describe("TaskProgressPanel", () => {
    it("空状态: 显示 '暂无任务'", () => {
        render(<TaskProgressPanel tasks={[]} />);
        expect(screen.getByText("暂无任务")).toBeTruthy();
    });

    it("默认 props (无 tasks): 也走空状态", () => {
        render(<TaskProgressPanel />);
        expect(screen.getByText("暂无任务")).toBeTruthy();
    });

    it("至少一个 task: 渲染任务名", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "运行测试套件", status: "running" },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.getByText("运行测试套件")).toBeTruthy();
        // 标题始终在
        expect(screen.getByText("活动")).toBeTruthy();
    });

    it("a11y: 容器为 list,每条 item 为 listitem,条目本身是 button", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "alpha", status: "running" },
            { id: "t-2", name: "beta", status: "completed" },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.getByRole("list")).toBeTruthy();
        const items = screen.getAllByRole("listitem");
        expect(items).toHaveLength(2);
        // 两条都是 button
        const buttons = screen.getAllByRole("button");
        expect(buttons).toHaveLength(2);
    });

    it("4 种 status 都能渲染(icon 组件不抛)", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "待办", status: "pending" },
            { id: "t-2", name: "运行", status: "running" },
            { id: "t-3", name: "完成", status: "completed" },
            { id: "t-4", name: "失败", status: "failed" },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.getByText("待办")).toBeTruthy();
        expect(screen.getByText("运行")).toBeTruthy();
        expect(screen.getByText("完成")).toBeTruthy();
        expect(screen.getByText("失败")).toBeTruthy();
    });

    it("有 progress 时显示进度条 + aria-valuenow 正确", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "下载依赖", status: "running", progress: 42 },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        const bar = screen.getByRole("progressbar");
        expect(bar).toBeTruthy();
        expect(bar.getAttribute("aria-valuenow")).toBe("42");
        expect(bar.getAttribute("aria-valuemin")).toBe("0");
        expect(bar.getAttribute("aria-valuemax")).toBe("100");
    });

    it("无 progress 时不渲染 progressbar", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "已结束", status: "completed" },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.queryByRole("progressbar")).toBeNull();
    });

    it("点击 task 触发 onTaskClick 回调并传入 id", () => {
        const onTaskClick = vi.fn();
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "第一步", status: "running" },
            { id: "t-2", name: "第二步", status: "pending" },
        ];
        render(<TaskProgressPanel tasks={tasks} onTaskClick={onTaskClick} />);
        const buttons = screen.getAllByRole("button");
        fireEvent.click(buttons[1]);
        expect(onTaskClick).toHaveBeenCalledTimes(1);
        expect(onTaskClick).toHaveBeenCalledWith("t-2");
    });

    it("无 onTaskClick 时点击不抛错(展示态可用)", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "只读", status: "completed" },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        const btn = screen.getByRole("button");
        // 仅断言不抛
        expect(() => fireEvent.click(btn)).not.toThrow();
    });

    it("有 timestamp 时显示时间戳(11px 弱化)", () => {
        // 用一个固定时间戳,断言渲染出 HH:MM:SS 形式
        const ts = new Date(2025, 0, 15, 10, 30, 45).getTime();
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "有时间戳", status: "completed", timestamp: ts },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.getByText("10:30:45")).toBeTruthy();
    });

    it("无 timestamp 时不渲染时间戳 span", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "无时间戳", status: "pending" },
        ];
        const { container } = render(<TaskProgressPanel tasks={tasks} />);
        const tsEl = container.querySelector(
            '[data-mmcode-region="task-progress-timestamp"]'
        );
        expect(tsEl).toBeNull();
    });

    it("progress 越界会被 clamp 到 0-100", () => {
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "clamp 上", status: "running", progress: 250 },
            { id: "t-2", name: "clamp 下", status: "running", progress: -10 },
        ];
        render(<TaskProgressPanel tasks={tasks} />);
        const bars = screen.getAllByRole("progressbar");
        expect(bars[0].getAttribute("aria-valuenow")).toBe("100");
        expect(bars[1].getAttribute("aria-valuenow")).toBe("0");
    });

    it("cleanup: 每个 case 渲染后能正常清理(避免 cross-test 污染)", () => {
        // 配合 vitest globals=false / no automatic cleanup,显式 cleanup
        const tasks: TaskProgressItem[] = [
            { id: "t-1", name: "case-a", status: "pending" },
        ];
        const { unmount } = render(<TaskProgressPanel tasks={tasks} />);
        expect(screen.getByText("case-a")).toBeTruthy();
        unmount();
        cleanup();
    });
});
