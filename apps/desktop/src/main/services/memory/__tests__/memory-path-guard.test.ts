/**
 * memory-path-guard.test.ts — Tests for the pure-function write guard.
 *
 * Verifies the 5 critical rules from MiMo Code:
 *   1. Non-memory paths: early return (allowed)
 *   2. CC scope: not writable (read-only)
 *   3. checkpoint-writer: own allowlist (MEMORY.md, checkpoint.md, notes.md, tasks/<TID>/*.md)
 *   4. Task-bound subagents: own tasks/<ownTID>/*.md only
 *   5. General agents (dream/distill/main): free keys allowed, tasks/ reserved
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import {
    assertMemoryWriteAllowed,
    isInsideMemoryTree,
    memoryRootPath,
    markdownIndexDbPath,
    type AssertMemoryWriteInput,
} from "../memory-path-guard";

const ROOT = "C:/Users/test/AppData/Roaming/Pi-Desktop/memory";
const PROJECT_ID = "abc123";
const SESSION_ID = "sess1";
const TASK_ID = "T1";

function makeInput(
    target: string,
    overrides: Partial<AssertMemoryWriteInput> = {},
): AssertMemoryWriteInput {
    return {
        target,
        agentName: "main",
        memoryRoot: ROOT,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        taskId: undefined,
        ...overrides,
    };
}

/** Convenience: assert that the guard allows the write. */
function allows(input: AssertMemoryWriteInput): void {
    expect(() => assertMemoryWriteAllowed(input)).not.toThrow();
}

/** Convenience: assert that the guard denies the write. */
function denies(input: AssertMemoryWriteInput): void {
    expect(() => assertMemoryWriteAllowed(input)).toThrow();
}

describe("memory-path-guard — non-memory paths", () => {
    it("allows writes outside the memory root (early return)", () => {
        allows(makeInput("C:/Users/test/projects/myapp/src/index.ts"));
        allows(makeInput("C:/Users/test/.pi/plans/roadmap.md"));
        allows(makeInput("/tmp/random.md"));
    });

    it("allows writes when target is exactly the memory root (no file)", () => {
        // memoryRoot itself — rel is empty, parts.length < 2 → throw
        denies(makeInput(ROOT));
    });

    it("handles Windows backslash paths in target", () => {
        allows(makeInput("C:\\Users\\test\\projects\\myapp\\src\\index.ts"));
    });
});

describe("memory-path-guard — scope validation", () => {
    it("allows writes to global scope", () => {
        allows(makeInput(`${ROOT}/global/MEMORY.md`));
        allows(makeInput(`${ROOT}/global/anything.md`));
    });

    it("allows writes to projects scope", () => {
        allows(makeInput(`${ROOT}/projects/${PROJECT_ID}/MEMORY.md`));
        allows(makeInput(`${ROOT}/projects/${PROJECT_ID}/notes-something.md`));
    });

    it("allows writes to sessions scope", () => {
        allows(makeInput(`${ROOT}/sessions/${SESSION_ID}/notes.md`));
        allows(makeInput(`${ROOT}/sessions/${SESSION_ID}/checkpoint.md`));
    });

    it("denies writes to cc scope (CC is read-only)", () => {
        denies(makeInput(`${ROOT}/cc/feedback/test.md`));
    });

    it("denies writes to unknown scopes", () => {
        denies(makeInput(`${ROOT}/unknown/something.md`));
    });

    it("denies writes to memory root directly (no file)", () => {
        denies(makeInput(`${ROOT}/`));
    });
});

