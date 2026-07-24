import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTaskId } from "../task-id";

describe("nextTaskId", () => {
    let db: DatabaseSync;
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "pi-task-id-"));
        db = new DatabaseSync(join(dir, "test.db"));
        db.exec("PRAGMA foreign_keys = ON;");
        db.exec(`
            CREATE TABLE task (
                id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                parent_task_id TEXT,
                status TEXT NOT NULL,
                summary TEXT NOT NULL,
                owner TEXT,
                created_at INTEGER NOT NULL,
                last_event_at INTEGER NOT NULL,
                ended_at INTEGER,
                cleanup_after INTEGER,
                source TEXT,
                workspace_id TEXT,
                agent_id TEXT,
                agent_key TEXT,
                ordinal INTEGER,
                PRIMARY KEY (session_id, id)
            );
        `);
    });

    afterEach(() => {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    });

    function insertTask(id: string, parentId?: string): void {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, "session-1", parentId ?? null, "open", `task ${id}`, now, now);
    }

    it("returns T1 for top-level allocation on an empty table", () => {
        expect(nextTaskId(db, "session-1")).toBe("T1");
    });

    it("returns T6 when top-level tasks T1, T2, T5 exist (skips missing T3/T4)", () => {
        insertTask("T1");
        insertTask("T2");
        insertTask("T5");
        expect(nextTaskId(db, "session-1")).toBe("T6");
    });

    it("ignores sub-tasks (T1.1, T1.2) when allocating a top-level ID", () => {
        insertTask("T1.1", "T1");
        insertTask("T1.2", "T1");
        expect(nextTaskId(db, "session-1")).toBe("T1");
    });

    it("returns T1.1 when parent T1 has no children", () => {
        insertTask("T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.1");
    });

    it("returns T1.4 when T1.1 and T1.3 exist as children of T1", () => {
        insertTask("T1");
        insertTask("T1.1", "T1");
        insertTask("T1.3", "T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.4");
    });

    it("returns T1.1 when parent T1 exists with no children, even with other top-level tasks present", () => {
        insertTask("T1");
        insertTask("T2");
        insertTask("T3");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.1");
    });

    it.each([
        ["t1"],     // lowercase 't' is rejected
        ["T"],      // missing digits
        ["T1."],    // trailing dot with no following digits
        ["T1.x"],   // non-digit segment
        [""],       // empty string
    ])("throws on invalid parentId format: %j", (parentId) => {
        expect(() => nextTaskId(db, "session-1", parentId)).toThrow(`Invalid task ID: ${parentId}`);
    });

    it("accepts deeply nested parentId T1.1.2.3.4 (valid format) and returns T1.1.2.3.4.1", () => {
        // Format /^T\d+(\.\d+)*$/ accepts arbitrarily deep nesting. Per the
        // algorithm spec, sub-task allocation appends a new segment, so the
        // first child of T1.1.2.3.4 is T1.1.2.3.4.1 (not T1.1.2.3.5, which
        // would be a sibling of T1.1.2.3.4).
        insertTask("T1.1.2.3.4");
        expect(nextTaskId(db, "session-1", "T1.1.2.3.4")).toBe("T1.1.2.3.4.1");
    });

    it("throws when parent task does not exist: T99", () => {
        expect(() => nextTaskId(db, "session-1", "T99")).toThrow("Parent task not found: T99");
    });

    it("allocates IDs correctly across a mixed top-level + sub-task flow", () => {
        // T1 (top-level)
        const t1 = nextTaskId(db, "session-1");
        expect(t1).toBe("T1");
        insertTask(t1);

        // T1.1 (sub-task of T1)
        const t1_1 = nextTaskId(db, "session-1", "T1");
        expect(t1_1).toBe("T1.1");
        insertTask(t1_1, "T1");

        // T1.2 (sub-task of T1)
        const t1_2 = nextTaskId(db, "session-1", "T1");
        expect(t1_2).toBe("T1.2");
        insertTask(t1_2, "T1");

        // T2 (top-level) — T1.1, T1.2 must not influence this allocation
        const t2 = nextTaskId(db, "session-1");
        expect(t2).toBe("T2");
        insertTask(t2);

        // T2.1 (sub-task of T2)
        const t2_1 = nextTaskId(db, "session-1", "T2");
        expect(t2_1).toBe("T2.1");
        insertTask(t2_1, "T2");
    });

    // wave-138 residual
    it("scopes allocation per session_id (other sessions do not advance counters)", () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("T9", "session-other", null, "open", "other", now, now);
        expect(nextTaskId(db, "session-1")).toBe("T1");
        insertTask("T1");
        expect(nextTaskId(db, "session-other")).toBe("T10");
    });

    it("treats explicit null parentId like top-level allocation", () => {
        insertTask("T3");
        expect(nextTaskId(db, "session-1", null as unknown as undefined)).toBe("T4");
    });

    it("ignores child rows whose id does not start with parentId. prefix", () => {
        insertTask("T1");
        // orphan-looking id under parent_task_id but wrong prefix — skipped by startsWith
        insertTask("T2.1", "T1");
        insertTask("T1.2", "T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.3");
    });

    it("parses multi-digit top-level and child segments", () => {
        insertTask("T12");
        expect(nextTaskId(db, "session-1")).toBe("T13");
        insertTask("T12.10", "T12");
        expect(nextTaskId(db, "session-1", "T12")).toBe("T12.11");
    });

    it("throws Parent task not found when parent exists only in another session", () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("T1", "session-other", null, "open", "other", now, now);
        expect(() => nextTaskId(db, "session-1", "T1")).toThrow("Parent task not found: T1");
    });

    // wave-164 residual
    it("skips malformed top-level ids that do not match /^T(\\d+)/ when finding max", () => {
        insertTask("TX");
        insertTask("note");
        insertTask("T2");
        expect(nextTaskId(db, "session-1")).toBe("T3");
    });

    it("skips non-numeric child suffixes under parent prefix when finding max", () => {
        insertTask("T1");
        insertTask("T1.x", "T1");
        insertTask("T1.2", "T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.3");
    });

    it("does not treat T1.10 as higher than T1.2 when parsing suffix as integer (max uses parseInt)", () => {
        // product uses parseInt on the full suffix after parentId.; "10" > "2"
        insertTask("T1");
        insertTask("T1.2", "T1");
        insertTask("T1.10", "T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.11");
    });

    it("accepts parentId with multi-digit segments and allocates next sibling", () => {
        insertTask("T10.20");
        insertTask("T10.20.1", "T10.20");
        insertTask("T10.20.3", "T10.20");
        expect(nextTaskId(db, "session-1", "T10.20")).toBe("T10.20.4");
    });

    it.each([
        ["T1..2"],
        ["1.2"],
        ["T1.2."],
        ["TT1"],
    ])("throws Invalid task ID for parentId %j", (parentId) => {
        expect(() => nextTaskId(db, "session-1", parentId)).toThrow(`Invalid task ID: ${parentId}`);
    });

    // wave-224 residual
    it("allocates T1 when session empty; ignores other session ids", () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("T9", "other-session", null, "open", "task T9", now, now);
        expect(nextTaskId(db, "session-1")).toBe("T1");
        insertTask("T1");
        expect(nextTaskId(db, "session-1")).toBe("T2");
    });

    it("null parentId same as undefined top-level allocation", () => {
        insertTask("T3");
        expect(nextTaskId(db, "session-1", null as never)).toBe("T4");
        expect(nextTaskId(db, "session-1", undefined)).toBe("T4");
    });

    it("throws Parent task not found for valid-shaped missing parent", () => {
        expect(() => nextTaskId(db, "session-1", "T99")).toThrow("Parent task not found: T99");
        insertTask("T99");
        expect(nextTaskId(db, "session-1", "T99")).toBe("T99.1");
    });

    // wave-234 residual
    it("top-level max ignores dotted ids even when parent_task_id is null", () => {
        insertTask("T1.1"); // dotted id at top-level row shape
        insertTask("T2");
        // product top-level regex /^T(\d+)$/ — T1.1 skipped, max is 2 → T3
        expect(nextTaskId(db, "session-1")).toBe("T3");
    });

    it("child allocation under parent with only deeper nested cousins", () => {
        insertTask("T1");
        insertTask("T1.1", "T1");
        insertTask("T1.1.1", "T1.1");
        // next child of T1 looks at ids starting with "T1." one segment
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.2");
        expect(nextTaskId(db, "session-1", "T1.1")).toBe("T1.1.2");
    });

    it("T0 and leading zeros parse as integers for max", () => {
        insertTask("T0");
        expect(nextTaskId(db, "session-1")).toBe("T1");
        insertTask("T01"); // parseInt("01")=1, max still 1 if T0 present → T2 after T0 max 0 then T01? 
        // existing: T0 → max 0; insert T01 as id — parseInt of full match for /^T(\d+)$/ on "T01" is 1 → max 1 → T2
        expect(nextTaskId(db, "session-1")).toBe("T2");
    });


    // wave-291 residual
    it("session isolation: max only considers same session_id rows", () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("T9", "other-session", null, "open", "x", now, now);
        insertTask("T1");
        expect(nextTaskId(db, "session-1")).toBe("T2");
        expect(nextTaskId(db, "other-session")).toBe("T10");
    });

    it("invalid parentId pattern throws; empty parent-like strings invalid", () => {
        expect(() => nextTaskId(db, "session-1", "bad")).toThrow("Invalid task ID: bad");
        expect(() => nextTaskId(db, "session-1", "T")).toThrow("Invalid task ID: T");
        expect(() => nextTaskId(db, "session-1", "1")).toThrow("Invalid task ID: 1");
        expect(() => nextTaskId(db, "session-1", "T1.")).toThrow("Invalid task ID: T1.");
        insertTask("T1");
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.1");
        insertTask("T1.1", "T1");
        insertTask("T1.3", "T1");
        // max child segment 3 → next T1.4 (gap-filling not performed)
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.4");
    });



    // wave-301 residual
    it("top-level ignores non-matching ids; first allocation T1 when only subtasks exist under null parent filter", () => {
        insertTask("T1");
        insertTask("T1.1", "T1");
        // top-level rows only: T1 → next T2
        expect(nextTaskId(db, "session-1")).toBe("T2");
        // child max under T1 is 1 → T1.2
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.2");
    });

    it("parent validation pattern /^T\\d+(\\.\\d+)*$/; parent must exist in same session", () => {
        expect(() => nextTaskId(db, "session-1", "Task1")).toThrow("Invalid task ID: Task1");
        expect(() => nextTaskId(db, "session-1", "T1.2.x")).toThrow("Invalid task ID: T1.2.x");
        insertTask("T5");
        expect(nextTaskId(db, "session-1", "T5")).toBe("T5.1");
        insertTask("T5.1", "T5");
        insertTask("T5.9", "T5");
        expect(nextTaskId(db, "session-1", "T5")).toBe("T5.10");
        expect(() => nextTaskId(db, "session-1", "T6")).toThrow("Parent task not found: T6");
    });

    it("undefined parent is top-level; multi-digit and gap max", () => {
        insertTask("T2");
        insertTask("T10");
        expect(nextTaskId(db, "session-1")).toBe("T11");
        insertTask("T11");
        expect(nextTaskId(db, "session-1", undefined)).toBe("T12");
    });


    // wave-316 residual
    it("child max uses parseInt prefix of suffix; non-numeric suffixes ignored", () => {
        insertTask("T1");
        insertTask("T1.2", "T1");
        insertTask("T1.2a", "T1"); // parseInt("2a") === 2, does not raise max beyond 2
        insertTask("T1.x", "T1"); // NaN → ignored
        expect(nextTaskId(db, "session-1", "T1")).toBe("T1.3");
    });

    it("deep parent sibling allocation and invalid dotted tail", () => {
        insertTask("T2");
        insertTask("T2.1", "T2");
        insertTask("T2.1.1", "T2.1");
        expect(nextTaskId(db, "session-1", "T2.1")).toBe("T2.1.2");
        expect(nextTaskId(db, "session-1", "T2")).toBe("T2.2");
        expect(() => nextTaskId(db, "session-1", "T2.1.")).toThrow("Invalid task ID: T2.1.");
        expect(() => nextTaskId(db, "session-1", "T2..1")).toThrow("Invalid task ID: T2..1");
    });

    it("null parentId is top-level; empty session still T1 after foreign session rows", () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO task (id, session_id, parent_task_id, status, summary, created_at, last_event_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run("T99", "foreign", null, "open", "x", now, now);
        expect(nextTaskId(db, "session-1", null as never)).toBe("T1");
        insertTask("T1");
        expect(nextTaskId(db, "session-1", null as never)).toBe("T2");
    });


});
