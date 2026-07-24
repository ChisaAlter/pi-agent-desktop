import { describe, expect, it } from "vitest";
import {
  normalizeToolCallForPersistence,
  normalizeToolCallForRuntime,
  normalizeToolCallsForPersistence,
  normalizeToolCallsForRuntime,
  readToolCallId,
  readToolCallInput,
  readToolCallIsError,
  readToolCallName,
  readToolCallOutput,
} from "../tool-call";

describe("tool-call SDK event readers", () => {
  it("reads a tool call from partial.content at contentIndex", () => {
    const event = {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        content: [
          { type: "text", text: "starting" },
          {
            type: "toolCall",
            id: "tc_partial",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
      },
    };

    expect(readToolCallId(event)).toBe("tc_partial");
    expect(readToolCallName(event)).toBe("read");
    expect(readToolCallInput(event)).toEqual({ path: "README.md" });
  });

  it("reads a completed tool call from the top-level toolCall field", () => {
    const event = {
      type: "toolcall_end",
      toolCall: {
        type: "toolCall",
        id: "tc_complete",
        name: "bash",
        arguments: { command: "pwd" },
      },
    };

    expect(readToolCallId(event)).toBe("tc_complete");
    expect(readToolCallName(event)).toBe("bash");
    expect(readToolCallInput(event)).toEqual({ command: "pwd" });
  });

  it("reads output and error flags from completed payloads", () => {
    expect(readToolCallOutput({ output: "ok" })).toBe("ok");
    expect(readToolCallOutput({ result: { text: "r" } })).toEqual({ text: "r" });
    expect(readToolCallIsError({ isError: true })).toBe(true);
    // status "error" normalizes to error → isError true
    expect(readToolCallIsError({ status: "error" })).toBe(true);
    expect(readToolCallIsError({ status: "completed" })).toBe(false);
    expect(readToolCallIsError({})).toBe(false);
  });

  // wave-109 residual
  it("prefers toolCallId over id and toolName over name", () => {
    expect(
      readToolCallId({ toolCallId: "preferred", id: "secondary" }),
    ).toBe("preferred");
    expect(
      readToolCallName({ toolName: "bash", name: "shell" }),
    ).toBe("bash");
  });

  it("reads input from args/input/arguments fields", () => {
    expect(readToolCallInput({ args: { a: 1 } })).toEqual({ a: 1 });
    expect(readToolCallInput({ input: { b: 2 } })).toEqual({ b: 2 });
    expect(readToolCallInput({ arguments: { c: 3 } })).toEqual({ c: 3 });
    expect(readToolCallInput({})).toEqual({});
    expect(readToolCallInput(null)).toEqual({});
  });
});

describe("normalizeToolCallForRuntime / Persistence", () => {
  it("normalizes runtime tool calls with input/args/result", () => {
    const tool = normalizeToolCallForRuntime(
      {
        id: "tc1",
        name: "bash",
        status: "completed",
        arguments: { command: "ls" },
        result: "out",
        startTime: "2026-07-21T00:00:00.000Z",
        endTime: "2026-07-21T00:00:01.000Z",
      },
      "running",
    );
    expect(tool).toMatchObject({
      id: "tc1",
      name: "bash",
      status: "completed",
      input: { command: "ls" },
      args: { command: "ls" },
      result: "out",
    });
    expect(tool?.startTime).toBeInstanceOf(Date);
    expect(tool?.endTime).toBeInstanceOf(Date);
  });

  it("returns null when id or name missing", () => {
    expect(normalizeToolCallForRuntime({ name: "x" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "1" })).toBeNull();
    expect(normalizeToolCallForRuntime(null)).toBeNull();
  });

  it("persistence omits args/result while keeping input/output timestamps", () => {
    const persisted = normalizeToolCallForPersistence({
      id: "tc2",
      name: "read",
      status: "completed",
      input: { path: "a.ts" },
      args: { path: "a.ts" },
      result: "ignored-in-persist-shape-if-only-result",
      output: "file body",
      startTime: new Date("2026-07-21T00:00:00.000Z"),
      endTime: new Date("2026-07-21T00:00:02.000Z"),
    });
    expect(persisted).toMatchObject({
      id: "tc2",
      name: "read",
      status: "completed",
      input: { path: "a.ts" },
      output: "file body",
    });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
  });

  it("batch helpers filter invalid entries", () => {
    expect(normalizeToolCallsForRuntime(null)).toEqual([]);
    expect(
      normalizeToolCallsForRuntime([
        { id: "a", name: "read" },
        { id: "bad" },
        { name: "only-name" },
      ]),
    ).toHaveLength(1);
    expect(normalizeToolCallsForPersistence([{ id: "a", name: "read", args: { x: 1 } }])[0]).not.toHaveProperty(
      "args",
    );
  });

  // wave-109 residual
  it("maps alias statuses to pending/running/completed/error", () => {
    const cases: Array<[string, "pending" | "running" | "completed" | "error"]> = [
      ["success", "completed"],
      ["executed", "completed"],
      ["failed", "error"],
      ["cancelled", "error"],
      ["blocked", "error"],
      ["executing", "running"],
      ["pausing", "running"],
      ["paused", "running"],
      ["waiting", "running"],
      ["pending", "pending"],
      ["weird", "pending"],
    ];
    for (const [status, expected] of cases) {
      const tool = normalizeToolCallForRuntime(
        { id: `id-${status}`, name: "bash", status },
        "pending",
      );
      expect(tool?.status, status).toBe(expected);
    }
  });

  it("uses fallback status when status is blank and revives epoch ms timestamps", () => {
    const tool = normalizeToolCallForRuntime(
      {
        id: "tc-ms",
        name: "read",
        status: "  ",
        startTime: 1_721_548_800_000,
        endTime: 1_721_548_801_000,
      },
      "running",
    );
    expect(tool?.status).toBe("running");
    expect(tool?.startTime?.getTime()).toBe(1_721_548_800_000);
    expect(tool?.endTime?.getTime()).toBe(1_721_548_801_000);
  });

  it("readToolCallIsError treats failed/cancelled aliases as error", () => {
    expect(readToolCallIsError({ status: "failed" })).toBe(true);
    expect(readToolCallIsError({ status: "cancelled" })).toBe(true);
    expect(readToolCallIsError({ status: "success" })).toBe(false);
    expect(readToolCallIsError({ isError: false, status: "failed" })).toBe(false);
  });
});

// wave-118 residual
describe("tool-call residual", () => {
  it("ignores whitespace-only id/name fields", () => {
    expect(readToolCallId({ id: "   ", toolCallId: " real " })).toBe("real");
    expect(readToolCallName({ name: "\t", toolName: " bash " })).toBe("bash");
    expect(normalizeToolCallForRuntime({ id: "  ", name: "read" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "tc", name: "  " })).toBeNull();
  });

  it("prefers top-level fields over nested partial when both present", () => {
    const event = {
      id: "top-id",
      name: "write",
      contentIndex: 0,
      partial: {
        content: [{ id: "nested-id", name: "read", arguments: { path: "nested" } }],
      },
    };
    // readStringField walks records in order: top-level first, then partial
    expect(readToolCallId(event)).toBe("top-id");
    expect(readToolCallName(event)).toBe("write");
  });

  it("persistence maps result to output when only result is present", () => {
    const persisted = normalizeToolCallForPersistence({
      id: "tc-result",
      name: "bash",
      status: "success",
      result: "stdout",
    });
    expect(persisted).toMatchObject({
      id: "tc-result",
      name: "bash",
      status: "completed",
      output: "stdout",
    });
    expect(persisted).not.toHaveProperty("result");
  });

  it("batch persistence returns empty for non-arrays and drops invalid rows", () => {
    expect(normalizeToolCallsForPersistence(undefined)).toEqual([]);
    expect(normalizeToolCallsForPersistence({ id: "x", name: "y" } as never)).toEqual([]);
    expect(
      normalizeToolCallsForPersistence([
        { id: "ok", name: "read", status: "executed" },
        null,
        "skip",
      ]),
    ).toEqual([
      expect.objectContaining({ id: "ok", name: "read", status: "completed" }),
    ]);
  });

  it("rejects invalid startTime/endTime without throwing", () => {
    const tool = normalizeToolCallForRuntime({
      id: "tc-bad-ts",
      name: "read",
      startTime: "not-a-date",
      endTime: Number.NaN,
    });
    expect(tool?.startTime).toBeUndefined();
    expect(tool?.endTime).toBeUndefined();
  });

  // wave-127 residual
  it("normalizes alias statuses for runtime and maps failed to error", () => {
    expect(
      normalizeToolCallForRuntime({ id: "a", name: "read", status: "success" })?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "b", name: "read", status: "failed" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "c", name: "read", status: "executing" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "d", name: "read", status: "blocked" })?.status,
    ).toBe("error");
  });

  it("returns null for runtime normalize without id/name", () => {
    expect(normalizeToolCallForRuntime({})).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "x" })).toBeNull();
    expect(normalizeToolCallForRuntime({ name: "read" })).toBeNull();
  });

  // wave-142 residual
  it("filters invalid entries in batch runtime/persistence normalizers", () => {
    const runtime = normalizeToolCallsForRuntime([
      { id: "ok", name: "read", status: "running" },
      { id: "missing-name" },
      null,
      "skip",
      { id: "ok2", name: "bash", status: "success" },
    ]);
    expect(runtime).toHaveLength(2);
    expect(runtime.map((t) => t.id)).toEqual(["ok", "ok2"]);
    expect(runtime[1]?.status).toBe("completed");

    expect(normalizeToolCallsForRuntime(null)).toEqual([]);
    expect(normalizeToolCallsForRuntime({ id: "x", name: "y" })).toEqual([]);
    expect(normalizeToolCallsForPersistence("nope")).toEqual([]);
  });

  it("maps arguments/result aliases and strips args/result on persistence", () => {
    const runtime = normalizeToolCallForRuntime({
      id: "tc1",
      name: "edit",
      arguments: { path: "a.ts" },
      result: { ok: true },
      status: "completed",
    });
    expect(runtime?.input).toEqual({ path: "a.ts" });
    expect(runtime?.args).toEqual({ path: "a.ts" });
    expect(runtime?.output).toEqual({ ok: true });
    expect(runtime?.result).toEqual({ ok: true });

    const persisted = normalizeToolCallForPersistence(runtime);
    expect(persisted).toMatchObject({
      id: "tc1",
      name: "edit",
      status: "completed",
      input: { path: "a.ts" },
      output: { ok: true },
    });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
  });

  it("applies fallbackStatus when status missing", () => {
    expect(
      normalizeToolCallForRuntime({ id: "f1", name: "read" }, "running")?.status,
    ).toBe("running");
    expect(
      normalizeToolCallsForPersistence(
        [{ id: "f2", name: "bash" }],
        "error",
      )[0]?.status,
    ).toBe("error");
  });

  // wave-153 residual
  it("ignores non-integer contentIndex and out-of-range partial slots", () => {
    const event = {
      contentIndex: 1.5,
      partial: {
        content: [
          { id: "slot0", name: "read" },
          { id: "slot1", name: "bash" },
        ],
      },
      id: "top",
      name: "write",
    };
    // non-integer contentIndex is ignored; top-level id/name still resolve
    expect(readToolCallId(event)).toBe("top");
    expect(readToolCallName(event)).toBe("write");

    const oob = {
      contentIndex: 9,
      partial: { content: [{ id: "only", name: "read" }] },
    };
    expect(readToolCallId(oob)).toBeNull();
    expect(readToolCallName(oob)).toBeNull();
  });

  it("maps cancelled/pausing/waiting/executed aliases for status and isError", () => {
    expect(
      normalizeToolCallForRuntime({ id: "c1", name: "read", status: "cancelled" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "c2", name: "read", status: "pausing" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "c3", name: "read", status: "waiting" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "c4", name: "read", status: "executed" })?.status,
    ).toBe("completed");
    expect(readToolCallIsError({ id: "e1", name: "read", status: "failed" })).toBe(true);
    expect(readToolCallIsError({ id: "e2", name: "read", status: "success" })).toBe(false);
    expect(readToolCallIsError({ id: "e3", name: "read", isError: true, status: "success" })).toBe(true);
  });

  it("revives Date instances and epoch numbers; drops empty-string timestamps", () => {
    const start = new Date("2026-01-02T03:04:05.000Z");
    const tool = normalizeToolCallForRuntime({
      id: "ts1",
      name: "read",
      startTime: start,
      endTime: start.getTime() + 1000,
    });
    expect(tool?.startTime).toEqual(start);
    expect(tool?.startTime).not.toBe(start); // cloned
    expect(tool?.endTime?.getTime()).toBe(start.getTime() + 1000);

    const emptyTs = normalizeToolCallForRuntime({
      id: "ts2",
      name: "read",
      startTime: "   ",
      endTime: null,
    });
    expect(emptyTs?.startTime).toBeUndefined();
    expect(emptyTs?.endTime).toBeUndefined();
  });

  it("prefers output over result and keeps non-object input as-is on runtime", () => {
    const runtime = normalizeToolCallForRuntime({
      id: "io1",
      name: "bash",
      output: "preferred",
      result: "ignored",
      input: "raw-string-input",
    });
    expect(runtime?.output).toBe("preferred");
    expect(runtime?.result).toBe("ignored");
    expect(runtime?.input).toBe("raw-string-input");
    // non-object input does not populate args
    expect(runtime?.args).toBeUndefined();

    const persisted = normalizeToolCallForPersistence(runtime);
    expect(persisted).toMatchObject({
      id: "io1",
      name: "bash",
      input: "raw-string-input",
      output: "preferred",
    });
    expect(persisted).not.toHaveProperty("result");
  });

  it("reads nested toolCall and input aliases in field order args/input/arguments", () => {
    const nested = {
      toolCall: {
        id: "nested-id",
        name: "edit",
        args: { a: 1 },
        input: { b: 2 },
        arguments: { c: 3 },
      },
    };
    expect(readToolCallId(nested)).toBe("nested-id");
    expect(readToolCallName(nested)).toBe("edit");
    // first matching field wins: args before input before arguments
    expect(readToolCallInput(nested)).toEqual({ a: 1 });
    expect(readToolCallOutput({ toolCall: { result: 0 } })).toBe(0);
  });

  // wave-165 residual
  it("prefers toolCallId/toolName aliases over id/name when both present on top-level", () => {
    expect(
      readToolCallId({ toolCallId: "alias-id", id: "plain-id", name: "x" }),
    ).toBe("alias-id");
    expect(
      readToolCallName({ toolName: "alias-name", name: "plain-name", id: "x" }),
    ).toBe("alias-name");
  });

  it("ignores blank id/name strings and out-of-range partial contentIndex", () => {
    expect(readToolCallId({ id: "  ", name: "read" })).toBeNull();
    expect(readToolCallName({ id: "ok", name: "   " })).toBeNull();
    expect(
      readToolCallId({
        contentIndex: 99,
        partial: { content: [{ id: "never", name: "read" }] },
      }),
    ).toBeNull();
    expect(
      readToolCallId({
        contentIndex: 0.5,
        partial: { content: [{ id: "never", name: "read" }] },
      }),
    ).toBeNull();
  });

  it("normalizeToolCallForRuntime rejects missing id/name and non-objects", () => {
    expect(normalizeToolCallForRuntime(null)).toBeNull();
    expect(normalizeToolCallForRuntime("bash")).toBeNull();
    expect(normalizeToolCallForRuntime({ name: "bash" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "x" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "x", name: "bash" })).toMatchObject({
      id: "x",
      name: "bash",
      status: "pending",
    });
  });

  it("maps blocked/executing statuses and unknown status to fallback", () => {
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "r", status: "blocked" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "2", name: "r", status: "executing" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "3", name: "r", status: "weird" }, "completed")?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "4", name: "r", status: "paused" })?.status,
    ).toBe("running");
  });

  it("array helpers drop invalid items and apply fallbackStatus", () => {
    const runtime = normalizeToolCallsForRuntime(
      [
        { id: "a", name: "read" },
        null,
        { name: "missing-id" },
        { id: "b", name: "bash", status: "weird" },
      ],
      "running",
    );
    expect(runtime).toHaveLength(2);
    expect(runtime[0]).toMatchObject({ id: "a", name: "read", status: "running" });
    expect(runtime[1]).toMatchObject({ id: "b", name: "bash", status: "running" });

    expect(normalizeToolCallsForRuntime(null as never)).toEqual([]);
    expect(normalizeToolCallsForRuntime({})).toEqual([]);

    const persisted = normalizeToolCallsForPersistence([
      { id: "p1", name: "edit", result: "drop-me", args: { x: 1 }, input: { y: 2 } },
    ]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).not.toHaveProperty("result");
    expect(persisted[0]).not.toHaveProperty("args");
    // input is kept from runtime normalization (input ?? args)
    expect(persisted[0]?.input).toEqual({ y: 2 });
  });

  it("readToolCallIsError false when no status/isError and true for status error", () => {
    expect(readToolCallIsError({ id: "x", name: "read" })).toBe(false);
    expect(readToolCallIsError({ id: "x", name: "read", status: "error" })).toBe(true);
    expect(readToolCallIsError({ id: "x", name: "read", status: "completed" })).toBe(false);
    expect(readToolCallIsError(null)).toBe(false);
  });

  // wave-179 residual
  it("prefers output over result and ignores non-object input fields", () => {
    expect(readToolCallOutput({ output: "prefer", result: "secondary" })).toBe("prefer");
    expect(readToolCallOutput({ result: 0 })).toBe(0);
    expect(readToolCallOutput({ result: false })).toBe(false);
    // string/array inputs are ignored by asRecord
    expect(readToolCallInput({ args: "not-object" })).toEqual({});
    expect(readToolCallInput({ input: ["arr"] })).toEqual({});
    expect(readToolCallInput({ arguments: null })).toEqual({});
  });

  it("trims whitespace-only ids from nested toolCall but keeps nested real id", () => {
    expect(
      readToolCallId({
        id: "   ",
        toolCall: { id: " nested-id ", name: "read" },
      }),
    ).toBe("nested-id");
    expect(
      readToolCallName({
        name: "\n",
        toolCall: { toolName: " bash ", name: "shell" },
      }),
    ).toBe("bash");
  });

  it("rejects array/function values for runtime normalize and maps cancelled aliases", () => {
    expect(normalizeToolCallForRuntime([])).toBeNull();
    expect(normalizeToolCallForRuntime(() => ({ id: "x", name: "y" }))).toBeNull();
    expect(
      normalizeToolCallForRuntime({ id: "c1", name: "bash", status: "cancelled" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "c2", name: "bash", status: "waiting" })?.status,
    ).toBe("running");
  });

  // wave-192 residual
  it("maps success/executed to completed and pausing to running", () => {
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "r", status: "success" })?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "2", name: "r", status: "executed" })?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "3", name: "r", status: "pausing" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "4", name: "r", status: "failed" })?.status,
    ).toBe("error");
  });

  it("readToolCallIsError prefers boolean isError over status mapping", () => {
    expect(readToolCallIsError({ isError: true, status: "completed" })).toBe(true);
    expect(readToolCallIsError({ isError: false, status: "error" })).toBe(false);
    expect(readToolCallIsError({ status: "failed" })).toBe(true); // maps to error
    expect(readToolCallIsError({ status: "waiting" })).toBe(false); // maps to running
  });

  it("revives ISO string and finite number timestamps on runtime normalize", () => {
    const iso = "2026-07-21T12:00:00.000Z";
    const runtime = normalizeToolCallForRuntime({
      id: "t1",
      name: "bash",
      startTime: iso,
      endTime: Date.parse(iso) + 1000,
    });
    expect(runtime?.startTime).toBeInstanceOf(Date);
    expect(runtime?.startTime?.toISOString()).toBe(iso);
    expect(runtime?.endTime).toBeInstanceOf(Date);
    expect(runtime?.endTime?.getTime()).toBe(Date.parse(iso) + 1000);

    // invalid date strings are dropped
    const bad = normalizeToolCallForRuntime({
      id: "t2",
      name: "bash",
      startTime: "not-a-date",
      endTime: Number.NaN,
    });
    expect(bad?.startTime).toBeUndefined();
    expect(bad?.endTime).toBeUndefined();
  });

  it("persistence keeps start/end times and drops args/result only", () => {
    const runtime = normalizeToolCallForRuntime({
      id: "p",
      name: "edit",
      status: "completed",
      args: { path: "a.ts" },
      result: "raw",
      output: "out",
      startTime: 1,
      endTime: 2,
    });
    const persisted = normalizeToolCallForPersistence(runtime);
    expect(persisted).toMatchObject({
      id: "p",
      name: "edit",
      status: "completed",
      output: "out",
    });
    // input comes from input ?? args
    expect(persisted?.input).toEqual({ path: "a.ts" });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(persisted?.startTime).toBeInstanceOf(Date);
    expect(persisted?.endTime).toBeInstanceOf(Date);
  });
});

