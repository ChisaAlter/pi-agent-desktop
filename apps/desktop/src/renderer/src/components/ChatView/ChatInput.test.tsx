// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";
import { usePlanStore } from "../../stores/plan-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { ChatInput } from "./ChatInput";

const { addToastSpy } = vi.hoisted(() => ({
  addToastSpy: vi.fn(),
}));

vi.mock("../../hooks/useMentions", () => ({
  useMentions: () => ({
    activeMention: null,
    candidates: [],
    highlightIndex: 0,
    setHighlightIndex: vi.fn(),
    selectCandidate: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("./PermissionRequestStack", () => ({
  PermissionRequestStack: () => null,
}));

vi.mock("../../stores/toast-store", () => ({
  addToast: addToastSpy,
}));

function openComposerMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "添加附件和工具" }));
}

function clickAddAttachment(): void {
  openComposerMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "添加文件或图片" }));
}

describe("ChatInput", () => {
  beforeEach(() => {
    addToastSpy.mockReset();
    Object.defineProperty(window, "piAPI", {
      value: {
        setSettings: vi.fn(async () => undefined),
        configSetDefaultModel: vi.fn(async () => ({ ok: true })),
        agentsSetThinking: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useAttachmentsStore.setState({ byWorkspace: new Map() });
    useAgentModeStore.setState({ byWorkspace: {} });
    usePlanStore.setState({
      enabled: false,
      activeCard: null,
      decisionRequest: null,
      steps: [],
      status: "idle",
    });
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws1", name: "repo", path: "C:/repo", createdAt: new Date(0), lastActiveAt: new Date(0) },
      ],
      currentWorkspaceId: "ws1",
    });
    useSettingsStore.setState({
      settings: {
        theme: "light",
        fontSize: 14,
        model: "",
        provider: "",
        temperature: 0.7,
        maxTokens: 4096,
        autoSave: true,
        showLineNumbers: true,
        wordWrap: true,
        permissionLevel: "smart",
        thinkingLevel: "medium",
      },
      piModels: null,
    });
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("keeps attachment and slash buttons before the mode selector in the reference composer", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const controls = screen.getByTestId("chat-input-reference-controls");
    expect([...controls.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual([
      "添加文件或图片",
      "打开 Slash 命令",
      "选择 Agent 模式",
      "当前模型: 未配置模型",
      "思考强度: 中",
      "发送",
    ]);
  });

  it("keeps the reference composer control row and send button vertically aligned", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const controls = screen.getByTestId("chat-input-reference-controls");
    const sendButton = within(controls).getByRole("button", { name: "发送" });
    expect(controls.className).toContain("items-center");
    expect(sendButton.className).not.toContain("mt-[-6px]");
    expect(sendButton.className).not.toContain("translate-x");
  });

  it("selects plan mode from the reference composer mode menu without enabling the old plan store", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择 Agent 模式" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Plan/ }));

    expect(useAgentModeStore.getState().getMode("ws1")).toBe("plan");
    expect(usePlanStore.getState().enabled).toBe(false);
  });

  it("does not steal focus back to the textarea after selecting an agent mode", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => undefined);

    try {
      fireEvent.click(screen.getByRole("button", { name: "选择 Agent 模式" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Plan/ }));

      expect(useAgentModeStore.getState().getMode("ws1")).toBe("plan");
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      rafSpy.mockRestore();
    }
  });

  it("does not render the non-build mode status chip inside the reference composer body", () => {
    useAgentModeStore.setState({ byWorkspace: { ws1: "max" } });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "选择 Agent 模式" }).textContent).toContain("Max");
    expect(screen.queryByLabelText("max 模式已启用")).toBeNull();
  });

  it("selects a model from the reference composer model menu", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        provider: "mimo",
        model: "mimo-v2.5-pro",
      },
      piModels: [
        {
          id: "mimo-v2.5-pro",
          name: "MiMo v2.5 Pro",
          description: "Pro model",
          provider: "mimo",
          providerName: "MiMo",
        },
        {
          id: "mimo-v2.5",
          name: "MiMo v2.5",
          description: "Base model",
          provider: "mimo",
          providerName: "MiMo",
        },
      ],
    }));

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "当前模型: mimo / mimo-v2.5-pro" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /MiMo v2.5$/ }));

    expect(useSettingsStore.getState().settings).toMatchObject({
      provider: "mimo",
      model: "mimo-v2.5",
    });
    await waitFor(() => {
      expect(window.piAPI.setSettings).toHaveBeenCalled();
    });
  });

  it("keeps the model menu open while scrolling through many models", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        provider: "provider_a",
        model: "model-0",
      },
      piModels: Array.from({ length: 12 }, (_, index) => ({
        id: `model-${index}`,
        name: `Model ${index}`,
        description: `Model ${index}`,
        provider: `provider_${index}`,
        providerName: `Provider ${index}`,
      })),
    }));

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "当前模型: provider_a / model-0" }));

    const menu = screen.getByRole("menu");
    fireEvent.scroll(menu);

    expect(screen.getByRole("menuitemradio", { name: "Model 11" })).toBeTruthy();
  });

  it("changes thinking strength from the reference composer and updates the active agent", async () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          agentId="agent-1"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "思考强度: 中" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /高/ }));

    expect(useSettingsStore.getState().settings.thinkingLevel).toBe("high");
    await waitFor(() => {
      expect(window.piAPI.agentsSetThinking).toHaveBeenCalledWith("agent-1", "high");
    });
  });

  it("lets the reference composer resize from the top handle", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const shell = screen.getByTestId("chat-input-shell");
    fireEvent.pointerDown(screen.getByRole("separator", { name: "调整输入框高度" }), {
      clientY: 400,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientY: 340, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect((shell as HTMLElement).style.height).toBe("155px");
  });

  it("keeps reference composer controls pinned to the bottom while resizing", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const shell = screen.getByTestId("chat-input-shell");
    fireEvent.pointerDown(screen.getByRole("separator", { name: "调整输入框高度" }), {
      clientY: 400,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect((shell as HTMLElement).style.height).toBe("195px");
    expect(shell.className).toContain("flex-col");
    expect(screen.getByTestId("chat-input-reference-body").className).toContain("flex-1");
    expect(screen.getByTestId("chat-input-reference-controls").className).toContain("shrink-0");
  });

  it("floats the running status above the reference composer without taking input layout space", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const runningStatus = screen.getByText(/任务运行中/).parentElement?.parentElement;

    expect(runningStatus?.className).toContain("absolute");
    expect(runningStatus?.className).toContain("bottom-full");
    expect(screen.getByTestId("chat-input-reference-body").className).toContain("flex-1");
    expect(screen.getByTestId("chat-input-reference-controls").className).toContain("shrink-0");
  });

  it("focuses the composer when the app requests a new chat focus", async () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    textbox.blur();
    window.dispatchEvent(new CustomEvent("chat-input:focus"));

    await waitFor(() => {
      expect(document.activeElement).toBe(textbox);
    });
  });

  it("shows attachment picker failures inline instead of window.alert", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    clickAddAttachment();

    expect(screen.getByRole("alert").textContent).toContain("文件选择不可用");
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("sends file attachments as Pi file references and clears them after send", async () => {
    const onSend = vi.fn(async () => undefined);
    Object.defineProperty(window, "piAPI", {
      value: {
        selectFiles: vi.fn(async () => ["C:/repo/src/app.ts"]),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    clickAddAttachment();
    await screen.findByText("app.ts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "检查这个文件" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith([
        "附加文件:",
        "@C:/repo/src/app.ts",
        "",
        "用户消息:",
        "检查这个文件",
      ].join("\n"));
    });
    await waitFor(() => {
      expect(useAttachmentsStore.getState().list("ws1")).toEqual([]);
    });
  });

  it("shows send failures without clearing the draft or attachments", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("network down");
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        selectFiles: vi.fn(async () => ["C:/repo/src/app.ts"]),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    clickAddAttachment();
    await screen.findByText("app.ts");
    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "检查这个文件" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect((await screen.findByRole("alert")).textContent).toContain("发送失败: network down");
    expect(textbox.value).toBe("检查这个文件");
    expect(useAttachmentsStore.getState().list("ws1")).toHaveLength(1);
  });

  it("does not submit the same draft multiple times while a send is pending", async () => {
    let resolveSend: (() => void) | undefined;
    const onSend = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
    );

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "开启计划模式后发送" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    resolveSend?.();
    await waitFor(() => expect((textbox as HTMLTextAreaElement).value).toBe(""));
  });

  it("shows files:select IPC errors inline", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        selectFiles: vi.fn(async () => ({
          code: "ipcErrors.files.selectFailed",
          fallback: "打开文件选择器失败: dialog unavailable",
        })),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    clickAddAttachment();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("打开文件选择器失败: dialog unavailable");
    expect(useAttachmentsStore.getState().list("ws1")).toEqual([]);
  });

  it("shows rejected file picker errors inline", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        selectFiles: vi.fn(async () => {
          throw new Error("dialog crashed");
        }),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    clickAddAttachment();

    expect((await screen.findByRole("alert")).textContent).toContain("打开文件选择器失败: dialog crashed");
  });

  it("shows workspace switch errors inline without changing current workspace", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: "ws1", name: "repo", path: "C:/repo", createdAt: new Date(0), lastActiveAt: new Date(0) },
        { id: "ws2", name: "other", path: "C:/other", createdAt: new Date(1), lastActiveAt: new Date(1) },
      ],
      currentWorkspaceId: "ws1",
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        selectWorkspace: vi.fn(async () => ({
          code: "ipcErrors.workspace.selectFailed",
          fallback: "切换 workspace 失败: not available",
        })),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("chat-input-workspace-trigger"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /other/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("切换 workspace 失败: not available");
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws1");
  });

  it("shows new workspace picker IPC errors inline", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        selectDirectory: vi.fn(async () => ({
          code: "ipcErrors.workspace.selectDirectoryFailed",
          fallback: "打开目录选择器失败: dialog unavailable",
        })),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("chat-input-workspace-trigger"));
    fireEvent.click(screen.getByRole("menuitem", { name: "选择新项目" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("打开目录选择器失败: dialog unavailable");
  });

  it("shows rejected new workspace picker errors inline", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        selectDirectory: vi.fn(async () => {
          throw new Error("dialog crashed");
        }),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId("chat-input-workspace-trigger"));
    fireEvent.click(screen.getByRole("menuitem", { name: "选择新项目" }));

    expect((await screen.findByRole("alert")).textContent).toContain("创建 workspace 失败: dialog crashed");
  });

  it("requires a configured vision model before sending image attachments", () => {
    const onSend = vi.fn(async () => undefined);
    useAttachmentsStore.getState().add("ws1", {
      id: "img1",
      kind: "image",
      name: "pasted.png",
      value: "data:image/png;base64,abc",
      mimeType: "image/png",
      size: 3,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "看图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("alert").textContent).toContain("请先在设置中选择识图模型");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("describes image attachments before injecting them into the main prompt", async () => {
    const onSend = vi.fn(async () => undefined);
    Object.defineProperty(window, "piAPI", {
      value: {
        describeImages: vi.fn(async () => ({
          text: "[图片 1: pasted.png]\n图片里有设置面板",
        })),
      },
      configurable: true,
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        visionProvider: "minimax",
        visionModel: "MiniMax-VL",
      },
    }));
    useAttachmentsStore.getState().add("ws1", {
      id: "img1",
      kind: "image",
      name: "pasted.png",
      value: "data:image/png;base64,abc",
      mimeType: "image/png",
      size: 3,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "看图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(window.piAPI.describeImages).toHaveBeenCalledWith([
        {
          name: "pasted.png",
          dataUrl: "data:image/png;base64,abc",
          mimeType: "image/png",
        },
      ]);
    });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith([
        "图片识别结果:",
        "[图片 1: pasted.png]",
        "图片里有设置面板",
        "",
        "用户消息:",
        "看图",
      ].join("\n"));
    });
  });

  it("allows sending a follow-up instruction while a task is running", async () => {
    const onSend = vi.fn(async () => undefined);
    const onStop = vi.fn();

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={onStop}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/任务运行中/).textContent).toContain("追加指令");
    const textbox = screen.getByRole("textbox");
    expect((textbox as HTMLTextAreaElement).disabled).toBe(false);

    fireEvent.change(textbox, { target: { value: "继续只提交 staged 文件" } });
    fireEvent.click(screen.getByRole("button", { name: "发送追加指令" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("继续只提交 staged 文件"));
    expect(onStop).not.toHaveBeenCalled();
  });

  it("appends external prefill text without replacing the current draft", async () => {
    const onPrefillConsumed = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          prefill="@C:/repo/src/app.ts "
          prefillKey={1}
          onPrefillConsumed={onPrefillConsumed}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textbox.value).toBe("@C:/repo/src/app.ts ");
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(textbox);
    });

    fireEvent.change(textbox, { target: { value: "请总结这个文件" } });
    rerender(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          prefill="@C:/repo/src/app.ts "
          prefillKey={2}
          onPrefillConsumed={onPrefillConsumed}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(textbox.value).toBe("请总结这个文件 @C:/repo/src/app.ts ");
    });

    rerender(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          prefill="@C:/repo/src/app.ts "
          prefillKey={3}
          onPrefillConsumed={onPrefillConsumed}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(textbox.value).toBe("请总结这个文件 @C:/repo/src/app.ts ");
    });
    expect(onPrefillConsumed).toHaveBeenCalledTimes(3);
  });

  it("keeps stop available as a separate action while running", () => {
    const onStop = vi.fn();

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={onStop}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows plan execution context and pause action while executing a plan", () => {
    const onStop = vi.fn();

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing
          runContext="plan_execution"
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={onStop}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/正在执行计划/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/正在执行计划/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "暂停执行" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows Pi slash command candidates and completes a selected command", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "model", description: "Select model", source: "builtin", desktopAction: "open-models" },
          { name: "settings", description: "Open settings", source: "builtin", desktopAction: "open-settings" },
        ]),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "/mo", selectionStart: 3 } });

    expect(await screen.findByRole("listbox", { name: "Pi 命令候选" })).toBeTruthy();
    fireEvent.keyDown(textbox, { key: "Tab" });

    await waitFor(() => {
      expect(textbox.value).toBe("/model");
    });
  });

  it("keeps the highlighted Pi slash command scrolled into view when using arrow keys", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "compact", description: "Manually compact the session context", source: "builtin", desktopAction: "compact" },
          { name: "settings", description: "Open settings", source: "builtin", desktopAction: "open-settings" },
          { name: "clone", description: "Duplicate the current session at the current position", source: "builtin", desktopAction: "unsupported" },
        ]),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "/", selectionStart: 1 } });
    const listbox = await screen.findByRole("listbox", { name: "Pi 命令候选" });
    const options = await screen.findAllByRole("option");

    expect(listbox.className).toContain("w-[min(520px,calc(100vw-48px))]");
    expect(options[0].className).toContain("h-9");

    fireEvent.keyDown(textbox, { key: "ArrowDown" });

    await waitFor(() => {
      expect(options[1].textContent).toContain("settings");
      expect(options[1].getAttribute("aria-selected")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });
  });

  it("runs mapped desktop slash commands without sending them as prompts", async () => {
    const onSend = vi.fn(async () => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "model", description: "Select model", source: "builtin", desktopAction: "open-models" },
        ]),
        runBuiltinSlashCommand: vi.fn(async () => ({
          handled: true,
          command: "model",
          action: "open-models",
          message: "已打开模型设置",
        })),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "/model" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => {
      expect(window.piAPI.runBuiltinSlashCommand).toHaveBeenCalledWith({
        workspaceId: "ws1",
        command: "model",
        args: "",
      });
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "slash-command:open-settings-tab" }));

    dispatchSpy.mockRestore();
  });

  it("shows an export success toast for builtin slash exports", async () => {
    const onSend = vi.fn(async () => undefined);
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "export", description: "Export session as HTML", source: "builtin", desktopAction: "export" },
        ]),
        runBuiltinSlashCommand: vi.fn(async () => ({
          handled: true,
          command: "export",
          action: "export",
          message: "已导出 HTML 到 C:/repo/exports/demo.html",
          tone: "success",
        })),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "/export" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => {
      expect(window.piAPI.runBuiltinSlashCommand).toHaveBeenCalledWith({
        workspaceId: "ws1",
        command: "export",
        args: "",
      });
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(addToastSpy).toHaveBeenCalledWith("已导出 HTML 到 C:/repo/exports/demo.html", "success");
  });

  it("does not send slash commands with attachments", async () => {
    const onSend = vi.fn(async () => undefined);
    useAttachmentsStore.getState().add("ws1", {
      id: "att1",
      kind: "file",
      name: "app.ts",
      value: "C:/repo/src/app.ts",
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "compact", description: "Compact", source: "builtin", desktopAction: "compact" },
        ]),
      },
      configurable: true,
    });

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/compact" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("alert").textContent).toContain("Slash 命令不能和附件一起发送");
    expect(onSend).not.toHaveBeenCalled();
    expect(useAttachmentsStore.getState().list("ws1")).toHaveLength(1);
  });
});
