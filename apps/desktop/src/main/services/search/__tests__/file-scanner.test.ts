import { describe, it, expect } from "vitest";
import { scanFiles } from "../file-scanner";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("scanFiles", () => {
    it("returns files in a directory (non-recursive)", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        writeFileSync(join(dir, "a.ts"), "");
        writeFileSync(join(dir, "b.ts"), "");
        const files = scanFiles(dir, { recursive: false });
        expect(files).toContain("a.ts");
        expect(files).toContain("b.ts");
    });

    it("skips node_modules and .git", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "node_modules"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "x.js"), "");
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "HEAD"), "");
        writeFileSync(join(dir, "real.ts"), "");
        const files = scanFiles(dir);
        expect(files).toContain("real.ts");
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
        expect(files.some((f) => f.includes(".git"))).toBe(false);
    });

    it("respects maxDepth", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c", "deep.ts"), "");
        writeFileSync(join(dir, "a", "shallow.ts"), "");
        const files = scanFiles(dir, { maxDepth: 2 });
        expect(files).toContain("a/shallow.ts");
        expect(files.some((f) => f.includes("deep.ts"))).toBe(false);
    });

    it("limits result count to 500 by default", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        for (let i = 0; i < 600; i++) {
            writeFileSync(join(dir, `f${i}.ts`), "");
        }
        const files = scanFiles(dir, { recursive: false });
        expect(files.length).toBeLessThanOrEqual(500);
    });
});
