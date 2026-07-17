import { describe, expect, it, vi } from "vitest";
import generatedUiExtension from "./index";

describe("generated ui extension", () => {
  it("registers render_ui, emits upsert events, and strengthens explicit UI prompts", async () => {
    const sendMessage = vi.fn();
    let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
    let beforeAgentStart: ((event: { prompt: string; systemPrompt: string }) => Promise<{ systemPrompt: string }>) | undefined;
    const commands = new Map<string, { handler: (args?: string) => Promise<void> }>();
    const pi = {
      registerTool: vi.fn((value) => { tool = value; }),
      registerCommand: vi.fn((name, value) => commands.set(name, value)),
      sendMessage,
      on: vi.fn((name, handler) => { if (name === "before_agent_start") beforeAgentStart = handler; }),
    };

    generatedUiExtension(pi as never);
    expect(tool).toBeTruthy();
    expect(commands.has("ui")).toBe(true);

    await tool?.execute("call-1", {
      card: {
        version: "v2",
        id: "result",
        title: "结果",
        sections: [{ id: "summary", kind: "markdown", content: "完成" }],
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      customType: "generated-ui",
      details: expect.objectContaining({ operation: "upsert", card: expect.objectContaining({ id: "result" }) }),
    }), { triggerTurn: false });

    const promptResult = await beforeAgentStart?.({ prompt: "请用图表展示", systemPrompt: "base" });
    expect(promptResult?.systemPrompt).toContain("MUST call render_ui");

    sendMessage.mockClear();
    await commands.get("ui")?.handler("");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ card: expect.objectContaining({ id: "generated-ui-overview", version: "v2" }) }),
    }), { triggerTurn: false });
  });
});
