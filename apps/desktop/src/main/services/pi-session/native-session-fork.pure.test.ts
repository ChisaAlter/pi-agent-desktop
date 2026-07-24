import { describe, expect, it } from "vitest";
import type { Message as DesktopMessage } from "@shared";
import {
  normalizeText,
  selectDesktopMessages,
  toTimestamp,
} from "./native-session-fork";

function msg(
  id: string,
  role: DesktopMessage["role"],
  content: string,
): DesktopMessage {
  return { id, role, content, timestamp: new Date(1) } as DesktopMessage;
}

describe("selectDesktopMessages", () => {
  const history = [
    msg("m1", "user", "first"),
    msg("m2", "assistant", "second"),
    msg("m3", "user", "third"),
  ];

  it("returns full history when fromMessageId is omitted", () => {
    expect(selectDesktopMessages(history).map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("slices inclusive up to the selected message", () => {
    expect(selectDesktopMessages(history, "m2").map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("throws when the fork message is missing", () => {
    expect(() => selectDesktopMessages(history, "missing")).toThrow(
      /找不到分叉消息/,
    );
  });
});

describe("normalizeText", () => {
  it("trims plain strings and joins text parts", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
    expect(
      normalizeText([
        { type: "text", text: "a" },
        { type: "toolCall", name: "x" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  it("returns empty for non-text content", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText([{ type: "image", url: "x" }])).toBe("");
  });
});

describe("toTimestamp", () => {
  it("accepts Date and ISO string", () => {
    expect(toTimestamp(new Date("2026-07-21T00:00:00.000Z"))).toBe(
      Date.parse("2026-07-21T00:00:00.000Z"),
    );
    expect(toTimestamp("2026-07-21T00:00:00.000Z")).toBe(
      Date.parse("2026-07-21T00:00:00.000Z"),
    );
  });

  it("falls back to now for invalid strings", () => {
    const before = Date.now();
    const value = toTimestamp("not-a-date");
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});

// wave-231 residual
describe("native-session-fork pure residual (wave-231)", () => {
  it("selectDesktopMessages with first id returns single-element prefix", () => {
    const history = [
      { id: "m1", role: "user", content: "first", timestamp: new Date(1) },
      { id: "m2", role: "assistant", content: "second", timestamp: new Date(2) },
    ];
    expect(selectDesktopMessages(history as never, "m1").map((m) => m.id)).toEqual(["m1"]);
  });

  it("selectDesktopMessages empty history without id returns empty; with id throws", () => {
    expect(selectDesktopMessages([])).toEqual([]);
    expect(() => selectDesktopMessages([], "x")).toThrow(/找不到分叉消息/);
  });

  it("normalizeText joins only text parts and trims final string", () => {
    expect(
      normalizeText([
        { type: "text", text: "  a" },
        { type: "text", text: "b  " },
      ]),
    ).toBe("ab");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(42)).toBe("");
  });

  it("toTimestamp accepts finite numbers as epoch ms", () => {
    expect(toTimestamp(1_700_000_000_000 as never)).toBe(1_700_000_000_000);
  });
});

// wave-242 residual
describe("native-session-fork pure residual (wave-242)", () => {
  it("selectDesktopMessages last id returns full history; middle id inclusive prefix", () => {
    const history = [
      msg("m1", "user", "a"),
      msg("m2", "assistant", "b"),
      msg("m3", "user", "c"),
      msg("m4", "assistant", "d"),
    ];
    expect(selectDesktopMessages(history, "m4").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(selectDesktopMessages(history, "m3").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    // product: empty string is falsy → treated as omitted fromMessageId
    expect(selectDesktopMessages(history, "").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(() => selectDesktopMessages(history, "missing-id")).toThrow(/找不到分叉消息/);
  });

  it("normalizeText keeps only type=text string parts; non-text and non-string dropped", () => {
    expect(
      normalizeText([
        { type: "text", text: "a" },
        { type: "image", text: "ignored" },
        null,
        { type: "text", text: 1 as never },
        { type: "text", text: "b" },
        "raw",
      ]),
    ).toBe("ab");
    expect(normalizeText([])).toBe("");
    expect(normalizeText({ type: "text", text: "x" })).toBe("");
    expect(normalizeText("  spaced  ")).toBe("spaced");
  });

  it("toTimestamp Date/number/ISO string; invalid falls back near now", () => {
    const d = new Date("2020-01-01T00:00:00.000Z");
    expect(toTimestamp(d)).toBe(d.getTime());
    expect(toTimestamp(42 as never)).toBe(42);
    expect(toTimestamp("2020-01-01T00:00:00.000Z")).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
    const before = Date.now();
    const fallback = toTimestamp("not-a-date" as never);
    const after = Date.now();
    expect(fallback).toBeGreaterThanOrEqual(before);
    expect(fallback).toBeLessThanOrEqual(after);
  });


  // wave-293 residual
  it("normalizeText concatenates text parts only; trims string content", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
    expect(
      normalizeText([
        { type: "text", text: "A" },
        { type: "toolCall", text: "no" },
        { type: "text", text: "B" },
      ]),
    ).toBe("AB");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("selectDesktopMessages without fromMessageId returns all; fromMessageId slices start..id inclusive", () => {
    // product: messages.slice(0, index + 1)
    const history = [
      { id: "m1", role: "user", content: "a", timestamp: 1 },
      { id: "m2", role: "assistant", content: "b", timestamp: 2 },
      { id: "m3", role: "user", content: "c", timestamp: 3 },
    ] as never;
    expect(selectDesktopMessages(history).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(selectDesktopMessages(history, "m2").map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(selectDesktopMessages(history, "m3").map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(selectDesktopMessages(history, "m1").map((m) => m.id)).toEqual(["m1"]);
    expect(() => selectDesktopMessages(history, "nope")).toThrow(/找不到分叉消息/);
  });



  // wave-301 residual
  describe("native-session-fork pure residual (wave-301)", () => {
    it("selectDesktopMessages empty fromMessageId falsy paths return full history", () => {
      const history = [
        msg("a", "user", "u"),
        msg("b", "assistant", "v"),
      ];
      expect(selectDesktopMessages(history).map((m) => m.id)).toEqual(["a", "b"]);
      expect(selectDesktopMessages(history, undefined).map((m) => m.id)).toEqual(["a", "b"]);
      // empty string is falsy → full history
      expect(selectDesktopMessages(history, "").map((m) => m.id)).toEqual(["a", "b"]);
      expect(selectDesktopMessages(history, "b").map((m) => m.id)).toEqual(["a", "b"]);
      expect(selectDesktopMessages(history, "a").map((m) => m.id)).toEqual(["a"]);
      expect(() => selectDesktopMessages(history, "zzz")).toThrow(/找不到分叉消息: zzz/);
    });

    it("normalizeText trims string; joins text parts without separators; non-array non-string empty", () => {
      expect(normalizeText("\n  x  \n")).toBe("x");
      expect(
        normalizeText([
          { type: "text", text: "foo" },
          { type: "text", text: "bar" },
          { type: "toolCall", text: "drop" },
        ]),
      ).toBe("foobar");
      expect(normalizeText([{ type: "text" }, { type: "text", text: "ok" }])).toBe("ok");
      expect(normalizeText(true)).toBe("");
      expect(normalizeText({ text: "no-type" })).toBe("");
    });

    it("toTimestamp Date/number/ISO; invalid Date.parse falls back to now", () => {
      const d = new Date("2026-01-01T00:00:00.000Z");
      expect(toTimestamp(d)).toBe(d.getTime());
      expect(toTimestamp(12345 as never)).toBe(12345);
      expect(toTimestamp("2026-01-01T00:00:00.000Z")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
      const before = Date.now();
      const v = toTimestamp("" as never);
      const after = Date.now();
      expect(v).toBeGreaterThanOrEqual(before);
      expect(v).toBeLessThanOrEqual(after);
    });
  });


  // wave-319 residual
  describe("native-session-fork pure residual (wave-319)", () => {
    it("selectDesktopMessages inclusive slice; missing id Chinese error; falsy fromMessageId full history", () => {
      const history = [
        msg("a", "user", "u1"),
        msg("b", "assistant", "a1"),
        msg("c", "user", "u2"),
      ];
      expect(selectDesktopMessages(history, "a").map((m) => m.id)).toEqual(["a"]);
      expect(selectDesktopMessages(history, "c").map((m) => m.id)).toEqual(["a", "b", "c"]);
      expect(() => selectDesktopMessages(history, "nope")).toThrow("找不到分叉消息: nope");
      expect(selectDesktopMessages(history).map((m) => m.id)).toEqual(["a", "b", "c"]);
      expect(selectDesktopMessages(history, "").map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    it("normalizeText trims strings; joins only type=text string parts; non-array empty", () => {
      expect(normalizeText("  x  ")).toBe("x");
      expect(
        normalizeText([
          { type: "text", text: "A" },
          { type: "image", text: "drop" },
          { type: "text", text: "B" },
          null,
          "skip",
        ]),
      ).toBe("AB");
      expect(normalizeText([{ type: "text", text: 1 }, { type: "text", text: "ok" }])).toBe("ok");
      expect(normalizeText(undefined)).toBe("");
      expect(normalizeText({ type: "text", text: "no" })).toBe("");
    });

    it("toTimestamp accepts Date/number/ISO; invalid falls back to now", () => {
      const d = new Date("2026-03-01T00:00:00.000Z");
      expect(toTimestamp(d)).toBe(d.getTime());
      expect(toTimestamp(42 as never)).toBe(42);
      expect(toTimestamp("2026-03-01T00:00:00.000Z")).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
      const before = Date.now();
      const v = toTimestamp("not-a-date" as never);
      const after = Date.now();
      expect(v).toBeGreaterThanOrEqual(before);
      expect(v).toBeLessThanOrEqual(after);
    });
  });

});