// wave-199 residual
describe("tool-call residual (wave-199)", () => {
  it("maps status aliases success/failed/executing to product statuses", () => {
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "bash", status: "success" })?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "2", name: "bash", status: "executed" })?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "3", name: "bash", status: "failed" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "4", name: "bash", status: "cancelled" })?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "5", name: "bash", status: "executing" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "6", name: "bash", status: "waiting" })?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "7", name: "bash", status: "mystery" }, "pending")?.status,
    ).toBe("pending");
  });

  it("reviveDate drops invalid numbers/strings and keeps valid ISO", () => {
    const bad = normalizeToolCallForRuntime({
      id: "t",
      name: "read",
      startTime: Number.NaN,
      endTime: "not-a-date",
    });
    expect(bad?.startTime).toBeUndefined();
    expect(bad?.endTime).toBeUndefined();

    const ok = normalizeToolCallForRuntime({
      id: "t2",
      name: "read",
      startTime: "2026-07-07T00:00:00.000Z",
      endTime: 1_720_000_000_000,
    });
    expect(ok?.startTime).toBeInstanceOf(Date);
    expect(ok?.startTime?.toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(ok?.endTime).toBeInstanceOf(Date);
  });

  it("normalizeToolCalls* filters nulls and rejects non-arrays", () => {
    expect(normalizeToolCallsForRuntime(null)).toEqual([]);
    expect(normalizeToolCallsForRuntime({ id: "x" })).toEqual([]);
    expect(
      normalizeToolCallsForRuntime([
        { id: "ok", name: "read", status: "completed" },
        { id: "missing-name" },
        null,
        { name: "only-name" },
      ]),
    ).toEqual([
      expect.objectContaining({ id: "ok", name: "read", status: "completed" }),
    ]);
    const persisted = normalizeToolCallsForPersistence([
      { id: "p", name: "bash", status: "success", args: { c: 1 }, result: "r" },
    ]);
    expect(persisted).toEqual([
      expect.objectContaining({
        id: "p",
        name: "bash",
        status: "completed",
        input: { c: 1 },
        output: "r",
      }),
    ]);
    expect(persisted[0]).not.toHaveProperty("args");
  });

  it("readToolCallIsError prefers explicit isError over status aliases", () => {
    expect(readToolCallIsError({ isError: false, status: "failed" })).toBe(false);
    expect(readToolCallIsError({ isError: true, status: "completed" })).toBe(true);
    expect(readToolCallIsError({ status: "blocked" })).toBe(true);
    expect(readToolCallIsError({ status: "success" })).toBe(false);
  });
});

