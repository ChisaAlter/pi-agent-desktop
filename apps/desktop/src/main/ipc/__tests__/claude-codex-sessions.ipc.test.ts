import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock("electron-log/main", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { setupClaudeSessionsIpc } from "../claude-sessions.ipc";
import { setupCodexSessionsIpc } from "../codex-sessions.ipc";

describe("claude/codex session importer IPC wrappers", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("wires claude scan/import through the importer", async () => {
    const importer = {
      scan: vi.fn(async (p: string) => ({ scanned: p })),
      import: vi.fn(async (p: string, sources: string[]) => ({ p, sources })),
    };
    setupClaudeSessionsIpc(importer as never);

    await expect(handlers.get("claude-sessions:scan")!({}, "C:/ws")).resolves.toEqual({
      scanned: "C:/ws",
    });
    await expect(
      handlers.get("claude-sessions:import")!({}, "C:/ws", ["a.jsonl"]),
    ).resolves.toEqual({ p: "C:/ws", sources: ["a.jsonl"] });
  });

  it("wires codex scan/import through the importer", async () => {
    const importer = {
      scan: vi.fn(async (p: string) => ({ scanned: p, kind: "codex" })),
      import: vi.fn(async (p: string, sources: string[]) => ({ p, sources, kind: "codex" })),
    };
    setupCodexSessionsIpc(importer as never);

    await expect(handlers.get("codex-sessions:scan")!({}, "D:/repo")).resolves.toEqual({
      scanned: "D:/repo",
      kind: "codex",
    });
    await expect(
      handlers.get("codex-sessions:import")!({}, "D:/repo", ["b.jsonl"]),
    ).resolves.toEqual({ p: "D:/repo", sources: ["b.jsonl"], kind: "codex" });
  });

  it("returns structured errors for an empty Claude workspacePath", async () => {
    const importer = { scan: vi.fn(), import: vi.fn() };
    setupClaudeSessionsIpc(importer as never);
    const scanResult = await handlers.get("claude-sessions:scan")!({}, "");
    const importResult = await handlers.get("claude-sessions:import")!({}, "", ["a.jsonl"]);
    expect(isIpcError(scanResult)).toBe(true);
    expect(isIpcError(importResult)).toBe(true);
    expect(importer.scan).not.toHaveBeenCalled();
    expect(importer.import).not.toHaveBeenCalled();
  });

  it("returns structured errors for invalid Codex source path arrays", async () => {
    const importer = { scan: vi.fn(), import: vi.fn() };
    setupCodexSessionsIpc(importer as never);
    const emptyPathResult = await handlers.get("codex-sessions:import")!({}, "D:/repo", [""]);
    const tooMany = Array.from({ length: 101 }, (_, i) => `s${i}.jsonl`);
    const oversizedResult = await handlers.get("codex-sessions:import")!({}, "D:/repo", tooMany);
    expect(isIpcError(emptyPathResult)).toBe(true);
    expect(isIpcError(oversizedResult)).toBe(true);
    expect(importer.import).not.toHaveBeenCalled();
  });

  it("propagates importer scan failures without wrapping", async () => {
    const importer = {
      scan: vi.fn(async () => {
        throw new Error("scan io failed");
      }),
      import: vi.fn(),
    };
    setupClaudeSessionsIpc(importer as never);
    await expect(handlers.get("claude-sessions:scan")!({}, "C:/ws")).rejects.toThrow("scan io failed");
  });
});