describe("memory-path-guard — checkpoint-writer allowlist", () => {
    const writer = (target: string, sessionId = SESSION_ID) =>
        makeInput(target, { agentName: "checkpoint-writer", sessionId });

    it("allows projects/<pid>/MEMORY.md", () => {
        allows(writer(`${ROOT}/projects/${PROJECT_ID}/MEMORY.md`));
    });

    it("allows projects/<pid>/memory-<topic>.md (case-insensitive prefix)", () => {
        allows(writer(`${ROOT}/projects/${PROJECT_ID}/memory-architecture.md`));
        allows(writer(`${ROOT}/projects/${PROJECT_ID}/MEMORY-ARCHITECTURE.md`));
    });

    it("allows sessions/<sid>/checkpoint.md", () => {
        allows(writer(`${ROOT}/sessions/${SESSION_ID}/checkpoint.md`));
    });

    it("allows sessions/<sid>/checkpoint-<topic>.md", () => {
        allows(writer(`${ROOT}/sessions/${SESSION_ID}/checkpoint-slice-5.md`));
    });

    it("allows sessions/<sid>/notes.md", () => {
        allows(writer(`${ROOT}/sessions/${SESSION_ID}/notes.md`));
    });

    it("allows sessions/<sid>/tasks/<TID>/<any>.md", () => {
        allows(writer(`${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`));
        allows(writer(`${ROOT}/sessions/${SESSION_ID}/tasks/T2.1/notes.md`));
    });

    it("denies checkpoint-writer writing to wrong session's tasks", () => {
        denies(writer(`${ROOT}/sessions/other-sid/checkpoint.md`, SESSION_ID));
    });

    it("denies checkpoint-writer writing to arbitrary path under projects/", () => {
        denies(writer(`${ROOT}/projects/${PROJECT_ID}/random.md`));
    });

    it("denies checkpoint-writer writing to nested dir under sessions/", () => {
        denies(writer(`${ROOT}/sessions/${SESSION_ID}/random/deep.md`));
    });

    it("denies checkpoint-writer writing to invalid task ID", () => {
        denies(writer(`${ROOT}/sessions/${SESSION_ID}/tasks/not-a-tid/progress.md`));
    });
});

describe("memory-path-guard — sessions/<sid>/tasks/ reservation", () => {
    it("denies dream writing to tasks/ (reserved for checkpoint-writer + task-bound)", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "dream" },
        ));
    });

    it("denies distill writing to tasks/", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "distill" },
        ));
    });

    it("denies main agent writing to tasks/", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main" },
        ));
    });

    it("allows task-bound subagent writing to its own task dir", () => {
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "explore", taskId: "T1" },
        ));
    });

    it("denies task-bound subagent writing to a different task's dir", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T2/progress.md`,
            { agentName: "explore", taskId: "T1" },
        ));
    });

    it("denies task-bound subagent with invalid task ID", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/not-a-tid/progress.md`,
            { agentName: "explore", taskId: "not-a-tid" },
        ));
    });
});

describe("memory-path-guard — general agents (dream/distill/main)", () => {
    it("allows dream writing to projects/<pid>/MEMORY.md", () => {
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/MEMORY.md`,
            { agentName: "dream" },
        ));
    });

    it("allows dream writing to global/MEMORY.md", () => {
        allows(makeInput(
            `${ROOT}/global/MEMORY.md`,
            { agentName: "dream" },
        ));
    });

    it("allows dream writing to global/<free-key>.md", () => {
        allows(makeInput(
            `${ROOT}/global/preferences.md`,
            { agentName: "dream" },
        ));
    });

    it("allows dream writing to sessions/<sid>/notes.md", () => {
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/notes.md`,
            { agentName: "dream" },
        ));
    });

    it("allows distill writing to projects/<pid>/MEMORY.md", () => {
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/MEMORY.md`,
            { agentName: "distill" },
        ));
    });

    it("allows main agent writing to projects/<pid>/MEMORY.md", () => {
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/MEMORY.md`,
            { agentName: "main" },
        ));
    });
});

