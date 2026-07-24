import { describe, expect, it } from "vitest";
import { normalizeLegacyMessagePayload } from "./tool-call-normalization";

describe("normalizeLegacyMessagePayload", () => {
  it("returns non-objects and messages without toolCalls unchanged", () => {
    expect(normalizeLegacyMessagePayload(null)).toBeNull();
    expect(normalizeLegacyMessagePayload("x")).toBe("x");
    expect(normalizeLegacyMessagePayload(42)).toBe(42);
    const bare = { id: "m1", content: "hi" };
    expect(normalizeLegacyMessagePayload(bare)).toBe(bare);
  });

  it("maps legacy toolCallId/toolName/args/result fields onto current shape", () => {
    const raw = {
      id: "msg-1",
      role: "assistant",
      toolCalls: [
        {
          toolCallId: "tc-legacy",
          toolName: "bash",
          args: { command: "ls" },
          result: "ok",
          status: "completed",
        },
      ],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toMatchObject({
      id: "tc-legacy",
      name: "bash",
      input: { command: "ls" },
      output: "ok",
      status: "completed",
      toolCallId: "tc-legacy",
      toolName: "bash",
    });
  });

  it("prefers legacy toolCallId/toolName when both legacy and modern keys exist", () => {
    const raw = {
      toolCalls: [
        {
          id: "modern-id",
          toolCallId: "legacy-id",
          name: "modern-name",
          toolName: "legacy-name",
          input: { a: 1 },
          args: { b: 2 },
          output: "out",
          result: "res",
        },
      ],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    // Implementation: id = toolCallId ?? id, name = toolName ?? name, etc.
    expect(next.toolCalls[0].id).toBe("legacy-id");
    expect(next.toolCalls[0].name).toBe("legacy-name");
    expect(next.toolCalls[0].input).toEqual({ a: 1 });
    expect(next.toolCalls[0].output).toBe("out");
  });

  it("leaves non-object toolCalls entries as-is via identity pass-through", () => {
    const raw = {
      toolCalls: [null, "skip", 3, { toolCallId: "only-legacy" }],
    };
    const next = normalizeLegacyMessagePayload(raw) as { toolCalls: unknown[] };
    expect(next.toolCalls[0]).toBeNull();
    expect(next.toolCalls[1]).toBe("skip");
    expect(next.toolCalls[2]).toBe(3);
    expect(next.toolCalls[3]).toMatchObject({ id: "only-legacy", toolCallId: "only-legacy" });
  });

  it("does not mutate the original payload object", () => {
    const raw = {
      toolCalls: [{ toolCallId: "x", toolName: "y", args: {} }],
    };
    const snapshot = JSON.stringify(raw);
    normalizeLegacyMessagePayload(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  // wave-146 residual
  it("returns arrays and empty toolCalls arrays without rewriting root identity when empty", () => {
    expect(normalizeLegacyMessagePayload([1, 2])).toEqual([1, 2]);
    const empty = { id: "m", toolCalls: [] as unknown[] };
    const next = normalizeLegacyMessagePayload(empty) as {
      id: string;
      toolCalls: unknown[];
    };
    expect(next.toolCalls).toEqual([]);
    expect(next).not.toBe(empty);
    expect(next.id).toBe("m");
  });

  it("maps only missing modern keys and preserves unrelated toolCall fields", () => {
    const raw = {
      toolCalls: [
        {
          toolCallId: "tc",
          toolName: "Write",
          args: { path: "a.ts" },
          result: "done",
          status: "completed",
          startTime: "t0",
        },
      ],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toMatchObject({
      id: "tc",
      name: "Write",
      input: { path: "a.ts" },
      output: "done",
      status: "completed",
      startTime: "t0",
    });
  });

  it("leaves non-array toolCalls as raw message identity", () => {
    const raw = { id: "m", toolCalls: { not: "array" } };
    expect(normalizeLegacyMessagePayload(raw)).toBe(raw);
  });

  // wave-154 residual
  it("leaves modern-only toolCalls fields when legacy keys are absent", () => {
    const raw = {
      toolCalls: [
        {
          id: "modern",
          name: "read",
          input: { path: "a.ts" },
          output: "text",
        },
      ],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toMatchObject({
      id: "modern",
      name: "read",
      input: { path: "a.ts" },
      output: "text",
    });
    // no legacy keys invented
    expect(next.toolCalls[0].toolCallId).toBeUndefined();
    expect(next.toolCalls[0].toolName).toBeUndefined();
  });

  it("maps empty-object toolCalls entries without inventing id/name", () => {
    const raw = { toolCalls: [{}] };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toEqual({
      id: undefined,
      name: undefined,
      input: undefined,
      output: undefined,
    });
  });

  it("preserves sibling message fields when rewriting toolCalls", () => {
    const raw = {
      id: "msg",
      role: "assistant",
      content: "hi",
      meta: { source: "legacy" },
      toolCalls: [{ toolCallId: "t1", toolName: "bash", args: { command: "echo" } }],
    };
    const next = normalizeLegacyMessagePayload(raw) as Record<string, unknown>;
    expect(next.id).toBe("msg");
    expect(next.role).toBe("assistant");
    expect(next.content).toBe("hi");
    expect(next.meta).toEqual({ source: "legacy" });
    expect((next.toolCalls as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "t1",
      name: "bash",
      input: { command: "echo" },
    });
  });

  // wave-198 residual
  it("returns a new object for empty toolCalls array without mutating source", () => {
    const raw = { id: "m", toolCalls: [] as unknown[] };
    const next = normalizeLegacyMessagePayload(raw) as { id: string; toolCalls: unknown[] };
    expect(next).not.toBe(raw);
    expect(next.toolCalls).toEqual([]);
    expect(next.toolCalls).not.toBe(raw.toolCalls);
    expect(raw.toolCalls).toEqual([]);
  });

  it("maps modern-only fields through identity when legacy keys absent", () => {
    const raw = {
      toolCalls: [{ id: "modern", name: "read", input: { path: "a.ts" }, output: "ok" }],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toMatchObject({
      id: "modern",
      name: "read",
      input: { path: "a.ts" },
      output: "ok",
    });
  });

  // wave-202 residual
  it("returns non-object and missing/non-array toolCalls payloads as identity", () => {
    expect(normalizeLegacyMessagePayload(null)).toBeNull();
    expect(normalizeLegacyMessagePayload(undefined)).toBeUndefined();
    expect(normalizeLegacyMessagePayload("msg")).toBe("msg");
    expect(normalizeLegacyMessagePayload(12)).toBe(12);
    const arr = [{ id: "x" }];
    expect(normalizeLegacyMessagePayload(arr)).toBe(arr);
    const noCalls = { id: "m", content: "hi" };
    expect(normalizeLegacyMessagePayload(noCalls)).toBe(noCalls);
    const notArray = { id: "m", toolCalls: { id: "t" } };
    expect(normalizeLegacyMessagePayload(notArray)).toBe(notArray);
  });

  it("prefers legacy toolCallId/toolName but modern input/output when both present", () => {
    // product: id/name use toolCallId/toolName ?? modern; input/output use input/output ?? legacy
    const raw = {
      toolCalls: [
        {
          id: "modern-id",
          toolCallId: "legacy-id",
          name: "modern-name",
          toolName: "legacy-name",
          input: { modern: true },
          args: { legacy: true },
          output: "modern-out",
          result: "legacy-out",
        },
      ],
    };
    const next = normalizeLegacyMessagePayload(raw) as {
      toolCalls: Array<Record<string, unknown>>;
    };
    expect(next.toolCalls[0]).toMatchObject({
      id: "legacy-id",
      name: "legacy-name",
      input: { modern: true },
      output: "modern-out",
    });
  });

  // wave-270 residual
  it("maps empty toolCalls to empty array; non-object items pass through", () => {
    const empty = normalizeLegacyMessagePayload({ id: "m", toolCalls: [] }) as {
      toolCalls: unknown[];
    };
    expect(empty.toolCalls).toEqual([]);
    const mixed = normalizeLegacyMessagePayload({
      toolCalls: [null, "x", 1, { toolCallId: "t1", toolName: "bash", args: { a: 1 } }],
    }) as { toolCalls: unknown[] };
    expect(mixed.toolCalls[0]).toBeNull();
    expect(mixed.toolCalls[1]).toBe("x");
    expect(mixed.toolCalls[2]).toBe(1);
    expect(mixed.toolCalls[3]).toMatchObject({
      id: "t1",
      name: "bash",
      input: { a: 1 },
    });
  });

  it("legacy result becomes output when output missing; spreads extra fields", () => {
    const next = normalizeLegacyMessagePayload({
      role: "assistant",
      toolCalls: [
        {
          toolCallId: "legacy",
          toolName: "read",
          result: "file body",
          status: "completed",
          extra: true,
        },
      ],
    }) as { role: string; toolCalls: Array<Record<string, unknown>> };
    expect(next.role).toBe("assistant");
    expect(next.toolCalls[0]).toMatchObject({
      id: "legacy",
      name: "read",
      output: "file body",
      result: "file body",
      status: "completed",
      extra: true,
    });
  });



  // wave-291 residual
  it("normalizeLegacyMessagePayload leaves non-objects and missing toolCalls unchanged", () => {
    expect(normalizeLegacyMessagePayload(null)).toBeNull();
    expect(normalizeLegacyMessagePayload("raw")).toBe("raw");
    expect(normalizeLegacyMessagePayload(12)).toBe(12);
    expect(normalizeLegacyMessagePayload({ role: "user", content: "hi" })).toEqual({
      role: "user",
      content: "hi",
    });
    const withNonArray = normalizeLegacyMessagePayload({ toolCalls: { not: "array" } });
    expect(withNonArray).toEqual({ toolCalls: { not: "array" } });
  });

  it("prefers legacy toolCallId/toolName via ?? ; modern input/output when present", () => {
    // product: id = toolCallId ?? id; name = toolName ?? name; input = input ?? args; output = output ?? result
    const next = normalizeLegacyMessagePayload({
      toolCalls: [
        {
          id: "modern-id",
          toolCallId: "legacy-id",
          name: "modern-name",
          toolName: "legacy-name",
          input: { modern: true },
          args: { legacy: true },
          output: "modern-out",
          result: "legacy-out",
        },
      ],
    }) as { toolCalls: Array<Record<string, unknown>> };
    expect(next.toolCalls[0]).toMatchObject({
      id: "legacy-id",
      name: "legacy-name",
      input: { modern: true },
      output: "modern-out",
      toolCallId: "legacy-id",
      toolName: "legacy-name",
      args: { legacy: true },
      result: "legacy-out",
    });
  });



  // wave-301 residual
  it("normalizeLegacyMessagePayload maps toolCalls via toolCallId/toolName/args/result fallbacks", () => {
    const next = normalizeLegacyMessagePayload({
      role: "assistant",
      toolCalls: [
        { toolCallId: "L1", toolName: "bash", args: { c: 1 }, result: "out" },
        { id: "M1", name: "read", input: { p: "a" }, output: "body" },
      ],
    }) as { toolCalls: Array<Record<string, unknown>> };
    expect(next.toolCalls[0]).toMatchObject({
      id: "L1",
      name: "bash",
      input: { c: 1 },
      output: "out",
      toolCallId: "L1",
      toolName: "bash",
      args: { c: 1 },
      result: "out",
    });
    expect(next.toolCalls[1]).toMatchObject({
      id: "M1",
      name: "read",
      input: { p: "a" },
      output: "body",
    });
  });

  it("non-object toolCalls entries pass through; empty toolCalls array preserved", () => {
    const next = normalizeLegacyMessagePayload({
      toolCalls: [null, "x", 3, { toolCallId: "ok", toolName: "bash" }],
    }) as { toolCalls: unknown[] };
    expect(next.toolCalls[0]).toBeNull();
    expect(next.toolCalls[1]).toBe("x");
    expect(next.toolCalls[2]).toBe(3);
    expect(next.toolCalls[3]).toMatchObject({ id: "ok", name: "bash" });
    expect(normalizeLegacyMessagePayload({ toolCalls: [] })).toEqual({ toolCalls: [] });
  });

  it("does not mutate nested non-array toolCalls; preserves sibling fields", () => {
    const raw = { role: "user", content: "hi", toolCalls: "nope" as never };
    expect(normalizeLegacyMessagePayload(raw)).toEqual(raw);
    const withMeta = normalizeLegacyMessagePayload({
      id: "m1",
      meta: { a: 1 },
      toolCalls: [{ id: "t", name: "n" }],
    }) as Record<string, unknown>;
    expect(withMeta.id).toBe("m1");
    expect(withMeta.meta).toEqual({ a: 1 });
  });


  // wave-316 residual
  it("normalizeLegacyMessagePayload returns non-object and array inputs unchanged", () => {
    expect(normalizeLegacyMessagePayload(null)).toBeNull();
    expect(normalizeLegacyMessagePayload("raw")).toBe("raw");
    expect(normalizeLegacyMessagePayload(3)).toBe(3);
    const arr = [{ toolCalls: [] }];
    expect(normalizeLegacyMessagePayload(arr)).toBe(arr);
  });

  it("prefers modern input/output over legacy args/result; id/name fall back to legacy fields", () => {
    const next = normalizeLegacyMessagePayload({
      toolCalls: [
        {
          toolCallId: "legacy-id",
          id: "modern-id",
          toolName: "legacy-name",
          name: "modern-name",
          input: { modern: true },
          args: { legacy: true },
          output: "modern-out",
          result: "legacy-out",
        },
        {
          // only legacy fields
          toolCallId: "L-only",
          toolName: "bash",
          args: { cmd: "ls" },
          result: "ok",
        },
      ],
    }) as { toolCalls: Array<Record<string, unknown>> };
    // product: id = toolCallId ?? id → legacy-id wins over modern-id
    expect(next.toolCalls[0]).toMatchObject({
      id: "legacy-id",
      name: "legacy-name",
      input: { modern: true },
      output: "modern-out",
      toolCallId: "legacy-id",
      toolName: "legacy-name",
      args: { legacy: true },
      result: "legacy-out",
    });
    expect(next.toolCalls[1]).toMatchObject({
      id: "L-only",
      name: "bash",
      input: { cmd: "ls" },
      output: "ok",
      toolCallId: "L-only",
      toolName: "bash",
      args: { cmd: "ls" },
      result: "ok",
    });
  });

  it("array toolCall entries pass through; object without array toolCalls returns original identity", () => {
    const noTc = { role: "assistant", content: "hi" };
    expect(normalizeLegacyMessagePayload(noTc)).toBe(noTc);
    const next = normalizeLegacyMessagePayload({
      toolCalls: [[1, 2], { id: "x", name: "y" }],
    }) as { toolCalls: unknown[] };
    expect(next.toolCalls[0]).toEqual([1, 2]);
    expect(next.toolCalls[1]).toMatchObject({ id: "x", name: "y" });
  });


});