// wave-206 residual
describe("tool-call residual (wave-206)", () => {
  it("prefers nested toolCall fields for id/name when outer is blank", () => {
    expect(
      readToolCallId({ id: "  ", toolCall: { toolCallId: "nested-id" } }),
    ).toBe("nested-id");
    expect(
      readToolCallName({ name: "", toolCall: { toolName: "Bash" } }),
    ).toBe("Bash");
  });

  it("reads input from arguments when args/input missing; output prefers output over result", () => {
    expect(
      readToolCallInput({ arguments: { path: "a.ts" } }),
    ).toEqual({ path: "a.ts" });
    expect(readToolCallOutput({ output: "out", result: "res" })).toBe("out");
    expect(readToolCallOutput({ result: "only-result" })).toBe("only-result");
    expect(readToolCallOutput({ id: "x" })).toBeUndefined();
  });

  it("partial.content[contentIndex] contributes toolCall records", () => {
    const value = {
      contentIndex: 1,
      partial: {
        content: [
          { id: "skip", name: "nope" },
          { toolCallId: "from-partial", toolName: "read", status: "running" },
        ],
      },
    };
    expect(readToolCallId(value)).toBe("from-partial");
    expect(readToolCallName(value)).toBe("read");
    const runtime = normalizeToolCallForRuntime({
      ...value,
      id: "from-partial",
      name: "read",
      status: "pausing",
    });
    expect(runtime?.status).toBe("running");
  });

  it("persistence strips args/result while keeping input/output and maps blocked→error", () => {
    const persisted = normalizeToolCallForPersistence({
      id: "p",
      name: "edit",
      status: "blocked",
      args: { old: "a" },
      result: "done",
      startTime: "2026-07-01T00:00:00.000Z",
    });
    expect(persisted).toEqual(
      expect.objectContaining({
        id: "p",
        name: "edit",
        status: "error",
        input: { old: "a" },
        output: "done",
      }),
    );
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(persisted?.startTime).toBeInstanceOf(Date);
  });

  it("normalizeToolCalls* uses fallbackStatus for unknown status aliases", () => {
    const list = normalizeToolCallsForRuntime(
      [{ id: "1", name: "t", status: "mystery" }],
      "running",
    );
    expect(list[0]?.status).toBe("running");
    expect(normalizeToolCallsForPersistence(undefined)).toEqual([]);
    expect(normalizeToolCallsForPersistence("nope" as never)).toEqual([]);
  });

  // wave-211 residual
  it("readToolCallId/Name return null for non-objects; input prefers args over input", () => {
    expect(readToolCallId(null)).toBeNull();
    expect(readToolCallId("x")).toBeNull();
    expect(readToolCallName(undefined)).toBeNull();
    expect(readToolCallName(1)).toBeNull();
    // product field order: args → input → arguments
    expect(readToolCallInput({ input: { a: 1 }, args: { a: 2 } })).toEqual({ a: 2 });
    expect(readToolCallInput({ input: { b: 2 } })).toEqual({ b: 2 });
    expect(readToolCallInput({ arguments: { c: 3 } })).toEqual({ c: 3 });
    expect(readToolCallInput({})).toEqual({});
    expect(readToolCallIsError({ isError: true })).toBe(true);
    expect(readToolCallIsError({ isError: false })).toBe(false);
    expect(readToolCallIsError({})).toBe(false);
  });

  it("runtime prefers output over result; empty list when non-array", () => {
    const runtime = normalizeToolCallForRuntime({
      id: "1",
      name: "bash",
      status: "completed",
      result: "old",
      output: "new",
    });
    expect(runtime?.output).toBe("new");
    expect(normalizeToolCallsForRuntime(null as never)).toEqual([]);
    expect(normalizeToolCallsForRuntime({} as never)).toEqual([]);
    expect(normalizeToolCallsForRuntime([])).toEqual([]);
  });

  // wave-218 residual
  it("status aliases map success to completed, failed to error, executing to running; unknown uses fallback", () => {
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "success" })?.status).toBe("completed");
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "executed" })?.status).toBe("completed");
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "failed" })?.status).toBe("error");
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "cancelled" })?.status).toBe("error");
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "executing" })?.status).toBe("running");
    expect(normalizeToolCallForRuntime({ id: "1", name: "t", status: "weird" }, "completed")?.status).toBe(
      "completed",
    );
    expect(readToolCallIsError({ status: "failed" })).toBe(true);
    expect(readToolCallIsError({ status: "success" })).toBe(false);
  });

  it("persistence drops args/result; trims empty id/name; nested toolCall when outer id empty", () => {
    const runtime = normalizeToolCallForRuntime({
      id: "keep",
      name: "bash",
      status: "completed",
      args: { cmd: "ls" },
      result: "stdout",
      output: "out",
    });
    expect(runtime?.args).toEqual({ cmd: "ls" });
    expect(runtime?.result).toBe("stdout");
    const persisted = normalizeToolCallForPersistence(runtime);
    expect(persisted).toMatchObject({ id: "keep", name: "bash", status: "completed", output: "out" });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(readToolCallId({ id: "   " })).toBeNull();
    expect(readToolCallName({ name: "\t" })).toBeNull();
    expect(readToolCallId({ toolCall: { toolCallId: "nested-id" }, id: "outer" })).toBe("outer");
    expect(readToolCallId({ id: "", toolCall: { id: "from-nested" } })).toBe("from-nested");
  });

  // wave-239 residual
  it("readToolCallInput prefers args then input then arguments; empty object default", () => {
    expect(readToolCallInput({ args: { a: 1 }, input: { b: 2 }, arguments: { c: 3 } })).toEqual({ a: 1 });
    expect(readToolCallInput({ input: { b: 2 }, arguments: { c: 3 } })).toEqual({ b: 2 });
    expect(readToolCallInput({ arguments: { c: 3 } })).toEqual({ c: 3 });
    expect(readToolCallInput({})).toEqual({});
    expect(readToolCallInput(null)).toEqual({});
    // non-object field values are skipped
    expect(readToolCallInput({ args: "not-object", input: { ok: true } })).toEqual({ ok: true });
    // nested toolCall supplies input when outer fields missing
    expect(
      readToolCallInput({ toolCall: { arguments: { nested: true } } }),
    ).toEqual({ nested: true });
  });

  it("readToolCallOutput prefers output over result; isError boolean short-circuits status", () => {
    expect(readToolCallOutput({ output: "out", result: "res" })).toBe("out");
    expect(readToolCallOutput({ result: "res" })).toBe("res");
    expect(readToolCallOutput({})).toBeUndefined();
    // isError boolean short-circuits before status alias mapping
    expect(readToolCallIsError({ isError: true, status: "success" })).toBe(true);
    expect(readToolCallIsError({ isError: false, status: "failed" })).toBe(false);
    // no isError → status path
    expect(readToolCallIsError({ status: "error" })).toBe(true);
    expect(readToolCallIsError({ status: "pending" })).toBe(false);
    expect(readToolCallIsError({})).toBe(false);
  });

  it("normalizeToolCallsForPersistence filters nulls and drops args/result across list", () => {
    const list = normalizeToolCallsForPersistence([
      { id: "1", name: "bash", status: "completed", args: { x: 1 }, result: "r", output: "o" },
      null,
      { id: "", name: "bad" },
      { id: "2", name: "read", status: "running", arguments: { p: "a" } },
      undefined,
      "not-object",
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "1", name: "bash", status: "completed", output: "o" });
    expect(list[0]).not.toHaveProperty("args");
    expect(list[0]).not.toHaveProperty("result");
    // runtime maps arguments → input; persistence keeps input, drops args
    expect(list[1]).toMatchObject({ id: "2", name: "read", status: "running" });
    expect(list[1]).not.toHaveProperty("args");
    expect(list[1]).not.toHaveProperty("result");
    expect(normalizeToolCallsForPersistence(null)).toEqual([]);
    expect(normalizeToolCallsForPersistence({})).toEqual([]);
  });
});

