// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { Message, ToolCall } from "../../stores/session-store";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  it("renders old tool call records without a name", () => {
    const message: Message = {
      id: "m1",
      role: "assistant",
      content: "done",
      timestamp: new Date(0),
      toolCalls: [
        {
          id: "tc1",
          status: "completed",
        } as ToolCall,
      ],
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("使用 1 个工具")).toBeTruthy();
  });

  it("renders safe custom message cards without executing extension JavaScript", () => {
    const message: Message = {
      id: "m2",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      customCard: {
        id: "card1",
        kind: "status-list",
        title: "扩展状态",
        content: "当前任务",
        items: [{ id: "i1", label: "检查 runtime", status: "completed" }],
        actions: [{ id: "a1", label: "复制", kind: "copy-text", value: "ok" }],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("扩展状态")).toBeTruthy();
    expect(screen.getByText("检查 runtime")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制" })).toBeTruthy();
  });

  it("shows custom card open-file action errors", async () => {
    const openPath = vi.fn().mockResolvedValue({
      code: "ipcErrors.protectedPath.blocked",
      fallback: "受保护路径不可打开",
    });
    Object.defineProperty(window, "piAPI", {
      value: { openPath },
      configurable: true,
    });
    const message: Message = {
      id: "m-open",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      customCard: {
        id: "card-open",
        kind: "file-actions",
        title: "文件操作",
        actions: [{ id: "open", label: "打开文件", kind: "open-file", value: "C:/Users/me/.ssh/id_rsa" }],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("受保护路径不可打开");
    });
    expect(openPath).toHaveBeenCalledWith("C:/Users/me/.ssh/id_rsa");
  });

  it("shows copy failures for assistant message content", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValueOnce(new Error("clipboard denied")) },
      configurable: true,
    });
    const message: Message = {
      id: "m-copy",
      role: "assistant",
      content: "copy me",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制内容" }));

    expect((await screen.findByRole("alert")).textContent).toContain("复制失败: clipboard denied");
    expect(screen.getByRole("button", { name: "复制内容" })).toBeTruthy();
  });

  it("folds inline think tags instead of rendering them as assistant content", () => {
    const message: Message = {
      id: "m-think",
      role: "assistant",
      content: "<think>先分析一下</think>\n\n最终回答",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("最终回答")).toBeTruthy();
    expect(screen.getByText(/思考 1 次/)).toBeTruthy();
    expect(screen.queryByText(/<think>/)).toBeNull();
    expect(screen.queryByText("先分析一下")).toBeNull();
  });

  it("copies only visible assistant content when inline thinking is present", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const message: Message = {
      id: "m-copy-think",
      role: "assistant",
      content: "<think>隐藏推理</think>可复制正文",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制内容" }));
    expect(writeText).toHaveBeenCalledWith("可复制正文");
  });

  it("hides the internal /plan command from user messages and shows a plan badge", () => {
    const message: Message = {
      id: "m-user-plan",
      role: "user",
      content: "/plan\n你好",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("你好")).toBeTruthy();
    expect(screen.getByText("计划模式")).toBeTruthy();
    expect(screen.queryByText(/\/plan/)).toBeNull();
  });

  it("hides the internal /execute_plan command from user messages", () => {
    const message: Message = {
      id: "m-user-execute-plan",
      role: "user",
      content: "/execute_plan docs/pi-agent-evaluation-plan.md",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("执行计划：docs/pi-agent-evaluation-plan.md")).toBeTruthy();
    expect(screen.getByText("执行计划")).toBeTruthy();
    expect(screen.queryByText(/\/execute_plan/)).toBeNull();
  });

  it("shows custom card open-file string failures from Electron shell", async () => {
    const openPath = vi.fn().mockResolvedValue("No application is associated with the specified file");
    Object.defineProperty(window, "piAPI", {
      value: { openPath },
      configurable: true,
    });
    const message: Message = {
      id: "m-open-string",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      customCard: {
        id: "card-open-string",
        kind: "file-actions",
        title: "文件操作",
        actions: [{ id: "open", label: "打开文件", kind: "open-file", value: "C:/repo/archive.unknown" }],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("No application is associated with the specified file");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not show per-message continue actions in normal message bubbles", () => {
    const message: Message = {
      id: "m-branch",
      role: "assistant",
      content: "checkpoint",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.queryByRole("button", { name: "从此消息继续" })).toBeNull();
    expect(screen.queryByText("继续")).toBeNull();
  });

  it("renders inline plan actions on assistant plan messages", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-plan",
      role: "assistant",
      content: "- 检查\n- 修改",
      timestamp: new Date(0),
      planAction: {
        id: "plan_action_1",
        title: "聊天输入区计划",
        filename: "chat-plan.md",
        status: "pending",
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "补充要求" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(message, "execute"));
  });

  it("renders pause action while a plan is executing", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-plan-executing",
      role: "assistant",
      content: "- 检查\n- 修改",
      timestamp: new Date(0),
      planAction: {
        id: "plan_action_2",
        title: "测试计划",
        filename: "test-plan.md",
        status: "executing",
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    expect(screen.getByText("执行中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "暂停执行" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(message, "pause"));
  });

  it("renders resume action after a plan is paused", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-plan-paused",
      role: "assistant",
      content: "- 检查\n- 修改",
      timestamp: new Date(0),
      planAction: {
        id: "plan_action_3",
        title: "测试计划",
        filename: "test-plan.md",
        status: "paused",
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    expect(screen.getByText("已暂停")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续执行" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(message, "resume"));
  });
});
