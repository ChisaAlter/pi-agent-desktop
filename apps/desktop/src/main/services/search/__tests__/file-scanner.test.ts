import { describe, it, expect } from "vitest";
import { scanFiles, scanFilesSync } from "../file-scanner";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("scanFiles (async)", () => {
    it("returns files in a directory (non-recursive)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        writeFileSync(join(dir, "a.ts"), "");
        writeFileSync(join(dir, "b.ts"), "");
        const files = await scanFiles(dir, { recursive: false });
        expect(files).toContain("a.ts");
        expect(files).toContain("b.ts");
    });

    it("skips node_modules and .git", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "node_modules"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "x.js"), "");
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "HEAD"), "");
        writeFileSync(join(dir, "real.ts"), "");
        const files = await scanFiles(dir);
        expect(files).toContain("real.ts");
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
        expect(files.some((f) => f.includes(".git"))).toBe(false);
    });

    it("respects maxDepth", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c", "deep.ts"), "");
        writeFileSync(join(dir, "a", "shallow.ts"), "");
        const files = await scanFiles(dir, { maxDepth: 2 });
        expect(files).toContain("a/shallow.ts");
        expect(files.some((f) => f.includes("deep.ts"))).toBe(false);
    });

    it("limits result count to 500 by default", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        for (let i = 0; i < 510; i++) {
            writeFileSync(join(dir, `f${i}.ts`), "");
        }
        const files = await scanFiles(dir, { recursive: false });
        expect(files.length).toBeLessThanOrEqual(500);
    }, 15_000);

    it("includes critical hidden files and directories by default without exposing protected env files", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
        mkdirSync(join(dir, ".vscode"), { recursive: true });
        writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "");
        writeFileSync(join(dir, ".vscode", "settings.json"), "");
        writeFileSync(join(dir, ".gitignore"), "");
        writeFileSync(join(dir, ".env"), "");

        const files = await scanFiles(dir);

        expect(files).toContain(".github/workflows/ci.yml");
        expect(files).toContain(".vscode/settings.json");
        expect(files).toContain(".gitignore");
        expect(files).not.toContain(".env");
    });

    it("can still include protected env files when hiddenMode is all", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        writeFileSync(join(dir, ".env"), "");

        const files = await scanFiles(dir, { hiddenMode: "all" });

        expect(files).toContain(".env");
    });

    it("can still exclude hidden entries when hiddenMode is none", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
        writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "");
        writeFileSync(join(dir, ".gitignore"), "");
        writeFileSync(join(dir, "visible.ts"), "");

        const files = await scanFiles(dir, { hiddenMode: "none" });

        expect(files).toContain("visible.ts");
        expect(files).not.toContain(".github/workflows/ci.yml");
        expect(files).not.toContain(".gitignore");
    });
});

describe("scanFilesSync", () => {
    it("returns files in a directory (non-recursive)", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-sync-"));
        writeFileSync(join(dir, "a.ts"), "");
        writeFileSync(join(dir, "b.ts"), "");
        const files = scanFilesSync(dir, { recursive: false });
        expect(files).toContain("a.ts");
        expect(files).toContain("b.ts");
    });

    it("includes critical hidden entries by default", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-sync-"));
        mkdirSync(join(dir, ".vscode"), { recursive: true });
        writeFileSync(join(dir, ".vscode", "settings.json"), "");
        writeFileSync(join(dir, ".gitignore"), "");

        const files = scanFilesSync(dir);

        expect(files).toContain(".vscode/settings.json");
        expect(files).toContain(".gitignore");
    });
});
