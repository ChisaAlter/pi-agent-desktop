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
