import { describe, it, expect } from "vitest";
import { BUILTIN_SUBAGENTS, get, isSpawnable, listAll, listSpawnable } from "../registry";

describe("SubagentRegistry", () => {
    describe("BUILTIN_SUBAGENTS", () => {
        it("registers exactly 4 built-in subagent types (general removed in Phase E audit; checkpoint-writer added in Task 5)", () => {
            expect(BUILTIN_SUBAGENTS).toHaveLength(4);
            const names = BUILTIN_SUBAGENTS.map((s) => s.name).sort();
            expect(names).toEqual(["checkpoint-writer", "distill", "dream", "explore"]);
        });

        it("every entry has a non-empty prompt and description", () => {
            for (const sub of BUILTIN_SUBAGENTS) {
                expect(sub.description.length).toBeGreaterThan(0);
                expect(sub.prompt.length).toBeGreaterThan(0);
                expect(sub.prompt.includes("You ")).toBe(true);
            }
        });

        it("every built-in type declares a toolAllowlist", () => {
            // `general` (which had toolAllowlist: undefined) was removed — every
            // remaining type must explicitly enumerate its allowed tools.
            for (const sub of BUILTIN_SUBAGENTS) {
                expect(sub.toolAllowlist, `${sub.name} should declare toolAllowlist`).toBeDefined();
                expect(sub.toolAllowlist!.length).toBeGreaterThan(0);
            }
        });

        it("explore excludes bash from toolAllowlist (Phase E audit: bash cannot be constrained at tool-name level)", () => {
            const explore = get("explore");
            expect(explore?.toolAllowlist).toEqual(
                ["read", "grep", "glob", "list", "webfetch", "websearch"],
            );
            expect(explore?.toolAllowlist).not.toContain("bash");
        });

        it("dream and distill are read-only (no write/bash tools)", () => {
            const dream = get("dream");
            const distill = get("distill");
            expect(dream?.toolAllowlist).toEqual(["read", "glob", "grep"]);
            expect(distill?.toolAllowlist).toEqual(["read", "glob", "grep"]);
        });

        it("checkpoint-writer has read/glob/grep/write/edit toolAllowlist (Task 5)", () => {
            const cw = get("checkpoint-writer");
            expect(cw?.toolAllowlist).toEqual(["read", "glob", "grep", "write", "edit"]);
            // bash is excluded for the same reason as explore — no permission
            // engine yet to constrain what bash runs.
            expect(cw?.toolAllowlist).not.toContain("bash");
        });

        it("dream, distill, and checkpoint-writer are hidden; explore is not", () => {
            expect(get("explore")?.hidden).toBeFalsy();
            expect(get("dream")?.hidden).toBe(true);
            expect(get("distill")?.hidden).toBe(true);
            expect(get("checkpoint-writer")?.hidden).toBe(true);
        });

        it("general is no longer registered", () => {
            expect(get("general")).toBeUndefined();
        });
    });

    describe("listSpawnable", () => {
        it("returns only non-hidden types (explore only)", () => {
            const list = listSpawnable();
            const names = list.map((s) => s.name).sort();
            expect(names).toEqual(["explore"]);
        });

        it("excludes dream, distill, and checkpoint-writer", () => {
            const names = listSpawnable().map((s) => s.name);
            expect(names).not.toContain("dream");
            expect(names).not.toContain("distill");
            expect(names).not.toContain("checkpoint-writer");
        });
    });

    describe("listAll", () => {
        it("returns all 4 types including hidden ones", () => {
            expect(listAll()).toHaveLength(4);
        });
    });

    describe("get", () => {
        it("returns the full record for a known name", () => {
            const dream = get("dream");
            expect(dream).toBeDefined();
            expect(dream?.name).toBe("dream");
            expect(dream?.hidden).toBe(true);
            expect(dream?.prompt).toContain("Dream: Memory Consolidation");
            expect(dream?.toolAllowlist).toEqual(["read", "glob", "grep"]);
        });

        it("returns the full record for checkpoint-writer (Task 5)", () => {
            const cw = get("checkpoint-writer");
            expect(cw).toBeDefined();
            expect(cw?.name).toBe("checkpoint-writer");
            expect(cw?.hidden).toBe(true);
            expect(cw?.toolAllowlist).toEqual(["read", "glob", "grep", "write", "edit"]);
        });

        it("returns undefined for an unknown name", () => {
            expect(get("nonexistent")).toBeUndefined();
        });

        it("returns undefined for empty string", () => {
            expect(get("")).toBeUndefined();
        });

        it("returns undefined for the removed 'general' type", () => {
            expect(get("general")).toBeUndefined();
        });
    });

    describe("isSpawnable", () => {
        it("returns true only for explore (the only non-hidden type)", () => {
            expect(isSpawnable("explore")).toBe(true);
        });

        it("returns false for hidden types (dream / distill / checkpoint-writer)", () => {
            expect(isSpawnable("dream")).toBe(false);
            expect(isSpawnable("distill")).toBe(false);
            expect(isSpawnable("checkpoint-writer")).toBe(false);
        });

        it("returns false for unknown names", () => {
            expect(isSpawnable("nonexistent")).toBe(false);
            expect(isSpawnable("")).toBe(false);
        });

        it("returns false for the removed 'general' type", () => {
            expect(isSpawnable("general")).toBe(false);
        });
    });

    describe("prompt content", () => {
        it("dream prompt references memoryWrite and sessionSummary tools (Pi Desktop adaptation)", () => {
            const dream = get("dream");
            expect(dream?.prompt).toContain("memoryWrite");
            expect(dream?.prompt).toContain("sessionSummarySearch");
            expect(dream?.prompt).toContain("sessionSummaryGet");
            // Adapted: no mimocode.db references
            expect(dream?.prompt).not.toContain("mimocode.db");
            expect(dream?.prompt).not.toContain("bash + SQLite");
        });

        it("distill prompt references asset inventory tools and shortlist output", () => {
            const distill = get("distill");
            expect(distill?.prompt).toContain("skillList");
            expect(distill?.prompt).toContain("commandList");
            expect(distill?.prompt).toContain("Shortlist:");
        });

        it("explore prompt enforces read-only and cites file:line", () => {
            const explore = get("explore");
            expect(explore?.prompt).toContain("read-only");
            expect(explore?.prompt).toContain("file paths and line numbers");
            // Phase E audit: explore prompt must not advertise bash
            expect(explore?.prompt).not.toContain("bash");
        });

        it("checkpoint-writer prompt targets sessions/<sessionId>/checkpoint.md (Task 5)", () => {
            const cw = get("checkpoint-writer");
            // Write target must be the per-session checkpoint path.
            expect(cw?.prompt).toContain("sessions/<sessionId>/checkpoint.md");
            // Must enforce the verbatim-user-quote invariant for §1.
            expect(cw?.prompt).toContain("verbatim");
            // Must forbid executing other tasks (focused role).
            expect(cw?.prompt).toContain("Do NOT execute any task other than checkpoint writing");
            // Must reference the memory-path-guard (write authority source).
            expect(cw?.prompt).toContain("memory-path-guard");
            // Phase E audit: must not advertise bash.
            expect(cw?.prompt).not.toContain("bash");
        });
    });
});

