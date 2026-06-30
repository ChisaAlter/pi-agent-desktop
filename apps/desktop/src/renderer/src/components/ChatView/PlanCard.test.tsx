// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { PlanCard } from "./PlanCard";

describe("PlanCard", () => {
  it("renders plan card with title, content, and status badge", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="测试计划"
          content="第一步：调研\n第二步：实现"
          status="pending"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("测试计划")).toBeTruthy();
    expect(screen.getByTestId("plan-status").textContent).toContain("等待确认");
    expect(screen.getByText(/第一步/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
  });

  it("renders steps list when steps provided", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="带步骤的计划"
          content="内容"
          status="pending"
          steps={[
            { id: "s1", text: "步骤一", status: "completed" },
            { id: "s2", text: "步骤二", status: "running" },
            { id: "s3", text: "步骤三", status: "pending" },
          ]}
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("计划步骤")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByText("步骤一")).toBeTruthy();
    expect(screen.getByText("步骤二")).toBeTruthy();
    expect(screen.getByText("步骤三")).toBeTruthy();
  });

  it("renders choice options when A/B/C detected in content", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="选择题计划"
          content={"A) 方案一\nB) 方案二\nC) 方案三"}
          status="pending"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    // 通过 data-testid 验证选项区存在
    expect(screen.getByTestId("plan-options")).toBeTruthy();
    const options = screen.getAllByTestId("plan-option");
    expect(options.length).toBe(3);
    // 主按钮因为未选所以 disabled
    const executeBtn = screen.getByRole("button", { name: "请选择选项" });
    expect((executeBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables execute after selecting an option", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="选择题计划"
          content={"A) 方案一\nB) 方案二"}
          status="pending"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    const options = screen.getAllByTestId("plan-option");
    fireEvent.click(options[0]);

    const executeBtn = screen.getByRole("button", { name: "确认并执行" });
    expect((executeBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not turn ordinary plan bullet steps into fake choice options", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="探针计划"
          content={"- 创建 `plan_probe.txt`\n- 验证文件存在\n\n请执行上述步骤。"}
          status="pending"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId("plan-options")).toBeNull();
    expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
  });

  it("calls onRefine with selected option when execute clicked after selection", () => {
    const onRefine = vi.fn();
    render(
      <I18nProvider>
        <PlanCard
          title="选择题计划"
          content={"A) 方案一\nB) 方案二"}
          status="pending"
          onRefine={onRefine}
        />
      </I18nProvider>,
    );

    const options = screen.getAllByTestId("plan-option");
    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole("button", { name: "确认并执行" }));

    expect(onRefine).toHaveBeenCalledWith("方案一");
  });

  it("renders executing state with progress", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="执行中计划"
          content="内容"
          status="executing"
          steps={[
            { id: "s1", text: "步骤一", status: "completed" },
            { id: "s2", text: "步骤二", status: "running" },
          ]}
          onPause={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("plan-status").textContent).toContain("执行中");
    expect(screen.getByRole("button", { name: "暂停执行" })).toBeTruthy();
    expect(screen.getByText("进度 1/2")).toBeTruthy();
  });

  it("calls onPause when pause button clicked", () => {
    const onPause = vi.fn();
    render(
      <I18nProvider>
        <PlanCard
          title="执行中"
          content="内容"
          status="executing"
          onPause={onPause}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "暂停执行" }));
    expect(onPause).toHaveBeenCalled();
  });

  it("renders paused state with resume and cancel", () => {
    const onResume = vi.fn();
    const onCancel = vi.fn();
    render(
      <I18nProvider>
        <PlanCard
          title="已暂停"
          content="内容"
          status="paused"
          onResume={onResume}
          onCancel={onCancel}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("plan-status").textContent).toContain("已暂停");
    fireEvent.click(screen.getByRole("button", { name: "继续执行" }));
    expect(onResume).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders completed state without action buttons", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="已完成"
          content="内容"
          status="executed"
          steps={[
            { id: "s1", text: "步骤一", status: "completed" },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("plan-status").textContent).toContain("已完成");
    expect(screen.getByText("计划已执行完毕")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "执行计划" })).toBeNull();
  });

  it("renders failed state", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="失败计划"
          content="内容"
          status="failed"
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("plan-status").textContent).toContain("执行失败");
    expect(screen.getByText("计划执行失败")).toBeTruthy();
  });

  it("shows filename pill when filename provided", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="有文件的计划"
          content="内容"
          status="pending"
          filename=".pi/plans/test.md"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("test.md")).toBeTruthy();
  });

  it("calls onRefine with input text when 发送补充 clicked", () => {
    const onRefine = vi.fn();
    render(
      <I18nProvider>
        <PlanCard
          title="计划"
          content="内容"
          status="pending"
          onRefine={onRefine}
        />
      </I18nProvider>,
    );

    const input = screen.getByPlaceholderText("有补充就写在这里");
    fireEvent.change(input, { target: { value: "我要补充一点" } });
    fireEvent.click(screen.getByRole("button", { name: "发送补充" }));

    expect(onRefine).toHaveBeenCalledWith("我要补充一点");
  });

  it("expands content when 展开计划详情 clicked", () => {
    render(
      <I18nProvider>
        <PlanCard
          title="长计划"
          content={"行1\n行2\n行3\n行4\n行5"}
          status="pending"
          onExecute={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/行1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /展开计划详情/ }));
    expect(screen.getByText(/行5/)).toBeTruthy();
  });
});