describe("memory-path-guard — projectId validation (project isolation)", () => {
    it("denies dream agent writing to a different project's MEMORY.md", () => {
        denies(makeInput(
            `${ROOT}/projects/xyz/MEMORY.md`,
            { agentName: "dream", projectId: "abc" },
        ));
    });

    it("allows dream agent writing to its own project's MEMORY.md", () => {
        allows(makeInput(
            `${ROOT}/projects/abc/MEMORY.md`,
            { agentName: "dream", projectId: "abc" },
        ));
    });

    it("denies checkpoint-writer writing to a different project", () => {
        denies(makeInput(
            `${ROOT}/projects/xyz/MEMORY.md`,
            { agentName: "checkpoint-writer", projectId: "abc" },
        ));
    });

    it("allows writes to global/ which doesn't require projectId match", () => {
        // Any projectId may write to global/ — it's cross-project user
        // preferences, not project-scoped data.
        allows(makeInput(
            `${ROOT}/global/MEMORY.md`,
            { agentName: "dream", projectId: "abc" },
        ));
        allows(makeInput(
            `${ROOT}/global/MEMORY.md`,
            { agentName: "main", projectId: "xyz" },
        ));
        allows(makeInput(
            `${ROOT}/global/preferences.md`,
            { agentName: "dream", projectId: "abc" },
        ));
    });

    it("allows sessions/<sid>/... writes regardless of projectId", () => {
        // sessions/ are session-scoped, not project-scoped — projectId mismatch
        // must not block them.
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/notes.md`,
            { agentName: "dream", projectId: "abc" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/checkpoint.md`,
            { agentName: "checkpoint-writer", projectId: "abc" },
        ));
    });

    it("error message includes projectId mismatch details", () => {
        try {
            assertMemoryWriteAllowed(makeInput(
                `${ROOT}/projects/xyz/MEMORY.md`,
                { agentName: "dream", projectId: "abc" },
            ));
            throw new Error("should have thrown");
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain("projectId mismatch");
            expect(msg).toContain("expected=abc");
            expect(msg).toContain("actual=xyz");
        }
    });

    it("denies main agent writing to a different project's free key", () => {
        // Even free-form keys under projects/<pid>/ are isolated by projectId.
        denies(makeInput(
            `${ROOT}/projects/other-pid/notes-anything.md`,
            { agentName: "main", projectId: "abc" },
        ));
    });
});

describe("memory-path-guard — error messages", () => {
    it("error message includes writable targets hint", () => {
        try {
            assertMemoryWriteAllowed(makeInput(`${ROOT}/cc/feedback.md`));
            throw new Error("should have thrown");
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain("memory-path-guard denied");
            expect(msg).toContain("MEMORY.md");
            expect(msg).toContain("notes.md");
        }
    });
});

describe("memory-path-guard — path helpers", () => {
    it("memoryRootPath returns <userData>/memory", () => {
        const userData = "C:/Users/test/AppData/Roaming/Pi-Desktop";
        expect(memoryRootPath(userData))
            .toBe(join(userData, "memory"));
    });

    it("markdownIndexDbPath returns <userData>/memory/index.sqlite", () => {
        const userData = "C:/Users/test/AppData/Roaming/Pi-Desktop";
        expect(markdownIndexDbPath(userData))
            .toBe(join(userData, "memory", "index.sqlite"));
    });
});

