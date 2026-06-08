/**
 * Pi Desktop 完整操作流程模拟 — 纯业务逻辑层集成测试
 * 模拟用户: 创建项目 → 配置中心 → 多Agent → 对话 → 重启 → 停止 → Codex导入
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, vi } from "vitest";
import type { PiModelsFile } from "@shared";
import { PendingEdits } from "../../main/services/approval/pending-edits";

// Mock SDK + Electron (same pattern as registry.test.ts)
vi.mock("../../main/services/pi-session/factory", () => ({
  createWorkspaceSession: vi.fn(async (opts: { workspaceId: string }) => ({
    workspaceId: opts.workspaceId,
    session: {
      prompt: vi.fn(async () => undefined),
      abort: vi.fn(),
      dispose: vi.fn(),
      subscribe: vi.fn(),
    },
    dispose: vi.fn(),
  })),
}));
vi.mock("../../main/services/approval/interceptor", () => ({
  createApprovalInterceptor: vi.fn(() => ({ handleEvent: vi.fn(async () => undefined) })),
}));
vi.mock("../../main/services/extensions/extension-ui-bridge", () => ({
  createExtensionUiBridge: vi.fn(() => ({})),
}));
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }));

import { ConfigManager } from "../../main/services/config/config-manager";
import { AgentRuntimeRegistry } from "../../main/services/agent-runtime/registry";
import { CodexSessionImporter } from "../../main/services/codex-session/importer";

describe("Pi Desktop 完整操作流程模拟", () => {
  it("配置中心 → 多Agent → 对话 → 重启 → 停止 → Codex导入 (12步)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "pi-demo-"));
    const configDir = join(tmpDir, ".pi", "agent");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });

    // 步骤 1-2: 项目 + 配置
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
    writeFileSync(join(tmpDir, "src/index.ts"), 'console.log("hello pi");');
    writeFileSync(join(configDir, "models.json"), JSON.stringify({
      providers: {
        openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [{ id: "gpt-4o", name: "GPT-4o" }] },
        local: { name: "Local", baseUrl: "http://localhost:11434/v1", models: [{ id: "llama3", name: "Llama 3" }] }
      }
    }));
    writeFileSync(join(configDir, "auth.json"), JSON.stringify({ openai: { apiKey: "sk-***" } }));
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", theme: "dark" }));

    // 步骤 3: ConfigManager — 读写、校验、baseUrl 保护
    const mgr = new ConfigManager(configDir);
    const models = await mgr.getModelsConfig();
    expect(models.parsed.providers).toBeDefined();
    expect(Object.keys(models.parsed.providers)).toHaveLength(2);

    expect((await mgr.getAuthConfig()).parsed).toHaveProperty("openai");
    expect((await mgr.getSettingsConfig()).parsed.defaultProvider).toBe("openai");
    expect((await mgr.saveModelsConfig({} as unknown as PiModelsFile)).valid).toBe(false);
    await expect(mgr.fetchModels("", "sk-test")).rejects.toThrow("缺少 baseUrl");

    // 步骤 4: 创建多 Agent
    const events: Array<{ channel: string }> = [];
    const registry = new AgentRuntimeRegistry({
      getWorkspace: (id: string) => id === "ws_demo" ? { id: "ws_demo", name: "Demo", path: tmpDir, createdAt: Date.now(), lastActiveAt: Date.now() } : undefined,
      pendingEdits: new PendingEdits(),
      send: (ch: string) => events.push({ channel: ch }),
    });

    const a1 = await registry.create({ workspaceId: "ws_demo", title: "前端开发 Agent" });
    expect(a1.status).toBe("idle");
    expect(a1.workspaceId).toBe("ws_demo");

    const a2 = await registry.create({ workspaceId: "ws_demo", title: "代码审查 Agent" });
    expect(registry.list()).toHaveLength(2);

    // 步骤 5: 发送消息
    await registry.prompt({ agentId: a1.id, message: "写一个 HTTP server" });
    const msgs = registry.getMessages(a1.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user", content: "写一个 HTTP server" });

    // 步骤 6: 切换 Agent — 检查状态
    expect(registry.getRuntimeState(a2.id).status).toBe("idle");

    // 步骤 7: 重启 Agent — 旧 ID 消失，新 ID 出现
    const restarted = await registry.restart(a1.id);
    expect(restarted.id).not.toBe(a1.id);
    expect(restarted.title).toBe("前端开发 Agent");
    expect(registry.list().some(a => a.id === a1.id)).toBe(false);
    expect(registry.list().some(a => a.id === restarted.id)).toBe(true);

    // 步骤 8: 停止 Agent — 只剩一个
    registry.stop(a2.id);
    expect(registry.list()).toHaveLength(1);

    // 步骤 9: 兼容层 findDefaultAgent
    const def = registry.findDefaultAgent("ws_demo");
    expect(def).toBeTruthy();
    expect(def!.workspaceId).toBe("ws_demo");

    // 步骤 10: 新 Agent 初始状态
    expect(registry.getRuntimeState(restarted.id).isStreaming).toBe(false);

    // 步骤 11: Codex 会话导入
    const codexDir = join(tmpDir, ".codex", "sessions", "default");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, "session.jsonl"), [
      JSON.stringify({ type: "session_meta", payload: { id: "cs1", cwd: tmpDir, timestamp: new Date().toISOString() } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user", text: "Hello" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "assistant", text: "Hi!" } }),
      "",
    ].join("\n"));

    const piRoot = join(tmpDir, ".pi", "agent", "sessions");
    const importer = new CodexSessionImporter({ codexRoot: join(tmpDir, ".codex", "sessions"), piRoot });
    const scanned = await importer.scan(tmpDir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].status).toBe("new");

    // 步骤 12: 清理 — disposeAll 清空
    registry.disposeAll();
    expect(registry.list()).toHaveLength(0);
    rmSync(tmpDir, { recursive: true, force: true });

    expect(events.length).toBeGreaterThan(0);
  }, 30000);
});
