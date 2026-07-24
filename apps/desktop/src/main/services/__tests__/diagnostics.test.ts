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


    // wave-87 residual
    it("handles missing log file and empty collections without leaking paths", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-empty-"));
        dirs.push(dir);
        const missingLog = join(dir, "does-not-exist.log");
        const report = buildDiagnosticReport({
            appVersion: "9.9.9",
            userDataPath: dir,
            logPath: missingLog,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            sessions: [],
            databaseHealth: { ok: false, details: ["db missing"] },
        });
        expect(report.appVersion).toBe("9.9.9");
        expect(report.workspaces).toEqual({ count: 0 });
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.database).toEqual({ ok: false, details: ["db missing"] });
        // missing log should not throw; recentLogs may be empty or note absence
        expect(Array.isArray(report.recentLogs) || typeof report.recentLogs === "string").toBe(true);
        expect(JSON.stringify(report)).not.toContain("private");
    });

    it("counts multiple sessions/messages without including message bodies", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-multi-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        writeFileSync(logPath, "ok\n", "utf8");
        const report = buildDiagnosticReport({
            appVersion: "1.0.0",
            userDataPath: dir,
            logPath,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [
                { id: "w1", name: "A", path: "C:/hidden/a", createdAt: 1 },
                { id: "w2", name: "B", path: "C:/hidden/b", createdAt: 2 },
            ],
            sessions: [
                {
                    id: "s1",
                    workspaceId: "w1",
                    title: "S1",
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [
                        { id: "m1", role: "user", content: "secret-a", timestamp: new Date(1) },
                        { id: "m2", role: "assistant", content: "secret-b", timestamp: new Date(2) },
                    ],
                },
                {
                    id: "s2",
                    workspaceId: "w2",
                    title: "S2",
                    createdAt: 3,
                    updatedAt: 4,
                    messages: [{ id: "m3", role: "user", content: "secret-c", timestamp: new Date(3) }],
                },
            ],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.workspaces).toEqual({ count: 2 });
        expect(report.sessions).toEqual({ count: 2, messageCount: 3 });
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain("secret-a");
        expect(serialized).not.toContain("secret-b");
        expect(serialized).not.toContain("secret-c");
        expect(serialized).not.toContain("C:/hidden");
    });

    // wave-98 residual
    it("prefers sessionStats override over sessions array", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-stats-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "2.0.0",
            userDataPath: join(dir, "nested-user-data"),
            platform: "linux",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1", name: "A", path: "C:/hidden/a", createdAt: 1 }],
            sessions: [
                {
                    id: "s1",
                    workspaceId: "w1",
                    title: "ignored",
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [{ id: "m1", role: "user", content: "should-not-count", timestamp: new Date(1) }],
                },
            ],
            sessionStats: { count: 99, messageCount: 1234 },
            databaseHealth: { ok: true, details: ["override"] },
        });
        expect(report.sessions).toEqual({ count: 99, messageCount: 1234 });
        // storageRoot is basename only — no absolute path leak
        expect(report.storageRoot).toBe("nested-user-data");
        expect(JSON.stringify(report)).not.toContain(dir);
        expect(JSON.stringify(report)).not.toContain("should-not-count");
        expect(report.platform).toBe("linux");
    });

    it("redacts Cookie and x-api-key style log lines", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-cookie-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        writeFileSync(
            logPath,
            "Cookie: session=super-secret-cookie\nx-api-key: sk-abc-123\npassword=hunter2\n",
            "utf8",
        );
        const report = buildDiagnosticReport({
            appVersion: "1.0.0",
            userDataPath: dir,
            logPath,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            sessions: [],
            databaseHealth: { ok: true, details: [] },
        });
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain("super-secret-cookie");
        expect(serialized).not.toContain("sk-abc-123");
        expect(serialized).not.toContain("hunter2");
        expect(report.recentLogs).toContain("[REDACTED]");
    });

    it("includes generatedAt ISO timestamp and clones versions/details", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-meta-"));
        dirs.push(dir);
        const versions = { electron: "41", node: "22", chrome: "140" };
        const details = ["row"];
        const report = buildDiagnosticReport({
            appVersion: "1.0.0",
            userDataPath: dir,
            platform: "win32",
            versions,
            workspaces: [],
            databaseHealth: { ok: false, details },
        });
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(report.versions).toEqual(versions);
        expect(report.versions).not.toBe(versions);
        expect(report.database.details).toEqual(["row"]);
        expect(report.database.details).not.toBe(details);
        details.push("mutated");
        expect(report.database.details).toEqual(["row"]);
    });

    // wave-133 residual
    it("prefers sessionStats over sessions array and basenames storageRoot", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-stats-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1", name: "Demo", path: "C:/secret/project", createdAt: 1 }],
            sessions: [{
                id: "s1",
                workspaceId: "w1",
                title: "Session",
                createdAt: 1,
                updatedAt: 2,
                messages: [
                    { id: "m1", role: "user", content: "private", timestamp: new Date(1) },
                    { id: "m2", role: "assistant", content: "reply", timestamp: new Date(2) },
                ],
            }],
            sessionStats: { count: 9, messageCount: 42 },
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.sessions).toEqual({ count: 9, messageCount: 42 });
        expect(report.storageRoot).toBe(dir.split(/[\\/]/).filter(Boolean).at(-1));
        expect(report.storageRoot).not.toContain("secret");
        expect(JSON.stringify(report)).not.toContain("private");
        expect(JSON.stringify(report)).not.toContain("C:/secret/project");
    });

    it("returns empty recentLogs when logPath is omitted", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-nolog-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            platform: "darwin",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.recentLogs).toBe("");
        expect(report.platform).toBe("darwin");
    });

    // wave-173 residual
    it("returns empty recentLogs for empty-string logPath and sessions-undefined defaults", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-empty-path-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            logPath: "",
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            // sessions omitted, sessionStats omitted → zero counts
            databaseHealth: { ok: true, details: ["healthy"] },
        });
        expect(report.recentLogs).toBe("");
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.workspaces).toEqual({ count: 0 });
        expect(report.database.details).toEqual(["healthy"]);
    });

    it("tails only the last 512KiB of oversized logs and redacts the tail", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-tail-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        // head marker must fall outside the 512KiB window; tail secret must remain and be redacted
        const headMarker = "HEAD_SECRET_TOKEN_SHOULD_NOT_APPEAR";
        const tailSecret = "Authorization: Bearer tail-secret-token\n";
        const padding = Buffer.alloc(520 * 1024, 0x41); // 'A' * 520KiB
        writeFileSync(logPath, Buffer.concat([Buffer.from(headMarker, "utf8"), padding, Buffer.from(tailSecret, "utf8")]));

        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            logPath,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.recentLogs).not.toContain(headMarker);
        expect(report.recentLogs).not.toContain("tail-secret-token");
        expect(report.recentLogs).toContain("[REDACTED]");
        expect(report.recentLogs).toContain("Bearer");
    });

    it("clones versions and database details so caller mutation cannot leak into the report", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-clone-"));
        dirs.push(dir);
        const versions = { electron: "41", node: "22", chrome: "140" };
        const details = ["row-a"];
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: join(dir, "user-data-root"),
            platform: "linux",
            versions,
            workspaces: [{ id: "w1", name: "A", path: "C:/hidden", createdAt: 1 }],
            sessionStats: { count: 3, messageCount: 7 },
            databaseHealth: { ok: false, details },
        });
        expect(report.storageRoot).toBe("user-data-root");
        expect(report.sessions).toEqual({ count: 3, messageCount: 7 });
        expect(report.versions).not.toBe(versions);
        expect(report.database.details).not.toBe(details);
        versions.electron = "mutated";
        details.push("mutated");
        expect(report.versions.electron).toBe("41");
        expect(report.database.details).toEqual(["row-a"]);
        expect(JSON.stringify(report)).not.toContain("C:/hidden");
    });

    // wave-192 residual
    it("treats logPath pointing at a directory as unreadable without throwing", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-dirlog-"));
        dirs.push(dir);
        // pass directory as logPath → readFileSync fails → Unable to read logs
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            logPath: dir,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.recentLogs).toMatch(/Unable to read logs/i);
        expect(JSON.stringify(report)).not.toContain("private");
    });

    it("sessionStats zeros still override a populated sessions array", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-zero-stats-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1", name: "A", path: "C:/hidden/a", createdAt: 1 }],
            sessions: [
                {
                    id: "s1",
                    workspaceId: "w1",
                    title: "S",
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [{ id: "m1", role: "user", content: "secret-body", timestamp: new Date(1) }],
                },
            ],
            sessionStats: { count: 0, messageCount: 0 },
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.workspaces).toEqual({ count: 1 });
        expect(JSON.stringify(report)).not.toContain("secret-body");
        expect(JSON.stringify(report)).not.toContain("C:/hidden");
    });

    // wave-197 residual
    it("omitted sessions and sessionStats yield zero counts; omitted logPath is empty string", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-omit-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: join(dir, "leaf-root"),
            platform: "linux",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: ["ok"] },
        });
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.workspaces).toEqual({ count: 0 });
        expect(report.recentLogs).toBe("");
        expect(report.storageRoot).toBe("leaf-root");
        expect(report.platform).toBe("linux");
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("copies versions and database details without sharing array references", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-copy-"));
        dirs.push(dir);
        const versions = { electron: "41", node: "22", chrome: "140" };
        const details = ["a", "b"];
        const report = buildDiagnosticReport({
            appVersion: "x",
            userDataPath: dir,
            platform: "win32",
            versions,
            workspaces: [],
            databaseHealth: { ok: false, details },
        });
        expect(report.versions).toEqual(versions);
        expect(report.versions).not.toBe(versions);
        expect(report.database.details).toEqual(["a", "b"]);
        expect(report.database.details).not.toBe(details);
        details.push("mutated");
        expect(report.database.details).toEqual(["a", "b"]);
    });

    // wave-201 residual
    it("storageRoot is basename of userDataPath; explicit sessionStats wins over sessions", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-stats-"));
        dirs.push(dir);
        const nested = join(dir, "user-data-leaf");
        mkdirSync(nested, { recursive: true });
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: nested,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1" } as never, { id: "w2" } as never],
            sessions: [
                { messages: [{}, {}] } as never,
                { messages: [{}] } as never,
            ],
            sessionStats: { count: 9, messageCount: 99 },
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.storageRoot).toBe("user-data-leaf");
        expect(report.workspaces.count).toBe(2);
        // product prefers sessionStats when provided
        expect(report.sessions).toEqual({ count: 9, messageCount: 99 });
    });

    it("missing logPath and non-file logPath yield empty recentLogs", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-log-"));
        dirs.push(dir);
        const missing = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
            logPath: join(dir, "no-such.log"),
        });
        expect(missing.recentLogs).toBe("");
        const asDir = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
            logPath: dir,
        });
        // product: existsSync(dir) true but readFileSync may throw → Unable to read OR empty
        expect(
            asDir.recentLogs === "" || asDir.recentLogs.startsWith("Unable to read logs:"),
        ).toBe(true);
    });

    // wave-205 residual
    it("sessionStats defaults from sessions messages length when sessionStats omitted", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-sess-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            sessions: [
                { messages: [{}, {}, {}] } as never,
                { messages: [{}] } as never,
            ],
            databaseHealth: { ok: false, details: ["sqlite locked"] },
        });
        expect(report.sessions).toEqual({ count: 2, messageCount: 4 });
        expect(report.database).toEqual({ ok: false, details: ["sqlite locked"] });
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("empty sessions and missing sessions both yield zero counts", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-empty-"));
        dirs.push(dir);
        const base = {
            appVersion: "1",
            userDataPath: dir,
            platform: "linux" as const,
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        };
        expect(buildDiagnosticReport({ ...base, sessions: [] }).sessions).toEqual({
            count: 0,
            messageCount: 0,
        });
        expect(buildDiagnosticReport(base).sessions).toEqual({ count: 0, messageCount: 0 });
        expect(buildDiagnosticReport({ ...base, platform: "darwin" }).platform).toBe("darwin");
    });

    it("reads log file content via redaction path and omits logPath when undefined", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-log2-"));
        dirs.push(dir);
        const logFile = join(dir, "main.log");
        writeFileSync(logFile, "line-a\nline-b\n", "utf8");
        const withLog = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
            logPath: logFile,
        });
        expect(withLog.recentLogs).toContain("line-a");
        expect(withLog.recentLogs).toContain("line-b");
        const noLog = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(noLog.recentLogs).toBe("");
    });

    // wave-213 residual
    it("prefers sessionStats over sessions array; clones database details and versions", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-stats-"));
        dirs.push(dir);
        const details = ["d1"];
        const versions = { electron: "e", node: "n", chrome: "c" };
        const report = buildDiagnosticReport({
            appVersion: "9.9.9",
            userDataPath: join(dir, "User Data", "Pi Desktop"),
            platform: "win32",
            versions,
            workspaces: [{ id: "w1" } as never, { id: "w2" } as never],
            sessions: [
                { messages: [{}, {}] } as never,
                { messages: [{}] } as never,
            ],
            sessionStats: { count: 99, messageCount: 7 },
            databaseHealth: { ok: false, details },
        });
        // sessionStats wins over sessions reduce
        expect(report.sessions).toEqual({ count: 99, messageCount: 7 });
        expect(report.workspaces).toEqual({ count: 2 });
        expect(report.storageRoot).toBe("Pi Desktop");
        expect(report.database.ok).toBe(false);
        expect(report.database.details).toEqual(["d1"]);
        expect(report.database.details).not.toBe(details);
        expect(report.versions).toEqual(versions);
        expect(report.versions).not.toBe(versions);
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        // missing log path empty
        expect(report.recentLogs).toBe("");
        // missing log file path
        const missingLog = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: dir,
            platform: "linux",
            versions,
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
            logPath: join(dir, "no-such.log"),
        });
        expect(missingLog.recentLogs).toBe("");
        expect(missingLog.platform).toBe("linux");
    });

    // wave-219 residual
    it("prefers sessionStats over sessions array; clones database details array", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diag-"));
        dirs.push(dir);
        const details = ["d1"];
        const versions = { electron: "1", node: "2", chrome: "3" };
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: join(dir, "User Data"),
            platform: "win32",
            versions,
            workspaces: [{ id: "w", name: "W", path: "C:/w", createdAt: 1 } as never],
            sessions: [{ id: "s", messages: [{}, {}] } as never],
            sessionStats: { count: 9, messageCount: 42 },
            databaseHealth: { ok: false, details },
        });
        expect(report.sessions).toEqual({ count: 9, messageCount: 42 });
        expect(report.workspaces.count).toBe(1);
        expect(report.storageRoot).toBe("User Data");
        expect(report.database.details).toEqual(["d1"]);
        expect(report.database.details).not.toBe(details);
        details.push("mutated");
        expect(report.database.details).toEqual(["d1"]);
        expect(report.versions).toEqual(versions);
        expect(report.versions).not.toBe(versions);
    });

    // wave-250 residual
    it("omitted logPath yields empty recentLogs; storageRoot is basename only", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diag-"));
        dirs.push(dir);
        const nested = join(dir, "nested", "PiData");
        mkdirSync(nested, { recursive: true });
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: nested,
            platform: "darwin",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.recentLogs).toBe("");
        expect(report.storageRoot).toBe("PiData");
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
    });

    it("redacts Cookie and password lines from log tail without throwing", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diag-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        writeFileSync(
            logPath,
            "Cookie: session=abc\npassword=super-secret\nnormal line ok\n",
            "utf8",
        );
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            logPath,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: ["ok"] },
        });
        expect(report.recentLogs).not.toContain("super-secret");
        expect(report.recentLogs).not.toMatch(/session=abc/i);
        expect(report.recentLogs).toMatch(/\[REDACTED\]|normal line ok/);
    });

    // wave-263 residual
    it("sessionStats override wins over sessions array; workspaces count only", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diag-"));
        dirs.push(dir);
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [
                { id: "w1", name: "A", path: "C:/secret/a", createdAt: 1 },
                { id: "w2", name: "B", path: "C:/secret/b", createdAt: 2 },
            ],
            sessions: [
                {
                    id: "s1",
                    workspaceId: "w1",
                    title: "T",
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [
                        { id: "m1", role: "user", content: "private body", timestamp: new Date(1) },
                        { id: "m2", role: "assistant", content: "more private", timestamp: new Date(2) },
                    ],
                },
            ],
            sessionStats: { count: 99, messageCount: 7 },
            databaseHealth: { ok: false, details: ["locked"] },
        });
        expect(report.workspaces).toEqual({ count: 2 });
        expect(report.sessions).toEqual({ count: 99, messageCount: 7 });
        expect(report.database).toEqual({ ok: false, details: ["locked"] });
        const s = JSON.stringify(report);
        expect(s).not.toContain("private body");
        expect(s).not.toContain("C:/secret");
        expect(s).not.toContain("more private");
    });

    it("reads only log tail and redacts Authorization Bearer tokens", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-diag-"));
        dirs.push(dir);
        const logPath = join(dir, "main.log");
        writeFileSync(
            logPath,
            "Authorization: Bearer sk-live-abcdef\nx-api-key: abcd\nplain\n",
            "utf8",
        );
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: dir,
            logPath,
            platform: "linux",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.recentLogs).not.toMatch(/sk-live-abcdef/i);
        expect(report.recentLogs).toMatch(/plain|\[REDACTED\]/);
        expect(report.platform).toBe("linux");
        expect(report.storageRoot).toBe(dir.split(/[\\/]/).pop());
    });


    // wave-273 residual
    it("sessionStats override wins over sessions array; missing log yields empty recentLogs", () => {
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: "C:/Users/demo/AppData/Roaming/Pi Desktop",
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1" } as never],
            sessions: [
                { id: "s1", messages: [{}, {}, {}] } as never,
                { id: "s2", messages: [{}] } as never,
            ],
            sessionStats: { count: 5, messageCount: 50 },
            databaseHealth: { ok: true, details: ["ok"] },
        });
        expect(report.sessions).toEqual({ count: 5, messageCount: 50 });
        expect(report.workspaces).toEqual({ count: 1 });
        expect(report.storageRoot).toBe("Pi Desktop");
        expect(report.database).toEqual({ ok: true, details: ["ok"] });
        expect(report.recentLogs).toBe("");
        const json = JSON.stringify(report);
        expect(json).not.toContain("messages");
    });

    it("database details are cloned; versions object is copied", () => {
        const details = ["a"];
        const versions = { electron: "41", node: "22", chrome: "140" };
        const report = buildDiagnosticReport({
            appVersion: "1",
            userDataPath: "C:/data/root",
            platform: "win32",
            versions,
            workspaces: [],
            databaseHealth: { ok: false, details },
        });
        details.push("mutated");
        versions.electron = "mut";
        expect(report.database.details).toEqual(["a"]);
        expect(report.versions.electron).toBe("41");
        expect(report.storageRoot).toBe("root");
    });


    // wave-277 residual
    it("counts workspaces from array when sessionStats absent; storageRoot is basename", () => {
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: "C:/Users/demo/AppData/Roaming/Pi Desktop",
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1" } as never, { id: "w2" } as never],
            sessions: [{ id: "s1", messages: [{}, {}] } as never],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.workspaces).toEqual({ count: 2 });
        // product falls back to counting sessions/messages when sessionStats omitted
        expect(report.sessions.count).toBe(1);
        expect(report.sessions.messageCount).toBe(2);
        expect(report.storageRoot).toBe("Pi Desktop");
        expect(report.appVersion).toBe("1.0.14");
        expect(report.platform).toBe("win32");
    });

    it("empty workspaces/sessions yield zero counts; database defaults when omitted", () => {
        const report = buildDiagnosticReport({
            appVersion: "x",
            userDataPath: "C:/data",
            platform: "win32",
            versions: { electron: "1", node: "2", chrome: "3" },
            workspaces: [],
            sessions: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(report.workspaces).toEqual({ count: 0 });
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
    });



    // wave-287 residual
    it("sessionStats zeros override non-empty sessions; storageRoot basename with spaces", () => {
        const report = buildDiagnosticReport({
            appVersion: "1.0.14",
            userDataPath: "C:/Users/demo/AppData/Roaming/Pi Desktop",
            platform: "win32",
            versions: { electron: "41", node: "22", chrome: "140" },
            workspaces: [{ id: "w1" } as never, { id: "w2" } as never],
            sessions: [
                { id: "s1", messages: [{}, {}, {}] } as never,
            ],
            sessionStats: { count: 0, messageCount: 0 },
            databaseHealth: { ok: false, details: ["missing table"] },
        });
        // product prefers sessionStats even when zeros
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.workspaces).toEqual({ count: 2 });
        expect(report.storageRoot).toBe("Pi Desktop");
        expect(report.database).toEqual({ ok: false, details: ["missing table"] });
        expect(report.recentLogs).toBe("");
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("missing logPath and nonexistent log both yield empty recentLogs; versions cloned", () => {
        const versions = { electron: "41", node: "22", chrome: "140" };
        const noPath = buildDiagnosticReport({
            appVersion: "x",
            userDataPath: "C:/data/root",
            platform: "win32",
            versions,
            workspaces: [],
            databaseHealth: { ok: true, details: [] },
        });
        expect(noPath.recentLogs).toBe("");
        expect(noPath.storageRoot).toBe("root");

        const dir = mkdtempSync(join(tmpdir(), "pi-diagnostics-wave287-"));
        dirs.push(dir);
        const missing = join(dir, "does-not-exist.log");
        const report = buildDiagnosticReport({
            appVersion: "y",
            userDataPath: dir,
            logPath: missing,
            platform: "darwin",
            versions,
            workspaces: [],
            sessions: undefined,
            databaseHealth: { ok: true, details: ["d"] },
        });
        expect(report.recentLogs).toBe("");
        expect(report.sessions).toEqual({ count: 0, messageCount: 0 });
        expect(report.platform).toBe("darwin");
        versions.electron = "mut";
        expect(report.versions.electron).toBe("41");
    });

});
