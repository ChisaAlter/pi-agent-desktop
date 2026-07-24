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

    it("respects maxDepth and skips ignored dirs (dist/coverage) sync", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-sync-depth-"));
        mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
        mkdirSync(join(dir, "dist"), { recursive: true });
        mkdirSync(join(dir, "coverage"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c", "deep.ts"), "");
        writeFileSync(join(dir, "a", "shallow.ts"), "");
        writeFileSync(join(dir, "dist", "bundle.js"), "");
        writeFileSync(join(dir, "coverage", "lcov.info"), "");
        writeFileSync(join(dir, "Thumbs.db"), "");
        writeFileSync(join(dir, ".DS_Store"), "");

        const files = scanFilesSync(dir, { maxDepth: 2 });
        expect(files).toContain("a/shallow.ts");
        expect(files.some((f) => f.includes("deep.ts"))).toBe(false);
        expect(files.some((f) => f.includes("dist"))).toBe(false);
        expect(files.some((f) => f.includes("coverage"))).toBe(false);
        expect(files).not.toContain("Thumbs.db");
        expect(files).not.toContain(".DS_Store");
    });

    it("honors custom maxResults and returns empty for missing root", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-sync-limit-"));
        for (let i = 0; i < 20; i++) {
            writeFileSync(join(dir, `f${i}.ts`), "");
        }
        expect(scanFilesSync(dir, { recursive: false, maxResults: 7 })).toHaveLength(7);
        expect(scanFilesSync(join(dir, "does-not-exist-xyz"))).toEqual([]);
    });
});

describe("scanFiles residual edges", () => {
    it("async skips dist/build/out and ignored OS junk files", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-async-noise-"));
        for (const name of ["dist", "build", "out", ".turbo", ".vite"]) {
            mkdirSync(join(dir, name), { recursive: true });
            writeFileSync(join(dir, name, "x.js"), "");
        }
        writeFileSync(join(dir, "keep.ts"), "");
        writeFileSync(join(dir, "Thumbs.db"), "");
        writeFileSync(join(dir, ".DS_Store"), "");

        const files = await scanFiles(dir);
        expect(files).toContain("keep.ts");
        expect(files.some((f) => /^(dist|build|out|\.turbo|\.vite)\//.test(f))).toBe(false);
        expect(files).not.toContain("Thumbs.db");
        expect(files).not.toContain(".DS_Store");
    });

    it("async honors custom maxResults and missing root", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-async-limit-"));
        for (let i = 0; i < 15; i++) {
            writeFileSync(join(dir, `n${i}.ts`), "");
        }
        const limited = await scanFiles(dir, { recursive: false, maxResults: 5 });
        expect(limited).toHaveLength(5);
        await expect(scanFiles(join(dir, "missing-root-xyz"))).resolves.toEqual([]);
    });
});

// wave-229 residual
describe("scanFiles residual (wave-229)", () => {
    it("maxDepth 0 only includes root-level files", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-depth0-"));
        mkdirSync(join(dir, "sub"), { recursive: true });
        writeFileSync(join(dir, "root.ts"), "");
        writeFileSync(join(dir, "sub", "nested.ts"), "");
        const asyncFiles = await scanFiles(dir, { maxDepth: 0 });
        const syncFiles = scanFilesSync(dir, { maxDepth: 0 });
        expect(asyncFiles).toContain("root.ts");
        expect(asyncFiles.some((f) => f.includes("nested"))).toBe(false);
        expect(syncFiles).toContain("root.ts");
        expect(syncFiles.some((f) => f.includes("nested"))).toBe(false);
    });

    it("skips .pi-desktop and release directories like other noise dirs", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-pi-desktop-"));
        mkdirSync(join(dir, ".pi-desktop"), { recursive: true });
        mkdirSync(join(dir, "release"), { recursive: true });
        writeFileSync(join(dir, ".pi-desktop", "cache.bin"), "");
        writeFileSync(join(dir, "release", "app.exe"), "");
        writeFileSync(join(dir, "app.ts"), "");
        const files = await scanFiles(dir);
        expect(files).toContain("app.ts");
        expect(files.some((f) => f.includes(".pi-desktop"))).toBe(false);
        expect(files.some((f) => f.includes("release"))).toBe(false);
    });

    it("recursive false does not descend even with high maxDepth", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-norecur-"));
        mkdirSync(join(dir, "nested"), { recursive: true });
        writeFileSync(join(dir, "top.ts"), "");
        writeFileSync(join(dir, "nested", "deep.ts"), "");
        const files = await scanFiles(dir, { recursive: false, maxDepth: 10 });
        expect(files).toContain("top.ts");
        expect(files.some((f) => f.includes("deep"))).toBe(false);
        expect(scanFilesSync(dir, { recursive: false })).toContain("top.ts");
        expect(scanFilesSync(dir, { recursive: false }).some((f) => f.includes("deep"))).toBe(false);
    });
});