// wave-230 residual
describe("SubagentRegistry residual (wave-230)", () => {
    it("listAll names are unique and equal BUILTIN_SUBAGENTS names", () => {
        const all = listAll().map((s) => s.name).sort();
        const builtin = BUILTIN_SUBAGENTS.map((s) => s.name).sort();
        expect(all).toEqual(builtin);
        expect(new Set(all).size).toBe(all.length);
    });

    it("listSpawnable is a strict subset of listAll (explore only)", () => {
        const all = new Set(listAll().map((s) => s.name));
        const spawnable = listSpawnable().map((s) => s.name);
        expect(spawnable).toEqual(["explore"]);
        expect(spawnable.every((n) => all.has(n))).toBe(true);
        expect(isSpawnable("explore")).toBe(true);
        for (const hidden of ["dream", "distill", "checkpoint-writer"]) {
            expect(isSpawnable(hidden)).toBe(false);
            expect(get(hidden)?.hidden).toBe(true);
        }
    });

    it("every prompt is multi-line and free of mimocode.db references", () => {
        for (const sub of listAll()) {
            expect(sub.prompt.split("\n").length).toBeGreaterThan(1);
            expect(sub.prompt).not.toContain("mimocode.db");
            expect(sub.description.trim().length).toBeGreaterThan(0);
        }
    });
});

