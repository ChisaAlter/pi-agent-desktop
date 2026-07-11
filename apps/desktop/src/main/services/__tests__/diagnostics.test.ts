import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildDiagnosticReport } from "../diagnostics";

describe("diagnostic report", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("exports health metadata and redacts secrets without conversation content", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        mkdirSync(dir, { recursive: true });
        writeFileSync(logPath, "Authorization: Bearer secret-token\napiKey=sk-live-value\n", "utf8");

        const report = buildDiagnosticReport({
            appVersion: "1.2.3",
            userDataPath: dir,
            logPath,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1", name: "Demo", path: "C:/secret/project", createdAt: 1 }],
            sessions: [{
                id: "s1",
                workspaceId: "w1",
                title: "Session",
                createdAt: 1,
                updatedAt: 2,
                messages: [{ id: "m1", role: "user", content: "private conversation", timestamp: new Date(1) }],
            }],
            databaseHealth: { ok: true, details: ["ok"] },
        });
        const serialized = JSON.stringify(report);

        expect(report.appVersion).toBe("1.2.3");
        expect(report.database).toEqual({ ok: true, details: ["ok"] });
        expect(report.workspaces).toEqual({ count: 1 });
        expect(report.sessions).toEqual({ count: 1, messageCount: 1 });
        expect(serialized).not.toContain("private conversation");
        expect(serialized).not.toContain("C:/secret/project");
        expect(serialized).not.toContain("secret-token");
        expect(serialized).not.toContain("sk-live-value");
        expect(report.recentLogs).toContain("[REDACTED]");
    });
});
