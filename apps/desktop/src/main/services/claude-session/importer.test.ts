import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeSessionImporter } from "./importer";

function projectDirName(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  const win = normalized.match(/^([A-Za-z]):\/(.+)$/);
  if (win) return `${win[1]}--${win[2].replace(/\//g, "-")}`;
  return normalized.replace(/^\//, "").replace(/\//g, "-");
}

describe("ClaudeSessionImporter", () => {
  let claudeRoot: string;
  let piRoot: string;
  let projectPath: string;
  let importer: ClaudeSessionImporter;
  let projectDir: string;

  beforeEach(async () => {
    claudeRoot = await mkdtemp(join(tmpdir(), "claude-projects-"));
    piRoot = await mkdtemp(join(tmpdir(), "pi-sessions-"));
    projectPath = "C:/demo/project";
    projectDir = join(claudeRoot, projectDirName(projectPath));
    await mkdir(projectDir, { recursive: true });
    importer = new ClaudeSessionImporter({ claudeRoot, piRoot });
  });

  it("scans only claude sessions under the encoded project directory", async () => {
    await writeFile(
      join(projectDir, "match.jsonl"),
      [
        JSON.stringify({
          type: "user",
          sessionId: "s1",
          cwd: projectPath,
          timestamp: "2026-06-01T00:00:00.000Z",
          message: { content: "hello" },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-01T00:00:01.000Z",
          message: {
            model: "claude-sonnet-4",
            content: [{ type: "text", text: "hi" }],
            stop_reason: "end_turn",
          },
        }),
      ].join("\n"),
      "utf8",
    );
    // unrelated project folder
    const otherDir = join(claudeRoot, "C--other");
    await mkdir(otherDir, { recursive: true });
    await writeFile(
      join(otherDir, "other.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId: "s2",
        cwd: "C:/other",
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { content: "x" },
      }),
      "utf8",
    );

    const sessions = await importer.scan(projectPath);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "s1",
      status: "new",
      messageCount: 2,
    });
  });

  it("imports claude jsonl into pi session format with metadata", async () => {
    const source = join(projectDir, "match.jsonl");
    await writeFile(
      source,
      [
        JSON.stringify({
          type: "user",
          sessionId: "s1",
          cwd: projectPath,
          timestamp: "2026-06-01T00:00:00.000Z",
          message: { content: "hello from user" },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-01T00:00:01.000Z",
          message: {
            model: "claude-sonnet-4",
            content: [
              { type: "thinking", thinking: "plan" },
              { type: "text", text: "assistant reply" },
              { type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } },
            ],
            stop_reason: "tool_use",
          },
        }),
        JSON.stringify({
          type: "tool_result",
          tool_use_id: "t1",
          content: "file contents",
          timestamp: "2026-06-01T00:00:02.000Z",
        }),
      ].join("\n"),
      "utf8",
    );

    const report = await importer.import(projectPath, [source]);
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(0);
    const target = report.results[0].targetPath;
    expect(target).toBeTruthy();
    const raw = await readFile(target!, "utf8");
    expect(raw).toContain('"type":"claude_import"');
    expect(raw).toContain('"role":"user"');
    expect(raw).toContain('"role":"assistant"');
    expect(raw).toContain('"role":"toolResult"');
    expect(raw).toContain('"type":"toolCall"');
    expect(raw).toContain("hello from user");
  });

  it("rejects source paths outside the claude projects root", async () => {
    const siblingRoot = `${claudeRoot}-sibling`;
    await mkdir(siblingRoot, { recursive: true });
    const source = join(siblingRoot, "outside.jsonl");
    await writeFile(
      source,
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        cwd: projectPath,
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { content: "x" },
      }),
      "utf8",
    );

    const report = await importer.import(projectPath, [source]);
    expect(report.imported).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain("outside ~/.claude/projects");
  });

  it("tolerates corrupt JSONL without throwing", async () => {
    const corrupt = join(projectDir, "corrupt.jsonl");
    await writeFile(corrupt, "not-json\n{\n", "utf8");
    const good = join(projectDir, "good.jsonl");
    await writeFile(
      good,
      JSON.stringify({
        type: "user",
        sessionId: "good-1",
        cwd: projectPath,
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { content: "ok" },
      }),
      "utf8",
    );

    const sessions = await importer.scan(projectPath);
    expect(sessions.some((s) => s.id === "good-1")).toBe(true);

    const report = await importer.import(projectPath, [corrupt, good]);
    expect(report.results).toHaveLength(2);
    expect(report.results.find((r) => r.sourcePath === good)?.success).toBe(true);
    expect(report.results.find((r) => r.sourcePath === corrupt)?.success).toBe(false);
  });

  it("marks scan status current after import when source unchanged", async () => {
    const source = join(projectDir, "status.jsonl");
    await writeFile(
      source,
      [
        JSON.stringify({
          type: "user",
          sessionId: "status-1",
          cwd: projectPath,
          timestamp: "2026-06-01T00:00:00.000Z",
          message: { content: "first" },
        }),
      ].join("\n"),
      "utf8",
    );

    const before = await importer.scan(projectPath);
    expect(before[0]?.status).toBe("new");

    await importer.import(projectPath, [source]);
    const after = await importer.scan(projectPath);
    expect(after[0]?.status).toBe("current");
  });

  // wave-230 residual
  it("scan returns empty for project with no jsonl; empty import is zeroed report", async () => {
    expect(await importer.scan(projectPath)).toEqual([]);
    const report = await importer.import(projectPath, []);
    expect(report).toEqual({ imported: 0, failed: 0, results: [] });
  });

  it("rejects source paths outside the claude projects root", async () => {
    const siblingRoot = `${claudeRoot}-sibling`;
    await mkdir(siblingRoot, { recursive: true });
    const source = join(siblingRoot, "outside.jsonl");
    await writeFile(
      source,
      JSON.stringify({
        type: "user",
        sessionId: "out-1",
        cwd: projectPath,
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { content: "x" },
      }),
      "utf8",
    );
    const report = await importer.import(projectPath, [source]);
    expect(report.imported).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toMatch(/outside/i);
  });
});
