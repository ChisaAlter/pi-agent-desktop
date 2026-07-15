// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Message, ToolCall } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        showThinking: true,
        thinkingLevel: "medium",
      },
    });
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

  it("renders generated ui cards with structured sections and whitelist actions", () => {
    const message: Message = {
      id: "m-generated",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      generatedUi: {
        version: "v1",
        id: "ui-1",
        title: "运行摘要",
        sections: [
          { id: "summary", kind: "summary", content: "任务已完成" },
          {
            id: "status",
            kind: "status_list",
            items: [{ id: "item-1", label: "生成报告", status: "completed", description: "写入 docs/report.md" }],
          },
          {
            id: "facts",
            kind: "key_value",
            items: [{ id: "kv-1", key: "耗时", value: "12s" }],
          },
          {
            id: "files",
            kind: "file_list",
            items: [{ id: "file-1", label: "report.md", path: "docs/report.md" }],
          },
          {
            id: "actions",
            kind: "action_bar",
            actions: [{ id: "copy", label: "复制摘要", kind: "copy-text", value: "任务已完成" }],
          },
        ],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("运行摘要")).toBeTruthy();
    expect(screen.getByText("任务已完成")).toBeTruthy();
    expect(screen.getByText("生成报告")).toBeTruthy();
    expect(screen.getByText("写入 docs/report.md")).toBeTruthy();
    expect(screen.getByText("耗时")).toBeTruthy();
    expect(screen.getByText("12s")).toBeTruthy();
    expect(screen.getByText("report.md")).toBeTruthy();
    expect(screen.getByText("docs/report.md")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制摘要" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制内容" })).toBeTruthy();
  });

  it("copies generated ui text even when assistant message content is empty", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const message: Message = {
      id: "m-generated-copy",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      generatedUi: {
        version: "v1",
        id: "ui-copy",
        title: "运行摘要",
        sections: [
          { id: "summary", kind: "summary", content: "任务已完成" },
          {
            id: "files",
            kind: "file_list",
            items: [{ id: "file-1", label: "report.md", path: "docs/report.md" }],
          },
        ],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制内容" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("运行摘要\n任务已完成\nreport.md - docs/report.md");
    });
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

  it("expands collapsed assistant thinking when requested", () => {
    const message: Message = {
      id: "m-expand-think",
      role: "assistant",
      content: "最终回答",
      thinking: "可展开的思考内容",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    const toggle = screen.getByRole("button", { name: /展开思考/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.closest('[data-motion="thinking-shell"]')?.className).toContain("pi-motion-thinking-shell");
    expect(screen.queryByText("可展开的思考内容")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("可展开的思考内容")).toBeTruthy();
    expect(screen.getByText("可展开的思考内容").closest('[data-motion="thinking-content"]')?.className).toContain("pi-motion-thinking-content");
  });

  it("hides assistant thinking when thinking display is disabled", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        showThinking: false,
      },
    });
    const message: Message = {
      id: "m-hidden-think",
      role: "assistant",
      content: "<think>不要展示</think>最终回答",
      thinking: "也不要展示",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByText("最终回答")).toBeTruthy();
    expect(screen.queryByText(/思考/)).toBeNull();
    expect(screen.queryByText("不要展示")).toBeNull();
    expect(screen.queryByText("也不要展示")).toBeNull();
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

  it("centers assistant messages inside a narrower reading column", () => {
    const message: Message = {
      id: "m-centered",
      role: "assistant",
      content: "更适合阅读的窄气泡",
      timestamp: new Date(0),
    };

    const { container } = render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    const article = container.querySelector("article");
    expect(article?.className).toContain("justify-center");
    expect(article?.className).toContain("pi-motion-message-enter");
    expect(article?.getAttribute("data-motion")).toBe("message-enter");
    expect(article?.firstElementChild?.className).toContain("max-w-[42rem]");
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
    expect(screen.getByTestId("plan-execution-user-state")).toBeTruthy();
    expect(screen.getByTestId("message-surface").className).toContain("bg-[var(--mm-bg-control)]");
    expect(screen.getByTestId("message-surface").className).not.toContain("bg-[var(--mm-bg-sidebar)]");
    expect(screen.queryByText(/\/execute_plan/)).toBeNull();
  });

  it("renders persisted visible execute-plan user summaries as execution state", () => {
    const message: Message = {
      id: "m-visible-execute-plan",
      role: "user",
      content: "执行计划：comprehensive-project-review.md",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("plan-execution-user-state")).toBeTruthy();
    expect(screen.getByText("执行计划：comprehensive-project-review.md")).toBeTruthy();
    expect(screen.getByTestId("message-surface").className).toContain("bg-[var(--mm-bg-control)]");
  });

  it("keeps normal user message vertical padding balanced while keeping the assistant surface transparent", () => {
    const userMessage: Message = {
      id: "m-user-padding",
      role: "user",
      content: "普通用户消息",
      timestamp: new Date(0),
    };
    const assistantMessage: Message = {
      id: "m-assistant-transparent",
      role: "assistant",
      content: "**普通助手回复**",
      timestamp: new Date(0),
    };

    const { rerender } = render(
      <I18nProvider>
        <MessageBubble message={userMessage} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("message-surface").className).toContain("py-2");
    expect(screen.getByTestId("message-surface").className).not.toContain("py-3");
    expect(screen.getByTestId("message-surface").className).toContain("bg-[var(--mm-bg-sidebar)]");
    expect(screen.queryByTestId("message-footer")).toBeNull();

    rerender(
      <I18nProvider>
        <MessageBubble message={assistantMessage} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("message-surface").className).not.toContain("bg-[var(--mm-bg-panel)]");
    expect(screen.getByTestId("message-surface").className).not.toContain("border-[var(--mm-border)]");
    expect(screen.getByText("普通助手回复").tagName).toBe("STRONG");
    expect(screen.getByTestId("message-footer")).toBeTruthy();

    rerender(
      <I18nProvider>
        <MessageBubble message={assistantMessage} isStreaming />
      </I18nProvider>,
    );

    expect(screen.getByText("**普通助手回复**").tagName).toBe("DIV");
    expect(screen.queryByText("普通助手回复")).toBeNull();
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
    expect(screen.getByRole("button", { name: "发送补充" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(message, "execute"));
  });

  it("passes selected plan option through confirm-and-execute", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-plan-choice",
      role: "assistant",
      content: "A) 按计划执行：只修改 src/discount.js\nB) 重新规划：增加更多验证",
      timestamp: new Date(0),
      planAction: {
        id: "plan_action_choice",
        title: "折扣修复计划",
        filename: "discount-plan.md",
        status: "pending",
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /选项 A\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并执行" }));

    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(
      message,
      "execute",
      "按计划执行：只修改 src/discount.js",
    ));
  });

  it("passes supplement text through refine action", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-plan-refine",
      role: "assistant",
      content: "- 检查\n- 修改",
      timestamp: new Date(0),
      planAction: {
        id: "plan_action_refine",
        title: "补充计划",
        filename: "refine-plan.md",
        status: "pending",
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("有补充就写在这里"), {
      target: { value: "先运行 npm test 再修改" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送补充" }));

    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(
      message,
      "refine",
      "先运行 npm test 再修改",
    ));
  });

  it("infers an executable inline plan action from plan-like assistant markdown", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-inline-plan",
      role: "assistant",
      content: "## 计划\n- 创建 `plan_probe.txt`\n- 验证文件存在\n\n请执行上述步骤。",
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m-inline-plan",
        planAction: expect.objectContaining({
          id: "inline_plan_m-inline-plan",
          title: "计划",
          status: "pending",
        }),
      }),
      "execute",
    ));
  });

  it("infers an executable inline plan action from table-style execution plans", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-inline-table-plan",
      role: "assistant",
      content: [
        "## 执行计划",
        "| 步骤 | 操作 | 说明 |",
        "| --- | --- | --- |",
        "| 1 | 创建 `plan_probe.txt` | 内容为 `PLAN_OK` |",
        "| 2 | 验证文件存在 | 读取文件确认 `PLAN_OK` |",
        "",
        "等待您的指令后开始执行。",
      ].join("\n"),
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m-inline-table-plan",
        planAction: expect.objectContaining({
          id: "inline_plan_m-inline-table-plan",
          title: "执行计划",
          status: "pending",
        }),
      }),
      "execute",
    ));
  });

  it("infers an executable inline plan action from generated-ui-only plan cards", async () => {
    const onPlanAction = vi.fn(async () => undefined);
    const message: Message = {
      id: "m-inline-generated-plan",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      generatedUi: {
        version: "v1",
        id: "generated-plan",
        title: "内联计划",
        sections: [
          { id: "summary", kind: "summary", content: "等待您的指令后开始执行。" },
          {
            id: "steps",
            kind: "steps",
            items: [
              { id: "step-1", label: "创建 plan_probe.txt" },
              { id: "step-2", label: "验证文件存在" },
            ],
          },
        ],
      },
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={onPlanAction} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    await waitFor(() => expect(onPlanAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "m-inline-generated-plan",
        planAction: expect.objectContaining({
          id: "inline_plan_m-inline-generated-plan",
          title: "内联计划",
          status: "pending",
        }),
      }),
      "execute",
    ));
  });

  it("does not infer a second executable plan card from execute-plan summary text", () => {
    const message: Message = {
      id: "m-plan-summary",
      role: "assistant",
      content: [
        "计划已定义，等待执行：",
        "",
        "**2026-06-26-create-plan-probe**（chore, draft）",
        "",
        "1. 创建 `plan_probe.txt`，内容为 `PLAN_OK`",
        "2. 验证文件存在",
        "",
        "使用 `/execute_plan` 执行，或 `/plan` 退出计划模式。",
      ].join("\n"),
      timestamp: new Date(0),
    };

    render(
      <I18nProvider>
        <MessageBubble message={message} onPlanAction={vi.fn(async () => undefined)} />
      </I18nProvider>,
    );

    expect(screen.queryByRole("button", { name: "执行计划" })).toBeNull();
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
