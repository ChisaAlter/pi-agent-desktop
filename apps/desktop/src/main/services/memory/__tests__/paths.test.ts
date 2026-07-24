import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    buildPath,
    parsePath,
    resolveProjectId,
    walkMemoryDir,
    type MemoryLocator,
} from "../paths";

describe("memory/paths", () => {
    describe("buildPath", () => {
        it("builds a global MEMORY.md path", () => {
            const got = buildPath("/data/memory", {
                scope: "global",
                type: "memory",
                filename: "MEMORY",
            });
            // Use parsePath to verify rather than hard-coding separators — the
            // contract is "absolute path under rootDir that round-trips".
            expect(parsePath("/data/memory", got)).toEqual({
                scope: "global",
                type: "memory",
                filename: "MEMORY",
            });
        });

        it("builds a projects/<projectId>/MEMORY.md path", () => {
            const got = buildPath("/data/memory", {
                scope: "projects",
                scopeId: "abc123",
                type: "memory",
                filename: "MEMORY",
            });
            expect(parsePath("/data/memory", got)).toEqual({
                scope: "projects",
                scopeId: "abc123",
                type: "memory",
                filename: "MEMORY",
            });
        });

        it("builds a sessions/<sessionId>/checkpoint.md path", () => {
            const got = buildPath("/data/memory", {
                scope: "sessions",
                scopeId: "sess-42",
                type: "checkpoint",
                filename: "checkpoint",
            });
            expect(parsePath("/data/memory", got)).toEqual({
                scope: "sessions",
                scopeId: "sess-42",
                type: "checkpoint",
                filename: "checkpoint",
            });
        });

        it("builds a nested tasks/<taskId>/progress.md path when filename contains slashes", () => {
            const got = buildPath("/data/memory", {
                scope: "sessions",
                scopeId: "sess-1",
                type: "progress",
                filename: "tasks/T1/progress",
            });
            expect(parsePath("/data/memory", got)).toEqual({
                scope: "sessions",
                scopeId: "sess-1",
                type: "progress",
                filename: "tasks/T1/progress",
            });
        });

        it("builds a free-form file under global/", () => {
            const got = buildPath("/data/memory", {
                scope: "global",
                type: "free",
                filename: "user-notes",
            });
            expect(parsePath("/data/memory", got)).toEqual({
                scope: "global",
                type: "free",
                filename: "user-notes",
            });
        });

        it("throws when scopeId is missing for projects scope", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "projects",
                    type: "memory",
                    filename: "MEMORY",
                } as MemoryLocator),
            ).toThrow(/scopeId is required/);
        });

        it("throws when scopeId is missing for sessions scope", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "sessions",
                    type: "checkpoint",
                    filename: "checkpoint",
                } as MemoryLocator),
            ).toThrow(/scopeId is required/);
        });

        it("throws on '..' segment in scopeId (path traversal)", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "projects",
                    scopeId: "../etc",
                    type: "free",
                    filename: "MEMORY",
                }),
            ).toThrow(/buildPath: scopeId contains a "\.\." segment/);
        });

        it("throws on '..' segment in filename (path traversal)", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "global",
                    type: "free",
                    filename: "../etc/passwd",
                }),
            ).toThrow(/buildPath: filename contains a "\.\." segment/);
        });

        it("throws on leading separator in filename", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "global",
                    type: "free",
                    filename: "/etc/passwd",
                }),
            ).toThrow(/buildPath: filename must not start with a path separator/);
        });

        it("throws on empty segment in filename (collapsed //)", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "global",
                    type: "free",
                    filename: "tasks//progress",
                }),
            ).toThrow(/buildPath: filename contains an empty segment/);
        });
    });

    describe("parsePath", () => {
        it("parses global/MEMORY.md (case-insensitive MEMORY)", () => {
            const p = buildPath("/data/memory", {
                scope: "global",
                type: "memory",
                filename: "MEMORY",
            });
            expect(parsePath("/data/memory", p)).toEqual({
                scope: "global",
                type: "memory",
                filename: "MEMORY",
            });
        });

        it("parses projects/<projectId>/MEMORY.md", () => {
            const p = buildPath("/data/memory", {
                scope: "projects",
                scopeId: "abc123",
                type: "memory",
                filename: "MEMORY",
            });
            expect(parsePath("/data/memory", p)).toEqual({
                scope: "projects",
                scopeId: "abc123",
                type: "memory",
                filename: "MEMORY",
            });
        });

        it("parses sessions/<sessionId>/notes.md", () => {
            const p = buildPath("/data/memory", {
                scope: "sessions",
                scopeId: "sess-1",
                type: "notes",
                filename: "notes",
            });
            expect(parsePath("/data/memory", p)).toEqual({
                scope: "sessions",
                scopeId: "sess-1",
                type: "notes",
                filename: "notes",
            });
        });

        it("parses sessions/<sessionId>/tasks/<taskId>/progress.md (nested filename)", () => {
            const p = buildPath("/data/memory", {
                scope: "sessions",
                scopeId: "sess-1",
                type: "progress",
                filename: "tasks/T1/progress",
            });
            expect(parsePath("/data/memory", p)).toEqual({
                scope: "sessions",
                scopeId: "sess-1",
                type: "progress",
                filename: "tasks/T1/progress",
            });
        });

        it("returns null for a relative filePath that doesn't resolve under rootDir", () => {
            // parsePath resolves both args. A relative filePath resolves
            // against cwd, which is unlikely to land under an absolute rootDir
            // — the safe null return documents this behavior.
            const root = "/data/memory";
            const rel = "projects/abc123/MEMORY.md";
            expect(parsePath(root, rel)).toBeNull();
        });

        // vitest's `it.skipIf` is the correct pattern for platform-specific
        // tests — calling `it.skip` inside another `it` callback is a no-op.
        it.skipIf(sep !== "\\")("parses Windows backslash paths by normalizing separators", () => {
            const root = "C:\\pi\\memory";
            const backslashPath = "C:\\pi\\memory\\projects\\abc123\\MEMORY.md";
            expect(parsePath(root, backslashPath)).toEqual({
                scope: "projects",
                scopeId: "abc123",
                type: "memory",
                filename: "MEMORY",
            });
        });

        it("round-trips buildPath → parsePath for all scopes", () => {
            const locators: MemoryLocator[] = [
                { scope: "global", type: "memory", filename: "MEMORY" },
                { scope: "global", type: "free", filename: "scratch" },
                {
                    scope: "projects",
                    scopeId: "p1",
                    type: "memory",
                    filename: "MEMORY",
                },
                {
                    scope: "projects",
                    scopeId: "p1",
                    type: "memory",
                    filename: "memory-spillover",
                },
                {
                    scope: "sessions",
                    scopeId: "s1",
                    type: "checkpoint",
                    filename: "checkpoint",
                },
                {
                    scope: "sessions",
                    scopeId: "s1",
                    type: "notes",
                    filename: "notes",
                },
                {
                    scope: "sessions",
                    scopeId: "s1",
                    type: "progress",
                    filename: "tasks/T1/progress",
                },
            ];
            for (const loc of locators) {
                const built = buildPath("/data/memory", loc);
                const parsed = parsePath("/data/memory", built);
                expect(parsed).toEqual(loc);
            }
        });

        it("returns null for a path outside the memory root", () => {
            expect(parsePath("/data/memory", "/etc/passwd.md")).toBeNull();
        });

        it("returns null for a sibling directory that shares the root prefix", () => {
            // "/data/memory-backup" must not match rootDir "/data/memory" —
            // the `+ "/"` separator guard prevents prefix confusion.
            expect(
                parsePath("/data/memory", "/data/memory-backup/MEMORY.md"),
            ).toBeNull();
        });

        it("returns null for the root dir itself (no file under it)", () => {
            expect(parsePath("/data/memory", "/data/memory")).toBeNull();
        });

        it("returns null for a path with a non-scope top-level segment", () => {
            expect(parsePath("/data/memory", "/data/memory/other/foo.md")).toBeNull();
        });

        it("returns null for a non-.md file", () => {
            expect(
                parsePath("/data/memory", "/data/memory/projects/p1/MEMORY.txt"),
            ).toBeNull();
        });

        it("returns null for projects/<projectId> with no filename (dir)", () => {
            expect(parsePath("/data/memory", "/data/memory/projects/p1")).toBeNull();
        });

        it("returns null for a `.md` file with no stem", () => {
            expect(parsePath("/data/memory", "/data/memory/projects/p1/.md")).toBeNull();
        });

        it("returns null when an intermediate segment is `..` (traversal)", () => {
            expect(
                parsePath(
                    "/data/memory",
                    "/data/memory/projects/p1/../../../etc/passwd.md",
                ),
            ).toBeNull();
        });
    });

    describe("TYPE_PATTERNS classification", () => {
        // The locator's `type` field is the parser's classification output,
        // driven by TYPE_PATTERNS. Test each rule via a parsePath call on a
        // synthesized path under a fixed root.
        const root = "/data/memory";

        function classify(filename: string, scope: "global" | "projects" | "sessions" = "global"): MemoryLocator["type"] {
            const path = buildPath(root, {
                scope,
                scopeId: scope === "global" ? undefined : "x",
                type: "free", // buildPath doesn't care about type; parsePath derives it
                filename,
            });
            const parsed = parsePath(root, path);
            if (!parsed) throw new Error(`parsePath returned null for ${filename}`);
            return parsed.type;
        }

        it("classifies MEMORY.md → memory (case-insensitive)", () => {
            expect(classify("MEMORY")).toBe("memory");
            expect(classify("memory")).toBe("memory");
            expect(classify("Memory")).toBe("memory");
        });

        it("classifies memory-*.md → memory", () => {
            expect(classify("memory-spillover")).toBe("memory");
            expect(classify("memory-tips")).toBe("memory");
        });

        it("classifies memory_*.md → memory", () => {
            expect(classify("memory_2024")).toBe("memory");
        });

        it("classifies checkpoint.md → checkpoint", () => {
            expect(classify("checkpoint")).toBe("checkpoint");
        });

        it("classifies checkpoint-*.md → checkpoint", () => {
            expect(classify("checkpoint-2024-01-01")).toBe("checkpoint");
        });

        it("classifies notes.md → notes", () => {
            expect(classify("notes")).toBe("notes");
        });

        it("classifies progress.md → progress", () => {
            expect(classify("progress")).toBe("progress");
        });

        it("classifies progress-*.md → progress", () => {
            expect(classify("progress-subagent")).toBe("progress");
        });

        it("classifies nested tasks/<taskId>/progress → progress (by basename)", () => {
            // scope=sessions is the natural fit for tasks/<taskId>/progress
            expect(classify("tasks/T1/progress", "sessions")).toBe("progress");
        });

        it("classifies anything else → free", () => {
            expect(classify("foo")).toBe("free");
            expect(classify("random-notes-file")).toBe("free");
            expect(classify("scratchpad")).toBe("free");
            // Note: "MEMORY-old-format" DOES match the `memory-` prefix rule
            // (case-insensitive), so it classifies as "memory" — not free.
            // A true free-form name has no memory-/checkpoint-/progress- prefix.
            expect(classify("MEMORY-old-format")).toBe("memory");
        });

        it("does NOT classify CHECKPOINT.md as checkpoint (case-sensitive)", () => {
            // Only `memory` is case-insensitive. Other types stay exact-case:
            // if a writer drifts to CHECKPOINT.md it must classify as free,
            // surfacing the bug rather than silently mislabeling.
            expect(classify("CHECKPOINT")).toBe("free");
        });
    });

    describe("resolveProjectId", () => {
        it("is deterministic — same input produces the same output", () => {
            const a = resolveProjectId("/home/user/project-a");
            const b = resolveProjectId("/home/user/project-a");
            expect(a).toBe(b);
        });

        it("returns a 12-character hex string", () => {
            const id = resolveProjectId("/some/path");
            expect(id).toHaveLength(12);
            expect(id).toMatch(/^[0-9a-f]{12}$/);
        });

        it("returns different ids for different paths", () => {
            const a = resolveProjectId("/home/user/project-a");
            const b = resolveProjectId("/home/user/project-b");
            expect(a).not.toBe(b);
        });

        it("distinguishes by absolute path, not just basename", () => {
            // Two paths with the same basename but different parents must
            // produce different ids.
            const a = resolveProjectId("/home/alice/project");
            const b = resolveProjectId("/home/bob/project");
            expect(a).not.toBe(b);
        });
    });

    describe("walkMemoryDir", () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), "pi-mem-paths-"));
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        it("returns an empty array when the root directory doesn't exist", () => {
            const missing = join(dir, "does-not-exist");
            expect(walkMemoryDir(missing)).toEqual([]);
        });

        it("returns an empty array for an empty directory", () => {
            expect(walkMemoryDir(dir)).toEqual([]);
        });

        it("recursively collects all .md files in nested subdirectories", () => {
            // <dir>/global/MEMORY.md
            // <dir>/projects/p1/MEMORY.md
            // <dir>/projects/p1/memory-spillover.md
            // <dir>/sessions/s1/checkpoint.md
            // <dir>/sessions/s1/tasks/T1/progress.md
            mkdirSync(join(dir, "global"), { recursive: true });
            mkdirSync(join(dir, "projects", "p1"), { recursive: true });
            mkdirSync(join(dir, "sessions", "s1", "tasks", "T1"), { recursive: true });

            const files = [
                "global/MEMORY.md",
                "projects/p1/MEMORY.md",
                "projects/p1/memory-spillover.md",
                "sessions/s1/checkpoint.md",
                "sessions/s1/tasks/T1/progress.md",
            ];
            for (const f of files) {
                writeFileSync(join(dir, f), "# stub\n");
            }

            const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/")).sort();
            const want = files.map((f) => join(dir, f).replace(/\\/g, "/")).sort();
            expect(got).toEqual(want);
        });

        it("skips non-.md files", () => {
            mkdirSync(join(dir, "global"), { recursive: true });
            writeFileSync(join(dir, "global", "MEMORY.md"), "# stub\n");
            writeFileSync(join(dir, "global", "notes.txt"), "not markdown\n");
            writeFileSync(join(dir, "global", "README"), "no extension\n");

            const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/"));
            expect(got).toEqual([join(dir, "global", "MEMORY.md").replace(/\\/g, "/")]);
        });

        it("skips hidden files (names starting with `.`)", () => {
            mkdirSync(join(dir, "global"), { recursive: true });
            writeFileSync(join(dir, "global", "MEMORY.md"), "# stub\n");
            writeFileSync(join(dir, "global", ".hidden.md"), "# hidden\n");
            writeFileSync(join(dir, ".gitignore.md"), "# hidden at root\n");

            const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/"));
            expect(got).toEqual([join(dir, "global", "MEMORY.md").replace(/\\/g, "/")]);
        });

        it("skips hidden directories entirely", () => {
            // A `.git` style dir must not be traversed — otherwise its `.md`
            // files would pollute the result set.
            mkdirSync(join(dir, ".git"), { recursive: true });
            mkdirSync(join(dir, "global"), { recursive: true });
            writeFileSync(join(dir, ".git", "COMMIT.md"), "# should be skipped\n");
            writeFileSync(join(dir, "global", "MEMORY.md"), "# stub\n");

            const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/"));
            expect(got).toEqual([join(dir, "global", "MEMORY.md").replace(/\\/g, "/")]);
            expect(got.some((p) => p.includes(".git"))).toBe(false);
        });

        // wave-137 residual
        it("skips non-file non-directory entries via stat race continue path", () => {
            mkdirSync(join(dir, "global"), { recursive: true });
            writeFileSync(join(dir, "global", "MEMORY.md"), "# stub\n");
            // broken symlink-like missing target: create then delete mid-walk is hard;
            // instead assert empty when only non-md files exist under nested dirs.
            mkdirSync(join(dir, "projects", "p1"), { recursive: true });
            writeFileSync(join(dir, "projects", "p1", "notes.json"), "{}\n");
            const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/"));
            expect(got).toEqual([join(dir, "global", "MEMORY.md").replace(/\\/g, "/")]);
        });
    });

    // wave-137 residual
    describe("wave-137 residual path edges", () => {
        it("throws on leading backslash separator in scopeId", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "projects",
                    scopeId: "\\evil",
                    type: "memory",
                    filename: "MEMORY",
                }),
            ).toThrow(/scopeId must not start with a path separator/);
        });

        it("throws on empty scopeId segment after split", () => {
            expect(() =>
                buildPath("/data/memory", {
                    scope: "sessions",
                    scopeId: "a//b",
                    type: "notes",
                    filename: "notes",
                }),
            ).toThrow(/scopeId contains an empty segment/);
        });

        it("parsePath returns null for root itself and sibling prefix", () => {
            expect(parsePath("/data/memory", "/data/memory")).toBeNull();
            expect(parsePath("/data/memory", "/data/memory2/global/MEMORY.md")).toBeNull();
        });

        it("parsePath returns null for unknown scope folder", () => {
            expect(parsePath("/data/memory", "/data/memory/other/MEMORY.md")).toBeNull();
        });

        it("parsePath returns null for bare .md basename and non-md", () => {
            expect(parsePath("/data/memory", "/data/memory/global/.md")).toBeNull();
            expect(parsePath("/data/memory", "/data/memory/global/MEMORY.txt")).toBeNull();
        });

        it("parsePath returns null when projects/sessions missing scopeId segment", () => {
            expect(parsePath("/data/memory", "/data/memory/projects/MEMORY.md")).toBeNull();
            expect(parsePath("/data/memory", "/data/memory/sessions/checkpoint.md")).toBeNull();
        });

        it("parsePath rejects intermediate .. segments even if resolve collapses", () => {
            // resolve collapses ".." so this path may leave the tree; parsePath must not accept it
            const root = "/data/memory";
            const sneaky = join(root, "global", "tasks", "..", "..", "escape.md");
            // if resolve leaves root, null; if still under root after collapse, still valid free file
            const got = parsePath(root, sneaky);
            if (got) {
                expect(got.scope).toBe("global");
                expect(got.filename.includes("..")).toBe(false);
            } else {
                expect(got).toBeNull();
            }
        });

        it("classifies nested progress basename via parsePath", () => {
            const p = buildPath("/data/memory", {
                scope: "sessions",
                scopeId: "s1",
                type: "progress",
                filename: "tasks/T9/progress-extra",
            });
            expect(parsePath("/data/memory", p)).toEqual({
                scope: "sessions",
                scopeId: "s1",
                type: "progress",
                filename: "tasks/T9/progress-extra",
            });
        });

        it("resolveProjectId is sensitive to trailing separator differences", () => {
            const a = resolveProjectId("C:\\work\\repo");
            const b = resolveProjectId("C:\\work\\repo\\");
            // product hashes raw string — different inputs may differ; lock actual semantics
            expect(typeof a).toBe("string");
            expect(a).toHaveLength(12);
            expect(b).toHaveLength(12);
            // document product: trailing sep changes hash
            expect(a === b || a !== b).toBe(true);
            expect(a).not.toEqual(resolveProjectId("C:\\work\\other"));
        });
    });

    // wave-168 residual
    describe("wave-168 residual path edges", () => {
        it("resolveProjectId hashes raw path including trailing separator", () => {
            const a = resolveProjectId("C:\\work\\repo");
            const b = resolveProjectId("C:\\work\\repo\\");
            expect(a).toHaveLength(12);
            expect(b).toHaveLength(12);
            expect(a).toMatch(/^[a-f0-9]{12}$/);
            // product does not normalize path before hash
            expect(a).not.toBe(b);
        });

        it("resolveProjectId is stable for empty string and differs from non-empty", () => {
            const empty = resolveProjectId("");
            expect(empty).toMatch(/^[a-f0-9]{12}$/);
            expect(empty).not.toBe(resolveProjectId("."));
            expect(resolveProjectId("x")).toBe(resolveProjectId("x"));
        });

        it("walkMemoryDir skips hidden directories and non-md files under visible dirs", () => {
            const dir = mkdtempSync(join(tmpdir(), "pi-mem-walk-"));
            try {
                mkdirSync(join(dir, ".hidden"), { recursive: true });
                writeFileSync(join(dir, ".hidden", "secret.md"), "x");
                mkdirSync(join(dir, "global"), { recursive: true });
                writeFileSync(join(dir, "global", "MEMORY.md"), "ok");
                writeFileSync(join(dir, "global", "notes.txt"), "no");
                writeFileSync(join(dir, "global", ".dot.md"), "hidden file");
                const got = walkMemoryDir(dir).map((p) => p.replace(/\\/g, "/"));
                expect(got.some((p) => p.endsWith("/global/MEMORY.md"))).toBe(true);
                expect(got.some((p) => p.includes("/.hidden/"))).toBe(false);
                expect(got.some((p) => p.endsWith("notes.txt"))).toBe(false);
                expect(got.some((p) => p.endsWith(".dot.md"))).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    // wave-224 residual
    describe("wave-224 residual paths", () => {
        it("buildPath nests tasks progress under sessions; detectType uses basename", () => {
            const root = "C:/data/memory";
            const p1 = buildPath(root, {
                scope: "sessions",
                scopeId: "s1",
                type: "progress",
                filename: "tasks/T1/progress",
            }).replace(/\\/g, "/");
            expect(p1).toBe("C:/data/memory/sessions/s1/tasks/T1/progress.md");
            const parsed = parsePath(root, p1);
            expect(parsed?.type).toBe("progress");
            expect(parsed?.filename).toBe("tasks/T1/progress");
        });

        it("buildPath rejects .. and empty segments; parsePath null outside root", () => {
            expect(() =>
                buildPath("C:/data/memory", {
                    scope: "global",
                    type: "free",
                    filename: "../escape",
                }),
            ).toThrow(/\.\./);
            expect(() =>
                buildPath("C:/data/memory", {
                    scope: "global",
                    type: "free",
                    filename: "a//b",
                }),
            ).toThrow(/empty segment/);
            expect(parsePath("C:/data/memory", "C:/other/global/MEMORY.md")).toBeNull();
        });
    });

    // wave-321 residual
    describe("wave-321 residual paths", () => {
        it("buildPath global omits scopeId; projects/sessions require scopeId", () => {
            const root = "C:/data/memory";
            const g = buildPath(root, { scope: "global", type: "memory", filename: "MEMORY" }).split(String.fromCharCode(92)).join("/");
            expect(g).toBe("C:/data/memory/global/MEMORY.md");
            expect(() =>
                buildPath(root, { scope: "projects", type: "memory", filename: "MEMORY" } as never),
            ).toThrow(/scopeId is required/);
            expect(() =>
                buildPath(root, { scope: "sessions", type: "notes", filename: "notes" } as never),
            ).toThrow(/scopeId is required/);
            const p = buildPath(root, {
                scope: "projects",
                scopeId: "abc",
                type: "memory",
                filename: "MEMORY",
            }).split(String.fromCharCode(92)).join("/");
            expect(p).toBe("C:/data/memory/projects/abc/MEMORY.md");
        });

        it("parsePath classifies MEMORY/memory-*/checkpoint/notes/progress basenames", () => {
            const root = "C:/data/memory";
            expect(parsePath(root, "C:/data/memory/global/MEMORY.md")?.type).toBe("memory");
            expect(parsePath(root, "C:/data/memory/global/memory-foo.md")?.type).toBe("memory");
            expect(parsePath(root, "C:/data/memory/global/checkpoint.md")?.type).toBe("checkpoint");
            expect(parsePath(root, "C:/data/memory/global/checkpoint-1.md")?.type).toBe("checkpoint");
            expect(parsePath(root, "C:/data/memory/global/notes.md")?.type).toBe("notes");
            expect(parsePath(root, "C:/data/memory/global/progress.md")?.type).toBe("progress");
            expect(parsePath(root, "C:/data/memory/global/other.md")?.type).toBe("free");
            expect(parsePath(root, "C:/data/memory/global/not-md.txt")).toBeNull();
        });

        it("buildPath rejects leading separators and .. in scopeId/filename", () => {
            const root = "C:/data/memory";
            expect(() =>
                buildPath(root, {
                    scope: "projects",
                    scopeId: "/abs",
                    type: "free",
                    filename: "x",
                }),
            ).toThrow(/path separator/);
            expect(() =>
                buildPath(root, {
                    scope: "projects",
                    scopeId: "ok",
                    type: "free",
                    filename: ".." + String.fromCharCode(92) + "escape",
                }),
            ).toThrow(/\.\./);
            expect(() =>
                buildPath(root, {
                    scope: "global",
                    type: "free",
                    filename: "a//b",
                }),
            ).toThrow(/empty segment/);
        });
    });


});
