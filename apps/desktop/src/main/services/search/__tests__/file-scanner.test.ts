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

    it("keeps dotfiles and hidden config directories that are not explicitly ignored", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
        writeFileSync(join(dir, ".gitignore"), "");
        writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "");

        const files = await scanFiles(dir);

        expect(files).toContain(".gitignore");
        expect(files).toContain(".github/workflows/ci.yml");
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
    }, 20_000);
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

    it("keeps dotfiles and hidden config directories that are not explicitly ignored", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-sync-"));
        mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
        writeFileSync(join(dir, ".gitignore"), "");
        writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "");

        const files = scanFilesSync(dir);

        expect(files).toContain(".gitignore");
        expect(files).toContain(".github/workflows/ci.yml");
    });
});
