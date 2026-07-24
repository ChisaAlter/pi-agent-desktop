import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { LongHorizonDatabase } from "../database";
import { TaskRegistry } from "../task-registry";
import type { TaskEventKind } from "../task-registry";

interface TaskEventRow {
    id: number;
    session_id: string;
    task_id: string;
    at: number;
    kind: string;
    summary: string | null;
}

describe("TaskRegistry", () => {
    const dirs: string[] = [];
    const databases: LongHorizonDatabase[] = [];

    afterEach(async () => {
        for (const db of databases.splice(0)) {
            await db.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createRegistry(): { registry: TaskRegistry; db: LongHorizonDatabase; dir: string } {
        const dir = mkdtempSync(join(tmpdir(), "pi-task-registry-"));
        dirs.push(dir);
        const db = new LongHorizonDatabase(dir);
        databases.push(db);
        return { registry: new TaskRegistry(db), db, dir };
    }

    function openRaw(db: LongHorizonDatabase): {
        events: (where?: string, params?: unknown[]) => TaskEventRow[];
        tasks: (where?: string, params?: unknown[]) => Array<Record<string, unknown>>;
        close: () => void;
    } {
        const raw = new DatabaseSync(db.path);
        raw.exec("PRAGMA foreign_keys = ON;");
        return {
            events: (where?: string, params?: unknown[]) => {
                const sql = where
                    ? `SELECT * FROM task_event WHERE ${where} ORDER BY id ASC`
                    : "SELECT * FROM task_event ORDER BY id ASC";
                return raw.prepare(sql).all(...(params ?? [])) as TaskEventRow[];
            },
            tasks: (where?: string, params?: unknown[]) => {
                const sql = where
                    ? `SELECT * FROM task WHERE ${where} ORDER BY id ASC`
                    : "SELECT * FROM task ORDER BY id ASC";
                return raw.prepare(sql).all(...(params ?? [])) as Array<Record<string, unknown>>;
            },
            close: () => raw.close(),
        };
    }

    function eventKinds(events: TaskEventRow[]): TaskEventKind[] {
        return events.map((e) => e.kind as TaskEventKind);
    }

    describe("create", () => {
        it("creates a top-level task with auto-allocated T1 id and a 'created' event", async () => {
            const { registry, db } = createRegistry();
            const before = Date.now();
            const record = await registry.create({ sessionId: "s1", summary: "build feature" });
            const after = Date.now();

            expect(record.id).toBe("T1");
            expect(record.sessionId).toBe("s1");
            expect(record.parentTaskId).toBeUndefined();
            expect(record.status).toBe("open");
            expect(record.summary).toBe("build feature");
            expect(record.owner).toBeUndefined();
            expect(record.endedAt).toBeUndefined();
            expect(record.cleanupAfter).toBeUndefined();
            expect(record.createdAt).toBeGreaterThanOrEqual(before);
            expect(record.createdAt).toBeLessThanOrEqual(after);
            expect(record.lastEventAt).toBe(record.createdAt);

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(events).toHaveLength(1);
                expect(events[0].kind).toBe("created");
                expect(events[0].summary).toBe("build feature");
                expect(events[0].at).toBe(record.createdAt);
            } finally {
                raw.close();
            }
        });

        it("creates a sub-task with parent and a 'created' event", async () => {
            const { registry, db } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "parent" });
            const sub = await registry.create({ sessionId: "s1", summary: "child", parentId: "T1" });

            expect(sub.id).toBe("T1.1");
            expect(sub.parentTaskId).toBe("T1");
            expect(sub.status).toBe("open");

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1.1"]);
                expect(events).toHaveLength(1);
                expect(events[0].kind).toBe("created");
            } finally {
                raw.close();
            }
        });

        it("allocates sequential T1, T2, T3 ids across sessions independently", async () => {
            const { registry } = createRegistry();
            const t1 = await registry.create({ sessionId: "s1", summary: "a" });
            const t2 = await registry.create({ sessionId: "s1", summary: "b" });
            const other = await registry.create({ sessionId: "s2", summary: "x" });
            expect(t1.id).toBe("T1");
            expect(t2.id).toBe("T2");
            expect(other.id).toBe("T1");
        });

        it("stores owner when provided", async () => {
            const { registry } = createRegistry();
            const record = await registry.create({
                sessionId: "s1",
                summary: "owned",
                owner: "agent-7",
            });
            expect(record.owner).toBe("agent-7");
        });

        it("rolls back the insert when nextTaskId throws (invalid parent)", async () => {
            const { registry, db } = createRegistry();
            await expect(
                registry.create({ sessionId: "s1", summary: "bad parent", parentId: "garbage" }),
            ).rejects.toThrow("Invalid task ID: garbage");

            const raw = openRaw(db);
            try {
                expect(raw.tasks()).toEqual([]);
                expect(raw.events()).toEqual([]);
            } finally {
                raw.close();
            }
        });
    });

    describe("list", () => {
        it("excludes terminal tasks by default", async () => {
            const { registry } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "open-1" });
            const toFinish = await registry.create({ sessionId: "s1", summary: "to-finish" });
            const toAbandon = await registry.create({ sessionId: "s1", summary: "to-abandon" });
            await registry.done({ sessionId: "s1", id: toFinish.id });
            await registry.abandon({ sessionId: "s1", id: toAbandon.id });

            const result = await registry.list({ sessionId: "s1" });
            expect(result.map((t) => t.summary)).toEqual(["open-1"]);
        });

        it("includes terminal tasks when includeTerminal=true", async () => {
            const { registry } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "open-1" });
            const toFinish = await registry.create({ sessionId: "s1", summary: "to-finish" });
            await registry.done({ sessionId: "s1", id: toFinish.id });

            const result = await registry.list({ sessionId: "s1", includeTerminal: true });
            expect(result.map((t) => t.summary)).toEqual(["open-1", "to-finish"]);
        });

        it("filters by status when status option is provided", async () => {
            const { registry } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "open-1" });
            const started = await registry.create({ sessionId: "s1", summary: "started" });
            await registry.start({ sessionId: "s1", id: started.id });

            const inProgress = await registry.list({
                sessionId: "s1",
                status: "in_progress",
                includeTerminal: true,
            });
            expect(inProgress).toHaveLength(1);
            expect(inProgress[0].summary).toBe("started");
        });

        it("excludes archived tasks (cleanup_after < now) by default", async () => {
            const { registry, db } = createRegistry();
            const archived = await registry.create({ sessionId: "s1", summary: "archived" });
            // Mark the task as archived by setting cleanup_after to the past.
            db.getDb()
                .prepare("UPDATE task SET cleanup_after = ? WHERE session_id = ? AND id = ?")
                .run(1, "s1", archived.id);

            const result = await registry.list({ sessionId: "s1", includeTerminal: true });
            expect(result.map((t) => t.summary)).toEqual([]);

            const withArchive = await registry.list({
                sessionId: "s1",
                includeTerminal: true,
                includeArchived: true,
            });
            expect(withArchive.map((t) => t.summary)).toEqual(["archived"]);
        });

        it("isolates sessions", async () => {
            const { registry } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "s1 task" });
            await registry.create({ sessionId: "s2", summary: "s2 task" });
            const s1 = await registry.list({ sessionId: "s1", includeTerminal: true });
            const s2 = await registry.list({ sessionId: "s2", includeTerminal: true });
            expect(s1.map((t) => t.summary)).toEqual(["s1 task"]);
            expect(s2.map((t) => t.summary)).toEqual(["s2 task"]);
        });
    });

    describe("get", () => {
        it("returns the TaskRecord when found", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "find-me" });
            const fetched = await registry.get("s1", created.id);
            expect(fetched).toEqual(created);
        });

        it("returns null when the task does not exist", async () => {
            const { registry } = createRegistry();
            const fetched = await registry.get("s1", "T99");
            expect(fetched).toBeNull();
        });

        it("returns null for a different session with the same id", async () => {
            const { registry } = createRegistry();
            await registry.create({ sessionId: "s1", summary: "in s1" });
            const fetched = await registry.get("s2", "T1");
            expect(fetched).toBeNull();
        });
    });

    describe("start", () => {
        it("transitions open → in_progress and inserts a 'started' event", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "start me" });
            const started = await registry.start({ sessionId: "s1", id: created.id });

            expect(started.status).toBe("in_progress");
            expect(started.lastEventAt).toBeGreaterThan(created.lastEventAt);

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "started"]);
            } finally {
                raw.close();
            }
        });

        it("is idempotent on in_progress (no event inserted, no status change)", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "idem" });
            await registry.start({ sessionId: "s1", id: created.id });

            const beforeRaw = openRaw(db);
            const eventsBefore = beforeRaw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
            beforeRaw.close();

            const started = await registry.start({ sessionId: "s1", id: created.id });
            expect(started.status).toBe("in_progress");

            const raw = openRaw(db);
            try {
                const eventsAfter = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventsAfter).toHaveLength(eventsBefore.length);
                expect(eventKinds(eventsAfter)).toEqual(["created", "started"]);
            } finally {
                raw.close();
            }
        });

        it("updates owner when provided while starting", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "owned" });
            const started = await registry.start({
                sessionId: "s1",
                id: created.id,
                owner: "agent-1",
            });
            expect(started.owner).toBe("agent-1");
        });

        it("transitions blocked → in_progress and inserts a 'started' event", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "blocked" });
            await registry.block({ sessionId: "s1", id: created.id });
            const started = await registry.start({ sessionId: "s1", id: created.id });
            expect(started.status).toBe("in_progress");
        });

        it("throws when starting a done task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "done" });
            await registry.done({ sessionId: "s1", id: created.id });
            await expect(registry.start({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: done",
            );
        });

        it("throws when starting an abandoned task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "abandoned" });
            await registry.abandon({ sessionId: "s1", id: created.id });
            await expect(registry.start({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: abandoned",
            );
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(registry.start({ sessionId: "s1", id: "T99" })).rejects.toThrow(
                "Task not found: T99",
            );
        });
    });

    describe("block", () => {
        it("transitions open → blocked and inserts a 'blocked' event", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "block me" });
            const blocked = await registry.block({ sessionId: "s1", id: created.id });
            expect(blocked.status).toBe("blocked");

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "blocked"]);
            } finally {
                raw.close();
            }
        });

        it("transitions in_progress → blocked", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "block running" });
            await registry.start({ sessionId: "s1", id: created.id });
            const blocked = await registry.block({ sessionId: "s1", id: created.id });
            expect(blocked.status).toBe("blocked");
        });

        it("throws when blocking a done task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "done" });
            await registry.done({ sessionId: "s1", id: created.id });
            await expect(registry.block({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: done",
            );
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(registry.block({ sessionId: "s1", id: "T99" })).rejects.toThrow(
                "Task not found: T99",
            );
        });
    });

    describe("unblock", () => {
        it("transitions blocked → in_progress and inserts an 'unblocked' event", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "unblock me" });
            await registry.block({ sessionId: "s1", id: created.id });
            const unblocked = await registry.unblock({ sessionId: "s1", id: created.id });
            expect(unblocked.status).toBe("in_progress");

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "blocked", "unblocked"]);
            } finally {
                raw.close();
            }
        });

        it("throws when unblocking a task that is not blocked (current: open)", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "open" });
            await expect(registry.unblock({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is not blocked (current: open)",
            );
        });

        it("throws when unblocking an in_progress task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "running" });
            await registry.start({ sessionId: "s1", id: created.id });
            await expect(registry.unblock({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is not blocked (current: in_progress)",
            );
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(registry.unblock({ sessionId: "s1", id: "T99" })).rejects.toThrow(
                "Task not found: T99",
            );
        });
    });

    describe("done", () => {
        it("transitions open → done and sets ended_at", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "finish me" });
            const before = Date.now();
            const done = await registry.done({ sessionId: "s1", id: created.id });
            const after = Date.now();
            expect(done.status).toBe("done");
            expect(done.endedAt).toBeGreaterThanOrEqual(before);
            expect(done.endedAt).toBeLessThanOrEqual(after);
            expect(done.lastEventAt).toBe(done.endedAt);

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "done"]);
            } finally {
                raw.close();
            }
        });

        it("throws when completing a done task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "done twice" });
            await registry.done({ sessionId: "s1", id: created.id });
            await expect(registry.done({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: done",
            );
        });

        it("throws when completing an abandoned task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "abandoned then done" });
            await registry.abandon({ sessionId: "s1", id: created.id });
            await expect(registry.done({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: abandoned",
            );
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(registry.done({ sessionId: "s1", id: "T99" })).rejects.toThrow(
                "Task not found: T99",
            );
        });
    });

    describe("abandon", () => {
        it("transitions open → abandoned and sets ended_at", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "abandon me" });
            const before = Date.now();
            const abandoned = await registry.abandon({ sessionId: "s1", id: created.id });
            const after = Date.now();
            expect(abandoned.status).toBe("abandoned");
            expect(abandoned.endedAt).toBeGreaterThanOrEqual(before);
            expect(abandoned.endedAt).toBeLessThanOrEqual(after);

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "abandoned"]);
            } finally {
                raw.close();
            }
        });

        it("throws when abandoning a done task", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "done then abandoned" });
            await registry.done({ sessionId: "s1", id: created.id });
            await expect(registry.abandon({ sessionId: "s1", id: created.id })).rejects.toThrow(
                "Task T1 is in terminal state: done",
            );
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(registry.abandon({ sessionId: "s1", id: "T99" })).rejects.toThrow(
                "Task not found: T99",
            );
        });
    });

    describe("rename", () => {
        it("updates the summary and inserts a 'renamed' event with the new summary", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "old name" });
            const renamed = await registry.rename({
                sessionId: "s1",
                id: created.id,
                summary: "new name",
            });
            expect(renamed.summary).toBe("new name");
            expect(renamed.id).toBe(created.id);
            expect(renamed.status).toBe("open");

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(events).toHaveLength(2);
                expect(events[1].kind).toBe("renamed");
                expect(events[1].summary).toBe("new name");
            } finally {
                raw.close();
            }
        });

        it("can rename a terminal task (rename allowed in any state)", async () => {
            const { registry } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "done task" });
            await registry.done({ sessionId: "s1", id: created.id });
            const renamed = await registry.rename({
                sessionId: "s1",
                id: created.id,
                summary: "renamed done",
            });
            expect(renamed.summary).toBe("renamed done");
            expect(renamed.status).toBe("done");
        });

        it("throws when the task does not exist", async () => {
            const { registry } = createRegistry();
            await expect(
                registry.rename({ sessionId: "s1", id: "T99", summary: "ghost" }),
            ).rejects.toThrow("Task not found: T99");
        });
    });

    describe("event flow", () => {
        it("records one event per state transition: created → started → blocked → unblocked → done", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "flow" });
            await registry.start({ sessionId: "s1", id: created.id });
            await registry.block({ sessionId: "s1", id: created.id });
            await registry.unblock({ sessionId: "s1", id: created.id });
            await registry.done({ sessionId: "s1", id: created.id });

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(events).toHaveLength(5);
                expect(eventKinds(events)).toEqual([
                    "created",
                    "started",
                    "blocked",
                    "unblocked",
                    "done",
                ]);
                // `at` timestamps should be non-decreasing across events.
                for (let i = 1; i < events.length; i++) {
                    expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
                }
            } finally {
                raw.close();
            }
        });

        it("records one event per state transition: created → started → abandoned", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "fail flow" });
            await registry.start({ sessionId: "s1", id: created.id });
            await registry.abandon({ sessionId: "s1", id: created.id });

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                expect(events).toHaveLength(3);
                expect(eventKinds(events)).toEqual(["created", "started", "abandoned"]);
            } finally {
                raw.close();
            }
        });

        it("creates independent event streams per task (sub-task events do not pollute parent)", async () => {
            const { registry, db } = createRegistry();
            const parent = await registry.create({ sessionId: "s1", summary: "parent" });
            await registry.create({
                sessionId: "s1",
                summary: "child",
                parentId: parent.id,
            });

            const raw = openRaw(db);
            try {
                const parentEvents = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                const childEvents = raw.events("session_id = ? AND task_id = ?", ["s1", "T1.1"]);
                expect(parentEvents).toHaveLength(1);
                expect(childEvents).toHaveLength(1);
                expect(parentEvents[0].kind).toBe("created");
                expect(childEvents[0].kind).toBe("created");
            } finally {
                raw.close();
            }
        });
    });

    describe("transaction rollback on failure", () => {
        it("leaves task and task_event untouched when a state transition throws", async () => {
            const { registry, db } = createRegistry();
            const created = await registry.create({ sessionId: "s1", summary: "rollback me" });
            await registry.done({ sessionId: "s1", id: created.id });

            // Attempt an invalid transition — should throw and roll back.
            await expect(registry.start({ sessionId: "s1", id: created.id })).rejects.toThrow();

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s1", "T1"]);
                // Only the created + done events should be present; no 'started'.
                expect(eventKinds(events)).toEqual(["created", "done"]);
                const taskRow = raw.tasks("session_id = ? AND id = ?", ["s1", "T1"])[0];
                expect(taskRow?.status).toBe("done");
            } finally {
                raw.close();
            }
        });
    });

    describe("TaskService legacy interop", () => {
        it("exposes the registry via getRegistry()", async () => {
            const { TaskService } = await import("../task-service");
            const { db } = createRegistry();
            const service = new TaskService(db);
            const registry = service.getRegistry();
            expect(registry).toBeInstanceOf(TaskRegistry);
            const created = await service.createTask({ sessionId: "s1", summary: "via service" });
            expect(created.id).toBe("T1");
            expect(await service.getTask("s1", "T1")).toEqual(created);
        });
    });

    describe("residual list/archive and lifecycle edges", () => {
        it("lists empty session as [] and includes archived when requested", async () => {
            const { registry, db } = createRegistry();
            expect(await registry.list({ sessionId: "empty" })).toEqual([]);

            const created = await registry.create({ sessionId: "s-arch", summary: "archive me" });
            await registry.done({ sessionId: "s-arch", id: created.id });
            db.getDb()
                .prepare("UPDATE task SET cleanup_after = ? WHERE session_id = ? AND id = ?")
                .run(1, "s-arch", created.id);

            const hidden = await registry.list({ sessionId: "s-arch", includeTerminal: true });
            expect(hidden).toHaveLength(0);

            const shown = await registry.list({
                sessionId: "s-arch",
                includeTerminal: true,
                includeArchived: true,
            });
            expect(shown).toHaveLength(1);
            expect(shown[0].id).toBe(created.id);
            expect(shown[0].status).toBe("done");
        });

        it("start with eventSummary and block→done keep event stream coherent", async () => {
            const { registry, db } = createRegistry();
            const t = await registry.create({ sessionId: "s-flow", summary: "flow" });
            await registry.start({ sessionId: "s-flow", id: t.id, eventSummary: "kickoff" });
            await registry.block({ sessionId: "s-flow", id: t.id, eventSummary: "waiting" });
            await registry.done({ sessionId: "s-flow", id: t.id, eventSummary: "shipped" });

            const raw = openRaw(db);
            try {
                const events = raw.events("session_id = ? AND task_id = ?", ["s-flow", "T1"]);
                expect(eventKinds(events)).toEqual(["created", "started", "blocked", "done"]);
                expect(events[1].summary).toBe("kickoff");
                expect(events[2].summary).toBe("waiting");
                expect(events[3].summary).toBe("shipped");
            } finally {
                raw.close();
            }

            const done = await registry.get("s-flow", "T1");
            expect(done?.status).toBe("done");
            expect(done?.endedAt).toBeTypeOf("number");
        });
    });
});
