// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";
import { usePlanStore } from "../../stores/plan-store";
import { useRuntimeFeatureStore } from "../../stores/runtime-feature-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAgentStore } from "../../stores/agent-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { ChatInput } from "./ChatInput";

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

function openComposerMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "添加附件和工具" }));
}

function clickAddAttachment(): void {
  openComposerMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "添加文件或图片" }));
}

/** onSend mock that resolves deferred vision transport the way ChatView does. */
function createOnSendMock(
  impl?: (
    message: string,
    options?: {
      visibleContent?: string;
      resolveTransport?: () => Promise<string>;
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      imageDataUrls?: Array<{ name: string; dataUrl: string; mimeType?: string }>;
    },
  ) => Promise<void>,
) {
  return vi.fn(async (
    message: string,
    options?: {
      visibleContent?: string;
      resolveTransport?: () => Promise<string>;
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      imageDataUrls?: Array<{ name: string; dataUrl: string; mimeType?: string }>;
    },
  ) => {
    if (impl) {
      await impl(message, options);
      return;
    }
    if (options?.resolveTransport) {
      await options.resolveTransport();
    }
  });
}

describe("ChatInput", () => {
  beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
      value: {
        setSettings: vi.fn(async () => undefined),
        configSetDefaultModel: vi.fn(async () => ({ ok: true })),
        agentsSetThinking: vi.fn(async (agentId: string, level: string) => ({
          agentId,
          status: "idle",
          isStreaming: false,
          thinkingLevel: level,
        })),
        agentsSetMode: vi.fn(async (agentId: string, mode: string) => ({
          agentId,
          status: "idle",
          isStreaming: false,
          mode,
        })),
        agentsResolveActive: vi.fn(async () => ({ id: "agent-resolved" })),
        permissionSetMode: vi.fn(async () => undefined),
        openSettingsWindow: vi.fn(async () => undefined),
      },
      configurable: true,
    });
    useAttachmentsStore.setState({ byWorkspace: {} });
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
        model: "mimo-v2.5",
        provider: "mimo",
        temperature: 0.7,
        maxTokens: 4096,
        autoSave: true,
        showLineNumbers: true,
        wordWrap: true,
        schemaVersion: 1,
        permissionLevel: "smart",
        thinkingLevel: "medium",
      },
      piModels: [
        {
          id: "mimo-v2.5",
          name: "MiMo v2.5",
          description: "Default test model",
          provider: "mimo",
          providerName: "MiMo",
        },
      ],
    });
    useAgentStore.setState({ runtimeByAgent: {} });
    useRuntimeFeatureStore.setState({
      featureState: {
        primaryAgents: [],
        systemAgents: [],
        enabledToolIds: ["task", "memory"],
        features: {
          planMode: { enabled: true, supported: true, loadedFrom: "pi-openplan" },
          composeMode: { enabled: true, supported: true, loadedFrom: "desktop" },
          maxMode: { enabled: true, supported: true, loadedFrom: "desktop", candidates: 5 },
          memory: {
            enabled: true,
            supported: true,
            loadedFrom: "desktop",
            ccIndex: false,
            reconcileOnSearch: true,
            searchScoreFloor: 0.15,
          },
          history: { enabled: true, supported: true, loadedFrom: "desktop" },
          checkpoint: { enabled: true, supported: true, loadedFrom: "desktop" },
          goal: { enabled: true, supported: true, loadedFrom: "desktop" },
          task: { enabled: true, supported: true, loadedFrom: "desktop" },
          actor: { enabled: true, supported: true, loadedFrom: "desktop" },
          subagents: { enabled: true, supported: true, loadedFrom: "desktop" },
          workflow: {
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
            maxConcurrentAgents: 4,
            maxLifecycleAgents: 100,
            maxDepth: 4,
          },
          dream: { enabled: false, supported: false, loadedFrom: "unsupported" },
          distill: { enabled: false, supported: false, loadedFrom: "unsupported" },
        },
      },
      loading: false,
      lastError: null,
      lastLoadedAt: Date.now(),
    });
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("keeps attachment and slash buttons before the mode selector in the reference composer", () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, provider: "", model: "" },
      piModels: null,
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

    const controls = screen.getByTestId("chat-input-reference-controls");
    expect([...controls.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual([
      "添加文件或图片",
      "打开 Slash 命令",
      "选择 Agent 模式",
      "权限: 智能授权",
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
    expect(controls.className).toContain("pi-composer-selector-row");
    expect(controls.className).toContain("shrink-0");
    expect(sendButton.className).not.toContain("mt-[-6px]");
    expect(sendButton.className).not.toContain("translate-x");
  });

  it("blocks ordinary sends and links to model settings when no valid model is configured", () => {
    const onSend = vi.fn(async () => undefined);
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, provider: "stale", model: "missing-model" },
      piModels: [],
    }));

    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={onSend}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textbox.disabled).toBe(false);
    textbox.focus();
    expect(document.activeElement).toBe(textbox);
    expect(textbox.placeholder).toBe("请先配置模型后再开始对话");
    expect(screen.getByText("尚未配置可用模型")).toBeTruthy();

    fireEvent.change(textbox, { target: { value: "这条消息不能发出" } });
    const sendButton = within(screen.getByTestId("chat-input-reference-controls"))
      .getByRole("button", { name: "发送" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "去配置" }));
    expect(window.piAPI.openSettingsWindow).toHaveBeenCalledWith("model");
  });

  it("allows a configured model while the model list is still loading", async () => {
    const onSend = vi.fn(async () => undefined);
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, provider: "mimo", model: "mimo-v2.5" },
      piModels: null,
    }));

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
    fireEvent.change(textbox, { target: { value: "send while models load" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("\u5c1a\u672a\u914d\u7f6e\u53ef\u7528\u6a21\u578b")).toBeNull();
  });

  it("blocks Enter sends without a valid model while processing but keeps stop available", () => {
    const onSend = vi.fn(async () => undefined);
    const onStop = vi.fn();
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, provider: "stale", model: "missing-model" },
      piModels: [],
    }));

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

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "must not bypass the model gate" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "\u505c\u6b62\u751f\u6210" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("selects plan mode from the reference composer mode menu without enabling the old plan store", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "选择 Agent 模式" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Plan/ }));

    expect(useAgentModeStore.getState().getMode("ws1")).toBe("plan");
    expect(usePlanStore.getState().enabled).toBe(false);
    await waitFor(() => {
      expect(window.piAPI.agentsSetMode).toHaveBeenCalledWith("agent-1", "plan");
    });
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
    useAgentModeStore.setState({ byWorkspace: { ws1: "compose" } });

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

    expect(screen.getByRole("button", { name: "选择 Agent 模式" }).textContent).toContain("Compose");
    expect(screen.queryByLabelText("compose 模式已启用")).toBeNull();
  });

  it("keeps reference composer labels vertically centered without dropdown chevrons", () => {
    useAgentModeStore.setState({ byWorkspace: { ws1: "compose" } });

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

    const agentModeButton = screen.getByRole("button", { name: "选择 Agent 模式" });
    const permissionButton = screen.getByRole("button", { name: "权限: 智能授权" });
    const modelButton = screen.getByRole("button", { name: /当前模型:/ });
    const thinkingButton = screen.getByRole("button", { name: /思考强度:/ });

    expect(agentModeButton.querySelector("svg")).toBeNull();
    expect(agentModeButton.className).toContain("text-[11px]");
    expect(agentModeButton.className).toContain("leading-4");
    expect(agentModeButton.className).not.toContain("overflow-hidden");
    expect(permissionButton.querySelectorAll("svg")).toHaveLength(1);
    expect(permissionButton.className).toContain("text-[11px]");
    expect(permissionButton.className).toContain("leading-4");
    expect(permissionButton.className).not.toContain("overflow-hidden");
    expect(permissionButton.querySelector(".pi-composer-label-full")).toBeTruthy();
    expect(permissionButton.querySelector(".pi-composer-label-ellipsis")).toBeNull();
    expect(modelButton.className).toContain("pi-composer-model-btn");
    const modelLabel = modelButton.querySelector(".pi-composer-label-ellipsis");
    expect(modelLabel).toBeTruthy();
    expect(modelLabel?.className).toContain("pi-composer-label");
    expect(modelButton.textContent).not.toMatch(/•|●/);
    expect(thinkingButton.className).toContain("pi-composer-thinking-btn");
    expect(thinkingButton.querySelector(".pi-composer-label-full")).toBeTruthy();
    expect(thinkingButton.querySelector("svg")).toBeNull();
    // 布局槽位与胶囊结构
    const capsule = screen.getByTestId("chat-input-model-thinking-capsule");
    expect(capsule.className).toContain("pi-composer-model-capsule");
    expect(screen.getByTestId("chat-input-model-slot").className).toContain("pi-composer-model-slot");
    expect(screen.getByTestId("chat-input-thinking-slot").className).toContain("pi-composer-thinking-slot");
    // residual a11y: composer triggers keep keyboard focus ring (wave-84)
    for (const btn of [agentModeButton, permissionButton, modelButton, thinkingButton]) {
      expect(btn.className).toContain("focus-visible:ring-2");
      expect(btn.className).toContain("focus-visible:ring-[#2563eb]");
    }
  });

  it("uses production ellipsis path for long model names without hard clipping classes", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        provider: "openai",
        model: "gpt-5.6-solo-very-long-name",
      },
      piModels: [
        {
          id: "gpt-5.6-solo-very-long-name",
          name: "gpt-5.6-solo-very-long-name-that-must-ellipsis",
          description: "Long model",
          provider: "openai",
          providerName: "OpenAI",
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

    const modelButton = screen.getByTestId("chat-input-model-trigger");
    const modelLabel = modelButton.querySelector(".pi-composer-label-ellipsis");
    const modelSlot = screen.getByTestId("chat-input-model-slot");
    const thinkingSlot = screen.getByTestId("chat-input-thinking-slot");
    const capsule = screen.getByTestId("chat-input-model-thinking-capsule");
    const permissionButton = screen.getByTestId("chat-input-permission-trigger");
    const modelPopoverRoot = modelButton.closest("[data-pi-popover-root]");

    // 模型：完整字符串仍在 DOM（title/text），视觉省略靠专用 CSS 类
    expect(modelButton.getAttribute("title")).toBe("gpt-5.6-solo-very-long-name-that-must-ellipsis");
    expect(modelLabel?.textContent).toBe("gpt-5.6-solo-very-long-name-that-must-ellipsis");
    expect(modelLabel?.className).toContain("pi-composer-label-ellipsis");
    // 布局链：slot 承载宽度，Popover 单节点填满 slot，label 才 ellipsis
    expect(capsule.className).toContain("pi-composer-model-capsule");
    expect(modelSlot.className).toContain("pi-composer-model-slot");
    expect(thinkingSlot.className).toContain("pi-composer-thinking-slot");
    expect(modelPopoverRoot).not.toBeNull();
    expect(modelPopoverRoot?.parentElement).toBe(modelSlot);
    expect(modelButton.parentElement).toBe(modelPopoverRoot);
    // 权限文案完整
    expect(permissionButton.textContent).toContain("智能授权");
    expect(permissionButton.querySelector(".pi-composer-label-full")).toBeTruthy();
    expect(permissionButton.querySelector(".pi-composer-label-ellipsis")).toBeNull();
  });

  it("keeps permission label fully visible after mode changes", () => {
    useAgentModeStore.setState({ byWorkspace: { ws1: "compose" } });

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

    const permissionButton = screen.getByRole("button", { name: "权限: 智能授权" });
    expect(permissionButton.textContent).toContain("智能授权");
    expect(permissionButton.querySelector(".pi-composer-label-full")).toBeTruthy();
    expect(permissionButton.querySelector(".pi-composer-label-ellipsis")).toBeNull();
  });

  it("unifies the four reference composer popover surfaces and omits leading dots", () => {
    vi.useFakeTimers();
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        provider: "mimo",
        model: "mimo-v2.5",
      },
      piModels: [
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

    const openers = [
      screen.getByRole("button", { name: "选择 Agent 模式" }),
      screen.getByRole("button", { name: "权限: 智能授权" }),
      screen.getByRole("button", { name: "当前模型: MiMo v2.5" }),
      screen.getByRole("button", { name: "思考强度: 中" }),
    ];

    try {
      for (const opener of openers) {
        fireEvent.click(opener);
        const menus = screen.getAllByRole("menu");
        const menu = menus[menus.length - 1];
        expect(menu.className).toContain("w-[220px]");
        expect(menu.className).toContain("rounded-[10px]");
        expect(menu.className).toContain("p-1.5");
        expect(menu.querySelectorAll(".rounded-full").length).toBe(0);
        fireEvent.keyDown(document, { key: "Escape" });
        act(() => {
          vi.advanceTimersByTime(120);
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps focus-visible rings on default-layout plus/workspace triggers and menu items", () => {
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

    const plus = screen.getByTestId("chat-input-plus-trigger");
    const workspace = screen.getByTestId("chat-input-workspace-trigger");
    expect(plus.className).toContain("focus-visible:ring-2");
    expect(plus.className).toContain("focus-visible:ring-inset");
    expect(workspace.className).toContain("focus-visible:ring-2");
    expect(workspace.className).toContain("focus-visible:ring-[#2563eb]");

    fireEvent.click(plus);
    const addFile = screen.getByRole("menuitem", { name: "添加文件或图片" });
    const openTools = screen.getByRole("menuitem", { name: "打开工具面板" });
    expect(addFile.className).toContain("focus-visible:ring-2");
    expect(openTools.className).toContain("focus-visible:ring-2");
  });

  it("allows changing permission mode from the reference composer", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "权限: 智能授权" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "始终授权" }));

    expect(useSettingsStore.getState().settings.workspacePermissionModes?.ws1).toBe("always");
    await waitFor(() => {
      expect(window.piAPI.permissionSetMode).toHaveBeenCalledWith("always", "ws1");
    });
  });

  it("clamps persisted unsupported modes back to build and hides unavailable runtime modes", () => {
    useAgentModeStore.setState({ byWorkspace: { ws1: "plan" } });
    useRuntimeFeatureStore.setState({
      featureState: {
        primaryAgents: [],
        systemAgents: [],
        enabledToolIds: [],
        features: {
          planMode: { enabled: false, supported: true, loadedFrom: "disabled" },
          composeMode: { enabled: true, supported: true, loadedFrom: "desktop" },
          maxMode: { enabled: false, supported: true, loadedFrom: "disabled", candidates: 5 },
          memory: {
            enabled: true,
            supported: true,
            loadedFrom: "desktop",
            ccIndex: false,
            reconcileOnSearch: true,
            searchScoreFloor: 0.15,
          },
          history: { enabled: true, supported: true, loadedFrom: "desktop" },
          checkpoint: { enabled: true, supported: true, loadedFrom: "desktop" },
          goal: { enabled: true, supported: true, loadedFrom: "desktop" },
          task: { enabled: true, supported: true, loadedFrom: "desktop" },
          actor: { enabled: true, supported: true, loadedFrom: "desktop" },
          subagents: { enabled: true, supported: true, loadedFrom: "desktop" },
          workflow: {
            enabled: false,
            supported: false,
            loadedFrom: "unsupported",
            maxConcurrentAgents: 4,
            maxLifecycleAgents: 100,
            maxDepth: 4,
          },
          dream: { enabled: false, supported: false, loadedFrom: "unsupported" },
          distill: { enabled: false, supported: false, loadedFrom: "unsupported" },
        },
      },
      loading: false,
      lastError: null,
      lastLoadedAt: Date.now(),
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
          referenceFrame
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "选择 Agent 模式" }).textContent).toContain("Build");

    fireEvent.click(screen.getByRole("button", { name: "选择 Agent 模式" }));
    expect(screen.queryByRole("menuitemradio", { name: /Plan/ })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: /Compose/ })).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: /Max/ })).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "当前模型: MiMo v2.5 Pro" }));
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

    // settings provider "provider_a" 与 model-0 的 provider_0 不一致时回退到 id 文案
    fireEvent.click(screen.getByRole("button", { name: "当前模型: provider_a/model-0" }));

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
    // Prefer data-thinking-level so "高" is not confused with "最高".
    fireEvent.click(document.querySelector('[data-thinking-level="high"]')!);

    await waitFor(() => {
      expect(window.piAPI.agentsSetThinking).toHaveBeenCalledWith("agent-1", "high");
      expect(useSettingsStore.getState().settings.thinkingLevel).toBe("high");
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

  it("keeps the reference composer shell opaque so chat content cannot show through", () => {
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

    const shellClassName = screen.getByTestId("chat-input-shell").className;
    // reference 模式必须实底: 对话内容不能从输入区透出
    expect(shellClassName).toContain("bg-[var(--mm-bg-input)]");
    expect(shellClassName).not.toContain("bg-transparent");
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

  it("keeps a long pasted draft inside the fixed reference composer", () => {
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

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") } });

    expect(screen.getByTestId("chat-input-shell").className).toContain("min-h-0");
    expect(screen.getByTestId("chat-input-reference-body").className).not.toContain("overflow-hidden");
    expect(textbox.className).toContain("flex-1");
    expect(textbox.className).toContain("overflow-y-auto");
    expect((textbox as HTMLTextAreaElement).style.height).toBe("");
  });

  it("renders the inline running status strip above the reference composer", () => {
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

    const runningStatus = screen.getByText(/任务运行中 ·/).parentElement?.parentElement;
    expect(runningStatus?.className).toContain("absolute");
    expect(runningStatus?.className).toContain("bottom-full");
    expect(runningStatus?.className).toContain("pi-motion-running-strip");
    expect(runningStatus?.getAttribute("data-motion")).toBe("running-strip");
    expect(screen.getByTestId("chat-input-reference-body").className).toContain("flex-1");
    expect(screen.getByTestId("chat-input-reference-controls").className).toContain("shrink-0");
  });

  it("turns the reference composer send button into an active stop button while processing", () => {
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
          referenceFrame
        />
      </I18nProvider>,
    );

    const stopButton = screen
      .getAllByRole("button", { name: "停止生成" })
      .find((button) => !button.className.includes("hidden"));
    if (!stopButton) {
      throw new Error("Expected a visible stop button in the reference composer");
    }
    expect(stopButton.getAttribute("disabled")).toBeNull();
    expect(stopButton.className).toContain("w-[32px]");

    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
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
      expect(onSend).toHaveBeenCalledWith(
        [
          "附加文件:",
          "@C:/repo/src/app.ts",
          "",
          "用户消息:",
          "检查这个文件",
        ].join("\n"),
        { visibleContent: "检查这个文件\n附件: app.ts" },
      );
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

  it("clears the draft immediately after submit is accepted, even while the send promise is still pending", async () => {
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

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "发送后立刻清空" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("发送后立刻清空");
    expect(textbox.value).toBe("");

    resolveSend?.();
  });

  it("restores the cleared draft and attachments when the pending submit later rejects", async () => {
    let rejectSend: ((error: Error) => void) | undefined;
    const onSend = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectSend = reject;
      }),
    );
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
    fireEvent.change(textbox, { target: { value: "失败后恢复草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(textbox.value).toBe("");
    expect(useAttachmentsStore.getState().list("ws1")).toEqual([]);

    rejectSend?.(new Error("late submit failure"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("发送失败: late submit failure");
    });
    expect(textbox.value).toBe("失败后恢复草稿");
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

  it("does not submit blank or whitespace-only messages (D-002)", () => {
    const onSend = vi.fn(async () => undefined);
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

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(textbox, { target: { value: "   \n\t  " } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps multi-line drafts intact and only submits non-empty trimmed text (D-002)", async () => {
    const onSend = vi.fn(async () => undefined);
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

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    const multiline = "line-one\nline-two\nline-three";
    fireEvent.change(textbox, { target: { value: multiline } });
    expect(textbox.value).toContain("\n");
    fireEvent.keyDown(textbox, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(multiline);
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

  it("describes images with the current conversation model when no vision model is configured", async () => {
    let resolvedTransport: string | undefined;
    const onSend = createOnSendMock(async (message, options) => {
      expect(message).toBe("看图");
      expect(options?.visibleContent).toBe("看图\n图片: pasted.png");
      expect(options?.images).toBeUndefined();
      resolvedTransport = options?.resolveTransport ? await options.resolveTransport() : message;
    });
    const describeImages = vi.fn(async () => ({
      text: "[图片 1: pasted.png]\n图片里有聊天窗口",
    }));
    Object.defineProperty(window, "piAPI", {
      value: {
        ...(window.piAPI ?? {}),
        describeImages,
      },
      configurable: true,
    });
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
      expect(describeImages).toHaveBeenCalledWith([
        {
          name: "pasted.png",
          dataUrl: "data:image/png;base64,abc",
          mimeType: "image/png",
        },
      ]);
    });
    await waitFor(() => {
      expect(resolvedTransport).toBe([
        "图片识别结果:",
        "[图片 1: pasted.png]",
        "图片里有聊天窗口",
        "",
        "用户消息:",
        "看图",
      ].join("\n"));
    });
  });

  it("direct-sends native images when the conversation model supports vision", async () => {
    const onSend = createOnSendMock();
    const describeImages = vi.fn(async () => ({ text: "should not run" }));
    Object.defineProperty(window, "piAPI", {
      value: {
        ...(window.piAPI ?? {}),
        describeImages,
      },
      configurable: true,
    });
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, model: "vision-model", provider: "mimo" },
      piModels: [
        {
          id: "vision-model",
          name: "Vision Model",
          description: "supports images",
          provider: "mimo",
          providerName: "MiMo",
          input: ["text", "image"],
        },
      ],
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
      expect(onSend).toHaveBeenCalledWith(
        "看图",
        expect.objectContaining({
          visibleContent: "看图\n图片: pasted.png",
          images: [{ type: "image", data: "abc", mimeType: "image/png" }],
        }),
      );
    });
    expect(describeImages).not.toHaveBeenCalled();
  });

  it("stages send immediately: clears composer, shows describing status, and only then finishes transport", async () => {
    let resolveDescribe: ((value: { text: string }) => void) | undefined;
    const describeImages = vi.fn(
      () => new Promise<{ text: string }>((resolve) => {
        resolveDescribe = resolve;
      }),
    );
    const onSend = createOnSendMock();
    Object.defineProperty(window, "piAPI", {
      value: {
        ...(window.piAPI ?? {}),
        describeImages,
      },
      configurable: true,
    });
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

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "看图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    // onSend is invoked immediately so ChatView can stage the user bubble before vision returns.
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(textbox.value).toBe("");
    expect(useAttachmentsStore.getState().list("ws1")).toEqual([]);
    expect(screen.getByTestId("chat-input-describing-images").textContent).toContain("正在识别图片");
    expect(screen.getByRole("button", { name: "识图中" })).toBeTruthy();
    expect(describeImages).toHaveBeenCalled();

    resolveDescribe?.({ text: "[图片 1: pasted.png]\n图里有设置面板" });
    await waitFor(() => {
      expect(screen.queryByTestId("chat-input-describing-images")).toBeNull();
    });
  });

  it("restores draft and attachments when vision fails after the composer was cleared", async () => {
    const onSend = createOnSendMock();
    Object.defineProperty(window, "piAPI", {
      value: {
        ...(window.piAPI ?? {}),
        describeImages: vi.fn(async () => ({
          code: "ipcErrors.config.visionFailed",
          fallback: "识图失败: HTTP 400 - model does not support images",
          params: {},
        })),
      },
      configurable: true,
    });
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

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "看图" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("HTTP 400 - model does not support images");
    });
    expect(textbox.value).toBe("看图");
    expect(useAttachmentsStore.getState().list("ws1")).toHaveLength(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("surfaces the real ipc error instead of a misleading TypeError when describeImages fails", async () => {
    const onSend = createOnSendMock();
    Object.defineProperty(window, "piAPI", {
      value: {
        ...(window.piAPI ?? {}),
        describeImages: vi.fn(async () => ({
          code: "ipcErrors.config.visionFailed",
          fallback: "识图失败: HTTP 400 - model does not support images",
          params: {},
        })),
      },
      configurable: true,
    });
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
      expect(screen.getByRole("alert").textContent).toContain("HTTP 400 - model does not support images");
    });
    expect(screen.getByRole("alert").textContent).not.toContain("Cannot read properties of undefined");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("shows an error when the vision service is unavailable", () => {
    const onSend = createOnSendMock();
    // beforeEach 的 piAPI mock 不注入 describeImages → 视作 preload 未暴露该能力
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

    expect(screen.getByRole("alert").textContent).toContain("识图服务不可用");
    // Preflight rejects before onSend so the parent never stages a bubble.
    expect(onSend).not.toHaveBeenCalled();
  });

  it("describes image attachments before injecting them into the main prompt", async () => {
    let resolvedTransport: string | undefined;
    const onSend = createOnSendMock(async (message, options) => {
      expect(message).toBe("看图");
      resolvedTransport = options?.resolveTransport ? await options.resolveTransport() : message;
    });
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
      expect(resolvedTransport).toBe([
        "图片识别结果:",
        "[图片 1: pasted.png]",
        "图片里有设置面板",
        "",
        "用户消息:",
        "看图",
      ].join("\n"));
    });
    expect(onSend).toHaveBeenCalledWith(
      "看图",
      expect.objectContaining({ visibleContent: "看图\n图片: pasted.png" }),
    );
  });

  it("turns the primary action into stop instead of sending a follow-up instruction while a task is running", () => {
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

    const textbox = screen.getByRole("textbox");
    expect((textbox as HTMLTextAreaElement).disabled).toBe(false);
    expect((textbox as HTMLTextAreaElement).placeholder).toContain("任务运行中");

    fireEvent.change(textbox, { target: { value: "继续只提交 staged 文件" } });
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
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

    expect(screen.getByPlaceholderText(/正在执行计划/)).toBeTruthy();
    expect(screen.getByText(/正在执行计划 ·/)).toBeTruthy();
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
          { name: "changelog", description: "Show changelog entries", source: "builtin", desktopAction: "unsupported" },
          { name: "clone", description: "Duplicate the current session at the current position", source: "builtin", desktopAction: "unsupported" },
          { name: "compact", description: "Manually compact the session context", source: "builtin", desktopAction: "compact" },
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
      expect(options[1].getAttribute("aria-selected")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });
  });

  it("runs mapped desktop slash commands without sending them as prompts", async () => {
    const onSend = vi.fn(async () => undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, provider: "", model: "" },
      piModels: null,
    }));
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

  it("exposes reference composer toolbar focus-visible rings for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn()}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "添加文件或图片" }).className).toContain(
      "focus-visible:ring-2",
    );
    expect(screen.getByRole("button", { name: "打开 Slash 命令" }).className).toContain(
      "focus-visible:ring-2",
    );
  });

  it("exposes primary send focus-visible rings for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );
    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    expect(sendButtons.some((btn) => btn.className.includes("focus-visible:ring-2"))).toBe(true);
  });

  it("exposes reference primary send focus-visible rings for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn()}
          onStop={vi.fn()}
          referenceFrame
        />
      </I18nProvider>,
    );
    const sendButtons = screen.getAllByRole("button", { name: "发送" });
    expect(sendButtons.some((btn) => btn.className.includes("focus-visible:ring-2"))).toBe(true);
  });

  it("exposes composer trigger focus-visible rings for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId("chat-input-permission-trigger").className).toContain(
      "focus-visible:ring-2",
    );
    expect(screen.getByTestId("chat-input-plus-trigger").className).toContain(
      "focus-visible:ring-2",
    );
    expect(screen.getByTestId("chat-input-workspace-trigger").className).toContain(
      "focus-visible:ring-2",
    );
  });

  // ===== 固定高度布局契约 (Composer 溢出修复) =====

  function renderReference(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
    return render(
      <I18nProvider>
        <ChatInput
          isConnected
          isProcessing={false}
          workspaceId="ws1"
          workspacePath="C:/repo"
          onSend={vi.fn(async () => undefined)}
          onStop={vi.fn()}
          referenceFrame
          {...overrides}
        />
      </I18nProvider>,
    );
  }

  it("renders the attachment rail above the reference shell with horizontal scrolling", () => {
    renderReference();
    act(() => {
      useAttachmentsStore.getState().add("ws1", {
        id: "att_1",
        kind: "file",
        name: "a".repeat(80) + ".md",
        value: "C:/repo/" + "b".repeat(80) + ".md",
      });
      useAttachmentsStore.getState().add("ws1", {
        id: "att_2",
        kind: "file",
        name: "second-file.ts",
        value: "C:/repo/second-file.ts",
      });
    });

    // 附件条在 shell 之外 (不再挤压输入区), 横向滚动而非纵向
    const list = screen.getByRole("list", { name: "已选附件" });
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("overflow-y-auto");
    expect(list.className).not.toContain("min-h-0");
    const shell = screen.getByTestId("chat-input-shell");
    expect(shell.contains(list)).toBe(false);
    // 长文件名保持现有 ellipsis 契约, 不横向撑开
    const chipNames = within(list).getAllByText(
      (_, el) => typeof el?.className === "string" && el.className.includes("max-w-[160px]"),
    );
    expect(chipNames.length).toBe(2);
    for (const chipName of chipNames) {
      expect(chipName.className).toContain("truncate");
    }
  });

  it("renders the attachment rail above the auto-height composer", () => {
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
    act(() => {
      useAttachmentsStore.getState().add("ws1", { id: "att_1", kind: "file", name: "a.ts", value: "C:/repo/a.ts" });
    });

    const list = screen.getByRole("list", { name: "已选附件" });
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("min-h-0");
    expect(list.className).not.toContain("overflow-y-auto");
    const shell = screen.getByTestId("chat-input-shell");
    expect(shell.contains(list)).toBe(false);
  });

  it("constrains reference attachment/send errors with break-all and scroll bounds", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("network down");
    });
    Object.defineProperty(window, "piAPI", {
      value: {
        selectFiles: vi.fn(async () => ({
          code: "ipcErrors.files.selectFailed",
          fallback: "打开文件选择器失败: dialog unavailable",
        })),
      },
      configurable: true,
    });
    renderReference({ onSend });

    // attachmentError: 文件选择失败
    fireEvent.click(screen.getByRole("button", { name: "添加文件或图片" }));
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    });
    const wrapper = screen.getAllByRole("alert")[0].parentElement as HTMLElement;
    expect(wrapper.className).toContain("min-h-0");
    expect(wrapper.className).toContain("shrink");
    expect(wrapper.className).toContain("overflow-y-auto");
    expect(screen.getAllByRole("alert")[0].className).toContain("break-all");
    expect(screen.getAllByRole("alert")[0].className).toContain("whitespace-pre-wrap");
    fireEvent.click(screen.getByRole("button", { name: "添加文件或图片" }).parentElement as HTMLElement); // 关闭附件菜单

    // sendError: 发送失败 (输入会清 attachmentError, 所以先发送再触发 attachmentError)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    const sendButton = screen
      .getAllByRole("button", { name: "发送" })
      .find((button) => !button.className.includes("hidden"));
    if (!sendButton) {
      throw new Error("Expected a visible send button in the reference composer");
    }
    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(screen.getByText(/发送失败: network down/)).toBeTruthy();
    });

    // 再触发 attachmentError: 不改变 inputValue, sendError 保留 → 两个 alert 并存
    fireEvent.click(screen.getByRole("button", { name: "添加文件或图片" }));
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBe(2);
    });
    const alerts = screen.getAllByRole("alert");
    for (const alert of alerts) {
      expect(alert.className).toContain("break-all");
      expect(alert.className).toContain("whitespace-pre-wrap");
      expect((alert.parentElement as HTMLElement).className).toContain("min-h-0");
      expect((alert.parentElement as HTMLElement).className).toContain("overflow-y-auto");
    }
  });

  it("keeps default composer errors unconstrained (auto-height behavior unchanged)", async () => {
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

    const alert = await screen.findByRole("alert");
    expect(alert.className).not.toContain("break-all");
    expect((alert.parentElement as HTMLElement).className).not.toContain("overflow-y-auto");
  });

  it("constrains the reference model-required note as a scrollable region", () => {
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
        schemaVersion: 1,
        permissionLevel: "smart",
        thinkingLevel: "medium",
      },
      piModels: [],
    });
    renderReference();

    const note = screen.getByText("尚未配置可用模型").parentElement as HTMLElement;
    expect(note.className).toContain("min-h-0");
    expect(note.className).toContain("shrink");
    expect(note.className).toContain("overflow-y-auto");
  });

  it("cleans up the global composer height variable on unmount", () => {
    const { unmount } = renderReference();
    // 挂载后 commitComposerHeight(95) → 95 + 8
    expect(document.documentElement.style.getPropertyValue("--pi-global-composer-height")).toBe("103px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--pi-global-composer-height")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--pi-global-composer-left")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--pi-global-composer-right")).toBe("");
  });

  it("leaves no inline textarea height after a reference send succeeds", async () => {
    const onSend = vi.fn(async () => undefined);
    renderReference({ onSend });

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") } });
    const sendButton = screen
      .getAllByRole("button", { name: "发送" })
      .find((button) => !button.className.includes("hidden"));
    if (!sendButton) {
      throw new Error("Expected a visible send button in the reference composer");
    }
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(textbox.value).toBe("");
    expect(textbox.style.height).toBe("");
  });

  it("leaves no inline textarea height after a reference send failure restores the draft", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("boom");
    });
    renderReference({ onSend });

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "draft text" } });
    const sendButton = screen
      .getAllByRole("button", { name: "发送" })
      .find((button) => !button.className.includes("hidden"));
    if (!sendButton) {
      throw new Error("Expected a visible send button in the reference composer");
    }
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText(/发送失败: boom/)).toBeTruthy();
    });
    expect(textbox.value).toBe("draft text");
    expect(textbox.style.height).toBe("");
  });

});
