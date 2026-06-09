// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanCardView } from "./PlanCard";
import { usePlanStore } from "../../stores/plan-store";

describe("PlanCardView", () => {
  const planRespond = vi.fn();
  const planSetEnabled = vi.fn(async () => undefined);

  beforeEach(() => {
    planRespond.mockClear();
    planSetEnabled.mockClear();
    Object.defineProperty(window, "piAPI", {
      value: {
        planRespond,
        planSetEnabled,
      },
      configurable: true,
    });
    usePlanStore.setState({
      enabled: true,
      activeCard: null,
      decisionRequest: null,
      steps: [],
      status: "idle",
    });
  });

  it("renders extension plan questions and responds with selected option", () => {
    usePlanStore.getState().setDecisionRequest({
      requestId: "plan_q_1",
      workspaceId: "ws1",
      kind: "select",
      source: "plan",
      title: "选择计划",
      message: "下一步怎么做？",
      options: ["执行", "修改"],
      createdAt: 1,
    });

    render(<PlanCardView workspaceId="ws1" />);

    expect(screen.getByText("选择计划")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改" }));

    expect(planRespond).toHaveBeenCalledWith("plan_q_1", "refine", "修改");
    expect(usePlanStore.getState().decisionRequest).toBeNull();
  });

  it("submits local plan goal clarification through onExecute", async () => {
    const onExecute = vi.fn(async () => undefined);
    usePlanStore.getState().setDecisionRequest({
      requestId: "local_plan_goal_1",
      workspaceId: "ws1",
      source: "plan",
      title: "计划模式需要目标",
      message: "请补充计划目标",
      placeholder: "写下计划目标",
      createdAt: 1,
    });

    render(<PlanCardView workspaceId="ws1" onExecute={onExecute} />);

    fireEvent.change(screen.getByPlaceholderText("写下计划目标"), {
      target: { value: "为聊天输入框制定改版计划" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送补充" }));

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("为聊天输入框制定改版计划");
    });
    expect(planRespond).not.toHaveBeenCalled();
    expect(usePlanStore.getState().decisionRequest).toBeNull();
  });

  it("executes active plan through /execute_plan", async () => {
    const onExecute = vi.fn(async () => undefined);
    usePlanStore.getState().setCard({
      id: "card_1",
      title: "实现 UI",
      filename: "ui-plan.md",
      content: "- 调整布局",
      createdAt: 1,
    });
    usePlanStore.getState().setDecisionRequest({
      requestId: "decision_1",
      card: usePlanStore.getState().activeCard ?? undefined,
    });

    render(<PlanCardView workspaceId="ws1" onExecute={onExecute} />);
    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("/execute_plan ui-plan.md");
    });
  });

  it("keeps extension plan questions visible when a plan card is already active", () => {
    usePlanStore.getState().setCard({
      id: "card_2",
      title: "实现权限",
      filename: "permission-plan.md",
      content: "- 接入权限插件",
      createdAt: 1,
    });
    usePlanStore.getState().setDecisionRequest({
      requestId: "plan_q_2",
      workspaceId: "ws1",
      kind: "select",
      source: "plan",
      title: "需要补充吗？",
      options: ["继续", "补充"],
      createdAt: 2,
    });

    render(<PlanCardView workspaceId="ws1" />);

    expect(screen.getByText("实现权限")).toBeTruthy();
    expect(screen.getByText("需要补充吗？")).toBeTruthy();
    expect(screen.queryByText("要执行这个计划吗？")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "补充" }));

    expect(planRespond).toHaveBeenCalledWith("plan_q_2", "refine", "补充");
  });

  it("does not render raw think tags from plan content", () => {
    usePlanStore.getState().setCard({
      id: "card_think",
      title: "清理计划",
      filename: "clean-plan.md",
      content: "<think>内部推理</think>\n\n- 修复计划模式",
      createdAt: 1,
    });

    render(<PlanCardView workspaceId="ws1" />);

    expect(screen.getByText("修复计划模式")).toBeTruthy();
    expect(screen.queryByText(/<think>/)).toBeNull();
    expect(screen.queryByText("内部推理")).toBeNull();
  });

  it("does not show an execute confirmation for generic plan-mode guidance", () => {
    usePlanStore.getState().setCard({
      id: "card_guidance",
      title: "计划模式说明",
      filename: "guidance.md",
      content: [
        "你可以让我：",
        "- 阅读、编辑、重构、调试代码",
        "- 分解需求、制定执行计划",
        "",
        "**目标**：要解决什么问题或实现什么功能？",
        "**范围**：涉及哪些文件或模块？",
        "**约束**：时间、性能、兼容性、依赖等",
        "**验收标准**：怎样算完成？",
        "直接描述项目背景即可。",
      ].join("\n"),
      createdAt: 1,
    });

    render(<PlanCardView workspaceId="ws1" />);

    expect(screen.queryByText("要执行这个计划吗？")).toBeNull();
    expect(usePlanStore.getState().activeCard).toBeNull();
  });
});
