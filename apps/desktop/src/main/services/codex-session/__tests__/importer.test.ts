import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { CodexSessionImporter } from "../importer";

describe("CodexSessionImporter", () => {
    let codexRoot: string;
    let piRoot: string;
    let projectPath: string;
    let importer: CodexSessionImporter;

    beforeEach(async () => {
        codexRoot = await mkdtemp(join(tmpdir(), "codex-sessions-"));
        piRoot = await mkdtemp(join(tmpdir(), "pi-sessions-"));
        projectPath = "C:/demo/project";
        importer = new CodexSessionImporter({ codexRoot, piRoot });
    });

    it("scans only codex sessions for the selected project", async () => {
        await writeFile(
            join(codexRoot, "match.jsonl"),
            [
                JSON.stringify({ type: "session_meta", payload: { id: "s1", cwd: projectPath, timestamp: "2026-06-01T00:00:00.000Z" } }),
                JSON.stringify({ type: "event_msg", payload: { type: "user_message", content: "hello" } }),
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            join(codexRoot, "other.jsonl"),
            JSON.stringify({ type: "session_meta", payload: { id: "s2", cwd: "C:/other" } }),
            "utf8",
        );

        const sessions = await importer.scan(projectPath);

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({ id: "s1", status: "new", messageCount: 1 });
    });

    it("imports codex jsonl into pi session format with metadata", async () => {
        const source = join(codexRoot, "match.jsonl");
        await writeFile(
            source,
            [
                JSON.stringify({ type: "session_meta", payload: { id: "s1", cwd: projectPath, timestamp: "2026-06-01T00:00:00.000Z" } }),
                JSON.stringify({ type: "event_msg", payload: { type: "user_message", content: "hello" } }),
                JSON.stringify({ type: "event_msg", payload: { type: "assistant_message", content: "hi" } }),
            ].join("\n"),
            "utf8",
        );

        const report = await importer.import(projectPath, [source]);

        expect(report.imported).toBe(1);
        expect(report.failed).toBe(0);
        const target = report.results[0].targetPath;
        expect(target).toBeTruthy();
        const raw = await readFile(target!, "utf8");
        expect(raw).toContain("\"type\":\"codex_import\"");
        expect(raw).toContain("\"role\":\"user\"");
        expect(raw).toContain("\"role\":\"assistant\"");
        expect(raw).toContain("\"usage\"");
    });

    it("rejects source paths outside the codex sessions root", async () => {
        const siblingRoot = `${codexRoot}-sibling`;
        await mkdir(siblingRoot, { recursive: true });
        const source = join(siblingRoot, "outside.jsonl");
        await writeFile(
            source,
            JSON.stringify({ type: "session_meta", payload: { id: "s1", cwd: projectPath } }),
            "utf8",
        );

        const report = await importer.import(projectPath, [source]);

        expect(report.imported).toBe(0);
        expect(report.failed).toBe(1);
        expect(report.results[0].error).toContain("outside ~/.codex/sessions");
    });
});
