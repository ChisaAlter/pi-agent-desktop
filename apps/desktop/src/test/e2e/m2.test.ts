/**
 * Task M2 E2E 冒烟测试
 */
import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyMatch } from "../../main/utils/fuzzy-match";
import { findActiveMention, resolveMention } from "../../renderer/src/utils/mention-parser";
import { scanFiles } from "../../main/services/search/file-scanner";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("M2 utilities", () => {
    it("fuzzy: substring match works", () => {
        expect(fuzzyMatch("auth/login.ts", "auth")).toBe(true);
    });
    it("fuzzy: score ranks prefix higher", () => {
        expect(fuzzyScore("auth.ts", "auth")).toBeGreaterThan(fuzzyScore("user-auth.ts", "auth"));
    });
    it("fuzzy: path-segment match scores high", () => {
        expect(fuzzyScore("userAuth.ts", "auth")).toBeGreaterThanOrEqual(50);
    });
    it("mention: find at cursor", () => {
        // "hello @au" 长度 9, cursor=9, query="au"
        const r = findActiveMention("hello @au", 9);
        expect(r).toEqual({ start: 6, query: "au" });
    });
    it("mention: resolve replaces correctly", () => {
        const m = findActiveMention("@abc rest", 4)!;
        const r = resolveMention("@abc rest", m, "src/auth.ts");
        expect(r).toBe("@src/auth.ts rest");
    });
    it("mention: null when no @", () => {
        expect(findActiveMention("hello world", 5)).toBeNull();
    });
    it("scanner: skips node_modules and .git", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "node_modules"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "x.js"), "");
        writeFileSync(join(dir, "real.ts"), "");
        const files = scanFiles(dir);
        expect(files).toContain("real.ts");
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    });
});