// wave-256 residual
describe("tool-call residual (wave-256)", () => {
  it("normalizeStatus aliases: success/executed→completed; failed/cancelled/blocked→error; executing/waiting→running", () => {
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "success" })?.status).toBe(
      "completed",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "executed" })?.status).toBe(
      "completed",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "failed" })?.status).toBe(
      "error",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "cancelled" })?.status).toBe(
      "error",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "blocked" })?.status).toBe(
      "error",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "executing" })?.status).toBe(
      "running",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "waiting" })?.status).toBe(
      "running",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "weird" }, "pending")?.status).toBe(
      "pending",
    );
  });

  it("requires non-empty id and name; blank strings null; fallbackStatus when status missing", () => {
    expect(normalizeToolCallForRuntime({ id: "  ", name: "bash" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "1", name: "  " })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash" }, "running")?.status).toBe("running");
    // product maps args→input and result→output on runtime, then persistence keeps input/output (drops args/result keys)
    expect(normalizeToolCallForPersistence({ id: "1", name: "bash", args: { a: 1 }, result: "r" })).toEqual({
      id: "1",
      name: "bash",
      status: "pending",
      input: { a: 1 },
      output: "r",
    });
  });

  it("partial.content[contentIndex] supplies id/name; invalid index ignored", () => {
    const event = {
      contentIndex: 1,
      partial: {
        content: [{ type: "text" }, { id: "tc_p", toolName: "read", args: { path: "a" } }],
      },
    };
    expect(readToolCallId(event)).toBe("tc_p");
    expect(readToolCallName(event)).toBe("read");
    expect(readToolCallInput(event)).toEqual({ path: "a" });
    expect(readToolCallId({ contentIndex: 9, partial: { content: [] } })).toBeNull();
  });
});