// wave-90 residual
describe("memory-path-guard — isInsideMemoryTree", () => {
    it("returns true for the memory root and nested files", () => {
        expect(isInsideMemoryTree(ROOT, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}/global/MEMORY.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}/sessions/${SESSION_ID}/notes.md`, ROOT)).toBe(true);
    });

    it("returns false for sibling prefix paths and unrelated paths", () => {
        expect(isInsideMemoryTree(`${ROOT}-extra/global/MEMORY.md`, ROOT)).toBe(false);
        expect(isInsideMemoryTree("C:/Users/test/projects/x.ts", ROOT)).toBe(false);
        expect(isInsideMemoryTree("C:/Users/test/AppData/Roaming/Pi-Desktop/other/x.md", ROOT)).toBe(false);
    });

    it("normalizes backslashes for membership checks", () => {
        expect(isInsideMemoryTree(`${ROOT.replace(/\//g, "\\")}\\global\\MEMORY.md`, ROOT)).toBe(true);
    });
});

describe("memory-path-guard — residual edges", () => {
    it("denies checkpoint-writer writing under global/", () => {
        denies(makeInput(`${ROOT}/global/MEMORY.md`, { agentName: "checkpoint-writer" }));
        denies(makeInput(`${ROOT}/global/notes.md`, { agentName: "checkpoint-writer" }));
    });

    it("denies checkpoint-writer non-md task files", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.txt`,
            { agentName: "checkpoint-writer" },
        ));
    });

    it("denies checkpoint-writer nested deeper than tasks/<TID>/<file>.md", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/nested/progress.md`,
            { agentName: "checkpoint-writer" },
        ));
    });

    it("allows task-bound nested TID forms matching TASK_ID_RE", () => {
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T10.3.2/progress.md`,
            { agentName: "explore", taskId: "T10.3.2" },
        ));
    });

    it("denies task-bound write when sessionId mismatches", () => {
        denies(makeInput(
            `${ROOT}/sessions/other-sid/tasks/T1/progress.md`,
            { agentName: "explore", taskId: "T1" },
        ));
    });

    it("denies general agent writing to scope directory without a file key", () => {
        // parts = ["sessions"] → length < 2 (memory root / bare scope)
        denies(makeInput(`${ROOT}/sessions`, { agentName: "main" }));
        denies(makeInput(`${ROOT}/projects`, { agentName: "main" }));
        denies(makeInput(`${ROOT}/global`, { agentName: "main" }));
    });

    it("allows general agent free key under sessions/<sid>/ even without .md suffix", () => {
        // General rule does not enforce .md; path-safety for file type is caller-side.
        allows(makeInput(`${ROOT}/sessions/${SESSION_ID}/scratch`, { agentName: "main" }));
    });

    it("allows Windows-style backslash targets under projects for main", () => {
        allows(makeInput(
            `${ROOT.replace(/\//g, "\\")}\\projects\\${PROJECT_ID}\\MEMORY.md`,
            { agentName: "main" },
        ));
    });

    it("denies unknown agent writing into reserved tasks tree", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/x.md`,
            { agentName: "custom-extension-agent" },
        ));
    });

    // wave-169 residual
    it("non-memory targets are no-ops (guard has no opinion)", () => {
        expect(() =>
            assertMemoryWriteAllowed(makeInput("C:/other/project/src/a.ts", { agentName: "main" })),
        ).not.toThrow();
        expect(() =>
            assertMemoryWriteAllowed(makeInput("C:/Users/x/AppData/Roaming/other.md", { agentName: "main" })),
        ).not.toThrow();
    });

    it("denies write to memory root exact path and CC scope", () => {
        denies(makeInput(ROOT, { agentName: "main" }));
        denies(makeInput(`${ROOT}/cc/MEMORY.md`, { agentName: "main" }));
    });

    it("isInsideMemoryTree true for nested targets and false for siblings", () => {
        expect(isInsideMemoryTree(`${ROOT}/global/MEMORY.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}-extra/global/x.md`, ROOT)).toBe(false);
        expect(isInsideMemoryTree(ROOT, ROOT)).toBe(true);
    });

    it("memoryRootPath and markdownIndexDbPath are under userData", () => {
        const userData = "C:/Users/test/AppData/Roaming/Pi";
        expect(memoryRootPath(userData).replace(/\\/g, "/")).toBe(`${userData}/memory`);
        expect(markdownIndexDbPath(userData).replace(/\\/g, "/")).toBe(`${userData}/memory/index.sqlite`);
    });


    // wave-216 residual
    it("checkpoint-writer can write reserved session files and tasks; MEMORY.md is denied there", () => {
        // product allowlist: sessions/<sid>/{checkpoint,notes}.md + tasks/<TID>/*.md
        // and projects/<pid>/MEMORY.md — not sessions MEMORY.md
        for (const leaf of ["checkpoint.md", "notes.md"]) {
            allows(makeInput(`${ROOT}/sessions/${SESSION_ID}/${leaf}`, { agentName: "checkpoint-writer" }));
        }
        denies(makeInput(`${ROOT}/sessions/${SESSION_ID}/MEMORY.md`, { agentName: "checkpoint-writer" }));
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/MEMORY.md`,
            { agentName: "checkpoint-writer" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "checkpoint-writer" },
        ));
    });

    it("task-bound subagent can write own task tree and is denied other task ids", () => {
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T2/progress.md`,
            { agentName: "dream", taskId: "T2" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "dream", taskId: "T2" },
        ));
    });

    it("isInsideMemoryTree false for parent path and true for nested under root", () => {
        expect(isInsideMemoryTree("C:/Users/x", ROOT)).toBe(false);
        expect(isInsideMemoryTree(`${ROOT}/global/x.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}/sessions/${SESSION_ID}/notes.md`, ROOT)).toBe(true);
    });


    // wave-224 residual
    it("non-memory targets are no-ops; memory root and scope dir alone throw", () => {
        expect(() => assertMemoryWriteAllowed(makeInput("C:/other/file.md"))).not.toThrow();
        expect(() => assertMemoryWriteAllowed(makeInput(ROOT))).toThrow(/memory root|scope directory/i);
        expect(() => assertMemoryWriteAllowed(makeInput(`${ROOT}/global`))).toThrow(/memory root|scope directory/i);
    });

    it("projects scope enforces projectId match; global ignores projectId", () => {
        allows(makeInput(`${ROOT}/global/prefs.md`, { projectId: "other" }));
        denies(makeInput(`${ROOT}/projects/other-pid/MEMORY.md`, { projectId: PROJECT_ID }));
        allows(makeInput(`${ROOT}/projects/${PROJECT_ID}/MEMORY.md`, { projectId: PROJECT_ID }));
    });

    it("memoryRootPath and markdownIndexDbPath join under userData/memory", () => {
        const userData = "C:/Users/demo/AppData/Roaming/Pi";
        expect(memoryRootPath(userData).replace(/\\/g, "/")).toBe(`${userData}/memory`);
        expect(markdownIndexDbPath(userData).replace(/\\/g, "/")).toBe(`${userData}/memory/index.sqlite`);
    });

    it("CC scope is not writable; dream cannot write sessions tasks without taskId", () => {
        denies(makeInput(`${ROOT}/cc/MEMORY.md`));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "dream" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/notes.md`,
            { agentName: "dream" },
        ));
    });

    // wave-244 residual
    it("checkpoint-writer can write reserved task files; other agents cannot without matching taskId", () => {
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "checkpoint-writer" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/checkpoint.md`,
            { agentName: "checkpoint-writer" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main", taskId: "T1" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main", taskId: "T2" },
        ));
    });

    it("isInsideMemoryTree is false for sibling prefix paths that share root string prefix", () => {
        expect(isInsideMemoryTree(`${ROOT}-sibling/x.md`, ROOT)).toBe(false);
        expect(isInsideMemoryTree(`${ROOT}x/y.md`, ROOT)).toBe(false);
        // product is pure string-prefix (no path.resolve) — ".." still starts with root/
        expect(isInsideMemoryTree(`${ROOT}/../escape.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}/global/../global/MEMORY.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree("C:/Users/test/AppData/Roaming/Pi-Desktop", ROOT)).toBe(false);
    });

    // wave-265 residual
    it("memoryRootPath and markdownIndexDbPath join under userData", () => {
        const root = memoryRootPath("C:/Users/test/AppData/Roaming/Pi-Desktop").split("\\").join("/");
        const db = markdownIndexDbPath("C:/Users/test/AppData/Roaming/Pi-Desktop").split("\\").join("/");
        expect(root.endsWith("/memory")).toBe(true);
        expect(root.includes("Pi-Desktop")).toBe(true);
        expect(db.endsWith("memory/index.sqlite")).toBe(true);
    });

    it("cc scope is denied; free global key allowed; session tasks require matching taskId", () => {
        denies(makeInput(`${ROOT}/cc/MEMORY.md`));
        allows(makeInput(`${ROOT}/global/notes.md`));
        denies(makeInput(`${ROOT}/sessions/${SESSION_ID}/tasks/T9/progress.md`, { agentName: "main" }));
        allows(makeInput(`${ROOT}/sessions/${SESSION_ID}/tasks/T9/progress.md`, {
            agentName: "main",
            taskId: "T9",
        }));
    });


    // wave-274 residual
    it("checkpoint-writer allowlist: memory- prefix, nested projects denied, sessionId isolation", () => {
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/memory-topic.md`,
            { agentName: "checkpoint-writer" },
        ));
        allows(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/MEMORY.md`,
            { agentName: "checkpoint-writer" },
        ));
        denies(makeInput(
            `${ROOT}/projects/${PROJECT_ID}/nested/MEMORY.md`,
            { agentName: "checkpoint-writer" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/other-sess/checkpoint.md`,
            { agentName: "checkpoint-writer" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/checkpoint-topic.md`,
            { agentName: "checkpoint-writer" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/random.md`,
            { agentName: "checkpoint-writer" },
        ));
        denies(makeInput(
            `${ROOT}/global/MEMORY.md`,
            { agentName: "checkpoint-writer" },
        ));
    });

    it("taskId must match TASK_ID_RE; invalid taskId cannot unlock reserved tasks path", () => {
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main", taskId: "task-1" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T1/progress.md`,
            { agentName: "main", taskId: "1" },
        ));
        allows(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T10.3.2/progress.md`,
            { agentName: "main", taskId: "T10.3.2" },
        ));
        denies(makeInput(
            `${ROOT}/sessions/${SESSION_ID}/tasks/T10.3.2/progress.md`,
            { agentName: "main", taskId: "T10.3" },
        ));
    });

    it("denial help names agent and writable targets; isInsideMemoryTree root equality", () => {
        try {
            assertMemoryWriteAllowed(makeInput(`${ROOT}/cc/x.md`));
            expect.unreachable("should deny");
        } catch (e) {
            const msg = String(e);
            expect(msg).toMatch(/memory-path-guard denied write for agent "main"/);
            expect(msg).toContain(`projects/${PROJECT_ID}/MEMORY.md`);
            expect(msg).toContain(`sessions/${SESSION_ID}/notes.md`);
            expect(msg).toMatch(/CC scope is read-only|not writable/i);
        }
        expect(isInsideMemoryTree(ROOT, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}/global/MEMORY.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree("C:/other/file.md", ROOT)).toBe(false);
    });

    // wave-286 residual
    it("isInsideMemoryTree requires trailing-sep prefix; outside tree allows non-memory write", () => {
        expect(isInsideMemoryTree(`${ROOT}/global/MEMORY.md`, ROOT)).toBe(true);
        expect(isInsideMemoryTree(`${ROOT}extra/file.md`, ROOT)).toBe(false);
        expect(isInsideMemoryTree(ROOT.replace(/\//g, "\\"), ROOT)).toBe(true);
        // non-memory paths early-allow
        allows(makeInput("D:/workspace/src/app.ts"));
        denies(makeInput(`${ROOT}/cc/notes.md`));
    });

    it("memoryRootPath and markdownIndexDbPath join under userData", () => {
        expect(memoryRootPath("C:/Users/x/AppData")).toMatch(/memory$/);
        expect(markdownIndexDbPath("C:/Users/x/AppData").replace(/\\/g, "/")).toBe(
            "C:/Users/x/AppData/memory/index.sqlite",
        );
    });



});