describe("scanFiles residual (wave-254)", () => {
    it("maxResults caps async and sync; paths use forward slashes", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-max-"));
        for (let i = 0; i < 8; i++) writeFileSync(join(dir, `f${i}.ts`), "");
        mkdirSync(join(dir, "sub"), { recursive: true });
        writeFileSync(join(dir, "sub", "nested.ts"), "");
        const asyncFiles = await scanFiles(dir, { maxResults: 3 });
        const syncFiles = scanFilesSync(dir, { maxResults: 3 });
        expect(asyncFiles).toHaveLength(3);
        expect(syncFiles).toHaveLength(3);
        for (const f of [...asyncFiles, ...syncFiles]) {
            expect(f).not.toContain("\\");
        }
    });

    it("skips node_modules/.git/dist and Thumbs.db/.DS_Store noise", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-noise-"));
        for (const d of ["node_modules", ".git", "dist", "build", "out"]) {
            mkdirSync(join(dir, d), { recursive: true });
            writeFileSync(join(dir, d, "x.js"), "");
        }
        writeFileSync(join(dir, "Thumbs.db"), "");
        writeFileSync(join(dir, ".DS_Store"), "");
        writeFileSync(join(dir, "keep.ts"), "");
        const files = await scanFiles(dir);
        expect(files).toEqual(["keep.ts"]);
        expect(scanFilesSync(dir)).toEqual(["keep.ts"]);
    });
});


// wave-265 residual
describe("scanFiles residual (wave-265)", () => {
    it("maxDepth 0 returns only root files; deeper ignored", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-depth-"));
        mkdirSync(join(dir, "nested"), { recursive: true });
        writeFileSync(join(dir, "root.ts"), "");
        writeFileSync(join(dir, "nested", "deep.ts"), "");
        const files = await scanFiles(dir, { maxDepth: 0 });
        expect(files).toContain("root.ts");
        expect(files.some((f) => f.includes("deep"))).toBe(false);
        expect(scanFilesSync(dir, { maxDepth: 0 }).some((f) => f.includes("deep"))).toBe(false);
    });

    it("ignores .next/.cache/.turbo/.vite coverage dirs", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-ign-"));
        for (const d of [".next", ".cache", ".turbo", ".vite", "coverage"]) {
            mkdirSync(join(dir, d), { recursive: true });
            writeFileSync(join(dir, d, "x.js"), "");
        }
        writeFileSync(join(dir, "ok.ts"), "");
        expect(await scanFiles(dir)).toEqual(["ok.ts"]);
        expect(scanFilesSync(dir)).toEqual(["ok.ts"]);
    });
});

// wave-274 residual
describe("scanFiles residual (wave-274)", () => {
    it("default maxDepth 6 excludes files at depth 7; depth 6 included", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-d6-"));
        // root(0)/a(1)/b(2)/c(3)/d(4)/e(5)/f(6)/g(7)
        let cur = dir;
        const names = ["a", "b", "c", "d", "e", "f", "g"];
        for (const n of names) {
            cur = join(cur, n);
            mkdirSync(cur, { recursive: true });
        }
        writeFileSync(join(dir, "a", "b", "c", "d", "e", "f", "at6.ts"), "");
        writeFileSync(join(dir, "a", "b", "c", "d", "e", "f", "g", "at7.ts"), "");
        writeFileSync(join(dir, "root.ts"), "");
        const files = await scanFiles(dir); // default maxDepth 6
        expect(files).toContain("root.ts");
        expect(files).toContain("a/b/c/d/e/f/at6.ts");
        expect(files.some((f) => f.includes("at7"))).toBe(false);
        expect(scanFilesSync(dir).some((f) => f.includes("at7"))).toBe(false);
    });

    it("maxResults 0 yields empty; missing root yields empty without throw", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-empty-"));
        writeFileSync(join(dir, "x.ts"), "");
        expect(await scanFiles(dir, { maxResults: 0 })).toEqual([]);
        expect(scanFilesSync(dir, { maxResults: 0 })).toEqual([]);
        const missing = join(dir, "no-such-dir-xyz");
        await expect(scanFiles(missing)).resolves.toEqual([]);
        expect(scanFilesSync(missing)).toEqual([]);
    });

    it("ignores node_modules.cache dir name exactly", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-nmc-"));
        mkdirSync(join(dir, "node_modules.cache"), { recursive: true });
        writeFileSync(join(dir, "node_modules.cache", "blob"), "");
        writeFileSync(join(dir, "keep.ts"), "");
        expect(await scanFiles(dir)).toEqual(["keep.ts"]);
        expect(scanFilesSync(dir)).toEqual(["keep.ts"]);
    });
    // wave-285 residual
    it("ignores node_modules/.git/dist; recursive false only top-level files", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-ign-"));
        mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "");
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "config"), "");
        mkdirSync(join(dir, "dist"), { recursive: true });
        writeFileSync(join(dir, "dist", "out.js"), "");
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "a.ts"), "");
        writeFileSync(join(dir, "root.ts"), "");
        writeFileSync(join(dir, ".DS_Store"), "");
        writeFileSync(join(dir, "Thumbs.db"), "");
        const files = await scanFiles(dir);
        expect(files).toEqual(expect.arrayContaining(["root.ts", "src/a.ts"]));
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
        expect(files.some((f) => f.includes(".git"))).toBe(false);
        expect(files.some((f) => f.includes("dist"))).toBe(false);
        expect(files).not.toContain(".DS_Store");
        expect(files).not.toContain("Thumbs.db");

        const top = await scanFiles(dir, { recursive: false });
        expect(top).toContain("root.ts");
        expect(top.some((f) => f.startsWith("src/"))).toBe(false);
        expect(scanFilesSync(dir, { recursive: false })).toEqual(expect.arrayContaining(["root.ts"]));
    });

    it("maxResults clamps listing length for async and sync", async () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-cap-"));
        for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.ts`), "");
        expect((await scanFiles(dir, { maxResults: 3 })).length).toBe(3);
        expect(scanFilesSync(dir, { maxResults: 3 }).length).toBe(3);
        expect((await scanFiles(dir, { maxResults: 500 })).length).toBe(10);
    });



});