// wave-269 residual
describe("tool-call residual (wave-269)", () => {
  it("maps pausing/paused to running; keeps canonical pending/running/completed/error", () => {
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "pausing" })?.status).toBe(
      "running",
    );
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "paused" })?.status).toBe(
      "running",
    );
    for (const status of ["pending", "running", "completed", "error"] as const) {
      expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status })?.status).toBe(status);
    }
  });

  it("runtime keeps args+result legacy keys; persistence drops them and revives dates", () => {
    const start = "2026-07-22T00:00:00.000Z";
    const end = 1_721_606_400_000;
    const runtime = normalizeToolCallForRuntime({
      id: "1",
      name: "bash",
      arguments: { cmd: "ls" },
      result: "out",
      startTime: start,
      endTime: end,
    });
    expect(runtime).toMatchObject({
      id: "1",
      name: "bash",
      input: { cmd: "ls" },
      output: "out",
      args: { cmd: "ls" },
      result: "out",
    });
    expect(runtime?.startTime).toBeInstanceOf(Date);
    expect(runtime?.endTime).toBeInstanceOf(Date);

    const persisted = normalizeToolCallForPersistence({
      id: "1",
      name: "bash",
      arguments: { cmd: "ls" },
      result: "out",
      startTime: start,
      endTime: end,
    });
    expect(persisted).toMatchObject({
      id: "1",
      name: "bash",
      input: { cmd: "ls" },
      output: "out",
    });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(persisted?.startTime).toBeInstanceOf(Date);
    expect(persisted?.endTime).toBeInstanceOf(Date);
  });

  it("normalizeToolCallsForRuntime filters invalid entries; non-array yields []", () => {
    const list = normalizeToolCallsForRuntime(
      [{ id: "ok", name: "read" }, { id: "", name: "x" }, null, { name: "no-id" }],
      "completed",
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "ok", name: "read", status: "completed" });
    expect(normalizeToolCallsForRuntime(undefined)).toEqual([]);
    expect(normalizeToolCallsForRuntime("x")).toEqual([]);
  });

  // wave-281 residual
  it("normalizeStatus aliases success/failed/pausing map to completed/error/running", () => {
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "bash", status: "success" }, "pending")?.status,
    ).toBe("completed");
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "bash", status: "failed" }, "pending")?.status,
    ).toBe("error");
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "bash", status: "pausing" }, "pending")?.status,
    ).toBe("running");
    expect(
      normalizeToolCallForRuntime({ id: "1", name: "bash", status: "paused" }, "pending")?.status,
    ).toBe("running");
  });

  it("readToolCallId prefers toolCallId; readToolCallName prefers toolName", () => {
    expect(readToolCallId({ toolCallId: "tc", id: "id" })).toBe("tc");
    expect(readToolCallName({ toolName: "bash", name: "shell" })).toBe("bash");
    expect(readToolCallId({ id: "  " })).toBeNull();
    expect(readToolCallName({ name: "" })).toBeNull();
  });



  // wave-291 residual
  it("readToolCallInput prefers args then input then arguments; empty object default", () => {
    expect(readToolCallInput({ args: { a: 1 }, input: { b: 2 } })).toEqual({ a: 1 });
    expect(readToolCallInput({ input: { b: 2 }, arguments: { c: 3 } })).toEqual({ b: 2 });
    expect(readToolCallInput({ arguments: { c: 3 } })).toEqual({ c: 3 });
    expect(readToolCallInput({})).toEqual({});
    expect(readToolCallInput(null)).toEqual({});
    expect(readToolCallOutput({ output: "o", result: "r" })).toBe("o");
    expect(readToolCallOutput({ result: "r" })).toBe("r");
    expect(readToolCallOutput({})).toBeUndefined();
  });

  it("persistence drops args/result extras; runtime keeps them; arrays filter nulls", () => {
    const raw = {
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "ls" },
      result: "out",
      status: "completed",
    };
    const runtime = normalizeToolCallForRuntime(raw);
    expect(runtime).toMatchObject({
      id: "t1",
      name: "bash",
      status: "completed",
      input: { cmd: "ls" },
      output: "out",
      args: { cmd: "ls" },
      result: "out",
    });
    const persisted = normalizeToolCallForPersistence(raw);
    expect(persisted).toMatchObject({
      id: "t1",
      name: "bash",
      status: "completed",
      input: { cmd: "ls" },
      output: "out",
    });
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(normalizeToolCallsForPersistence([raw, null, { id: "x" }])).toHaveLength(1);
  });


  // wave-300 residual
  it("normalizeStatus maps executed/cancelled/blocked/waiting/executing aliases", () => {
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "executed" })?.status).toBe("completed");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "cancelled" })?.status).toBe("error");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "blocked" })?.status).toBe("error");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "waiting" })?.status).toBe("running");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "executing" })?.status).toBe("running");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "weird" }, "pending")?.status).toBe("pending");
    expect(normalizeToolCallForRuntime({ id: "1", name: "bash", status: "weird" }, "running")?.status).toBe("running");
  });

  it("readToolCallIsError prefers boolean isError over status; empty/whitespace ids rejected", () => {
    expect(readToolCallIsError({ isError: true, status: "completed" })).toBe(true);
    expect(readToolCallIsError({ isError: false, status: "error" })).toBe(false);
    expect(readToolCallIsError({ status: "failed" })).toBe(true);
    expect(readToolCallIsError({ status: "success" })).toBe(false);
    expect(normalizeToolCallForRuntime({ id: "  ", name: "bash" })).toBeNull();
    expect(normalizeToolCallForRuntime({ id: "ok", name: "  " })).toBeNull();
    expect(normalizeToolCallForRuntime(null)).toBeNull();
    expect(normalizeToolCallForRuntime("x")).toBeNull();
  });

  it("reviveDate accepts Date/number/ISO string; invalid values omitted; persistence keeps times", () => {
    const start = new Date("2026-07-21T00:00:00.000Z");
    const endMs = start.getTime() + 1000;
    const runtime = normalizeToolCallForRuntime({
      id: "t",
      name: "read",
      startTime: start,
      endTime: endMs,
      status: "completed",
    });
    expect(runtime?.startTime).toBeInstanceOf(Date);
    expect(runtime?.endTime).toBeInstanceOf(Date);
    expect(runtime?.endTime?.getTime()).toBe(endMs);

    const noDates = normalizeToolCallForRuntime({
      id: "t2",
      name: "read",
      startTime: "not-a-date",
      endTime: Number.NaN,
    });
    expect(noDates?.startTime).toBeUndefined();
    expect(noDates?.endTime).toBeUndefined();

    const persisted = normalizeToolCallForPersistence({
      id: "t3",
      name: "bash",
      args: { x: 1 },
      result: "y",
      startTime: start.toISOString(),
      endTime: endMs,
    });
    expect(persisted?.startTime).toBeInstanceOf(Date);
    expect(persisted?.endTime).toBeInstanceOf(Date);
    expect(persisted).not.toHaveProperty("args");
    expect(persisted).not.toHaveProperty("result");
    expect(normalizeToolCallsForRuntime([{ id: "a", name: "read" }, { id: "b" }])).toHaveLength(1);
  });

});
