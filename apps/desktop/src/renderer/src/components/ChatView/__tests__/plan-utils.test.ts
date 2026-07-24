import { describe, expect, it } from "vitest";
import {
  findReusablePlanMessage,
  isLockedPlanPhase,
  isReusablePlanStatus,
  normalizePlanIdentity,
  samePlanIdentity,
  stripPlanFrontmatter,
} from "../plan-utils";

describe("normalizePlanIdentity", () => {
  it("trims and lowercases", () => {
    expect(normalizePlanIdentity("  Plan-ABC.md ")).toBe("plan-abc.md");
  });

  it("maps undefined/empty to empty string", () => {
    expect(normalizePlanIdentity(undefined)).toBe("");
    expect(normalizePlanIdentity("   ")).toBe("");
  });
});

describe("samePlanIdentity", () => {
  it("matches on filename when both present (case-insensitive)", () => {
    expect(
      samePlanIdentity(
        { filename: "Plan/FOO.md", title: "A" },
        { filename: "plan/foo.md", title: "B" },
      ),
    ).toBe(true);
  });

  it("does not match when filenames differ even if titles match", () => {
    expect(
      samePlanIdentity(
        { filename: "a.md", title: "same" },
        { filename: "b.md", title: "same" },
      ),
    ).toBe(false);
  });

  it("falls back to title when either filename is missing", () => {
    expect(
      samePlanIdentity({ title: "  Write Probe " }, { filename: "x.md", title: "write probe" }),
    ).toBe(true);
    expect(samePlanIdentity({ title: "A" }, { title: "B" })).toBe(false);
  });

  it("returns false when neither side has a usable identity", () => {
    expect(samePlanIdentity({}, {})).toBe(false);
    expect(samePlanIdentity({ title: "  " }, { filename: "" })).toBe(false);
  });
});

describe("isLockedPlanPhase", () => {
  it("locks executing/pausing/paused/completed", () => {
    expect(isLockedPlanPhase("executing")).toBe(true);
    expect(isLockedPlanPhase("pausing")).toBe(true);
    expect(isLockedPlanPhase("paused")).toBe(true);
    expect(isLockedPlanPhase("completed")).toBe(true);
  });

  it("does not lock draft/idle/unknown", () => {
    expect(isLockedPlanPhase("draft")).toBe(false);
    expect(isLockedPlanPhase(undefined)).toBe(false);
    expect(isLockedPlanPhase("")).toBe(false);
  });
});

describe("isReusablePlanStatus", () => {
  it("rejects terminal statuses", () => {
    expect(isReusablePlanStatus("executed")).toBe(false);
    expect(isReusablePlanStatus("cancelled")).toBe(false);
    expect(isReusablePlanStatus("failed")).toBe(false);
  });

  it("allows non-terminal and undefined", () => {
    expect(isReusablePlanStatus("pending")).toBe(true);
    expect(isReusablePlanStatus("refining")).toBe(true);
    expect(isReusablePlanStatus("executing")).toBe(true);
    expect(isReusablePlanStatus(undefined)).toBe(true);
  });
});

describe("findReusablePlanMessage", () => {
  const messages = [
    {
      id: "m1",
      planAction: { status: "pending" as const, title: "Old", filename: "old.md" },
    },
    {
      id: "m2",
      planAction: { status: "executed" as const, title: "Done", filename: "done.md" },
    },
    {
      id: "m3",
      planAction: { status: "pending" as const, title: "Probe", filename: "probe.md" },
    },
    {
      id: "m4",
      planAction: { status: "failed" as const, title: "Probe", filename: "probe.md" },
    },
  ];

  it("prefers preferredMessageId when reusable and identity matches", () => {
    const found = findReusablePlanMessage(messages, { filename: "probe.md" }, "m3");
    expect(found?.id).toBe("m3");
  });

  it("ignores preferred id when status is not reusable", () => {
    const found = findReusablePlanMessage(messages, { filename: "probe.md" }, "m4");
    // m4 failed → reverse scan finds m3
    expect(found?.id).toBe("m3");
  });

  it("reverse-scans to the newest reusable match", () => {
    const found = findReusablePlanMessage(
      [
        ...messages,
        {
          id: "m5",
          planAction: { status: "refining" as const, title: "Probe", filename: "probe.md" },
        },
      ],
      { filename: "probe.md" },
    );
    expect(found?.id).toBe("m5");
  });

  it("returns undefined when only terminal statuses match", () => {
    const found = findReusablePlanMessage(
      [{ id: "x", planAction: { status: "executed" as const, title: "X", filename: "x.md" } }],
      { filename: "x.md" },
    );
    expect(found).toBeUndefined();
  });
});

describe("stripPlanFrontmatter edge cases", () => {
  it("supports CRLF frontmatter delimiters", () => {
    const raw = "---\r\ntitle: x\r\n---\r\nbody line\r\n";
    expect(stripPlanFrontmatter(raw)).toBe("body line");
  });

  it("does not strip mid-document horizontal rules", () => {
    const raw = "# Title\n\n---\n\nstill here";
    expect(stripPlanFrontmatter(raw)).toBe(raw);
  });

  // wave-111 residual
  it("strips leading whitespace before frontmatter and empty body becomes empty string", () => {
    expect(stripPlanFrontmatter("  ---\ntitle: x\n---\n")).toBe("");
    expect(stripPlanFrontmatter("---\ntitle: x\n---\n\n  body  ")).toBe("body");
  });
});

describe("findReusablePlanMessage residual (wave-111)", () => {
  it("skips preferred id when identity does not match and reverse-scans", () => {
    const messages = [
      {
        id: "m1",
        planAction: { status: "pending" as const, title: "A", filename: "a.md" },
      },
      {
        id: "m2",
        planAction: { status: "pending" as const, title: "B", filename: "b.md" },
      },
    ];
    const found = findReusablePlanMessage(messages, { filename: "b.md" }, "m1");
    expect(found?.id).toBe("m2");
  });

  it("treats cancelled as non-reusable", () => {
    expect(isReusablePlanStatus("cancelled")).toBe(false);
    const found = findReusablePlanMessage(
      [{ id: "c", planAction: { status: "cancelled" as const, title: "C", filename: "c.md" } }],
      { filename: "c.md" },
    );
    expect(found).toBeUndefined();
  });

  it("matches preferred by title when filenames are missing", () => {
    const messages = [
      {
        id: "t1",
        planAction: { status: "pending" as const, title: "Write Probe" },
      },
    ];
    expect(findReusablePlanMessage(messages, { title: "write probe" }, "t1")?.id).toBe("t1");
  });
});

describe("plan-utils residual (wave-123)", () => {
  it("treats failed plan status as non-reusable and skips those messages", () => {
    expect(isReusablePlanStatus("failed")).toBe(false);
    expect(isReusablePlanStatus("pending")).toBe(true);
    expect(isReusablePlanStatus(undefined)).toBe(true);
    const found = findReusablePlanMessage(
      [{ id: "f", planAction: { status: "failed" as const, title: "F", filename: "f.md" } }],
      { filename: "f.md" },
    );
    expect(found).toBeUndefined();
  });

  it("locks executing/pausing/paused/completed phases only", () => {
    expect(isLockedPlanPhase("executing")).toBe(true);
    expect(isLockedPlanPhase("pausing")).toBe(true);
    expect(isLockedPlanPhase("paused")).toBe(true);
    expect(isLockedPlanPhase("completed")).toBe(true);
    expect(isLockedPlanPhase("planning")).toBe(false);
    expect(isLockedPlanPhase(undefined)).toBe(false);
    expect(isLockedPlanPhase("")).toBe(false);
  });

  it("prefers most recent matching reusable message when preferred is missing", () => {
    const messages = [
      {
        id: "old",
        planAction: { status: "pending" as const, title: "Same", filename: "same.md" },
      },
      {
        id: "mid",
        planAction: { status: "failed" as const, title: "Same", filename: "same.md" },
      },
      {
        id: "new",
        planAction: { status: "pending" as const, title: "Same", filename: "same.md" },
      },
    ];
    expect(findReusablePlanMessage(messages, { filename: "same.md" })?.id).toBe("new");
    expect(findReusablePlanMessage(messages, { filename: "same.md" }, "ghost")?.id).toBe("new");
  });

  it("stripPlanFrontmatter leaves non-frontmatter content unchanged", () => {
    expect(stripPlanFrontmatter("plain body")).toBe("plain body");
    expect(stripPlanFrontmatter("--- not closed")).toBe("--- not closed");
  });
});

// wave-229 residual
describe("plan-utils residual (wave-229)", () => {
  it("stripPlanFrontmatter supports CRLF delimiters", () => {
    const raw = "---\r\ntitle: x\r\n---\r\nBody line\r\n";
    expect(stripPlanFrontmatter(raw)).toBe("Body line");
  });

  it("preferred id that is non-reusable falls through to newest reusable", () => {
    const messages = [
      {
        id: "old-ok",
        planAction: { status: "pending" as const, title: "Same", filename: "s.md" },
      },
      {
        id: "pref-executed",
        planAction: { status: "executed" as const, title: "Same", filename: "s.md" },
      },
      {
        id: "new-ok",
        planAction: { status: "pending" as const, title: "Same", filename: "s.md" },
      },
    ];
    expect(findReusablePlanMessage(messages, { filename: "s.md" }, "pref-executed")?.id).toBe(
      "new-ok",
    );
  });

  it("isReusablePlanStatus rejects executed/cancelled only as terminal", () => {
    expect(isReusablePlanStatus("executed")).toBe(false);
    expect(isReusablePlanStatus("cancelled")).toBe(false);
    expect(isReusablePlanStatus("failed")).toBe(false);
    expect(isReusablePlanStatus("pending")).toBe(true);
    expect(isReusablePlanStatus("executing")).toBe(true);
  });

  it("samePlanIdentity requires both titles when filenames absent on both", () => {
    expect(samePlanIdentity({ title: "A" }, { title: "a" })).toBe(true);
    expect(samePlanIdentity({ title: "A" }, {})).toBe(false);
    expect(samePlanIdentity({ filename: "x.md" }, { title: "x" })).toBe(false);
  });
});


// wave-295 residual
describe("plan-utils residual (wave-295)", () => {
  it("findReusablePlanMessage without preferred returns newest matching from reverse scan", () => {
    const messages = [
      {
        id: "old",
        planAction: { status: "pending" as const, title: "T", filename: "a.md" },
      },
      {
        id: "mid-failed",
        planAction: { status: "failed" as const, title: "T", filename: "a.md" },
      },
      {
        id: "new",
        planAction: { status: "pending" as const, title: "T", filename: "a.md" },
      },
    ];
    expect(findReusablePlanMessage(messages, { filename: "a.md" })?.id).toBe("new");
    expect(findReusablePlanMessage(messages, { filename: "missing.md" })).toBeUndefined();
  });

  it("preferred id that does not match identity is ignored; cancelled preferred falls through", () => {
    const messages = [
      {
        id: "other-title",
        planAction: { status: "pending" as const, title: "Other", filename: "other.md" },
      },
      {
        id: "pref-cancel",
        planAction: { status: "cancelled" as const, title: "T", filename: "a.md" },
      },
      {
        id: "ok",
        planAction: { status: "executing" as const, title: "T", filename: "a.md" },
      },
    ];
    expect(findReusablePlanMessage(messages, { filename: "a.md" }, "other-title")?.id).toBe("ok");
    expect(findReusablePlanMessage(messages, { filename: "a.md" }, "pref-cancel")?.id).toBe("ok");
    expect(findReusablePlanMessage(messages, { filename: "a.md" }, "missing-id")?.id).toBe("ok");
  });

  it("isLockedPlanPhase is exact-string set; stripPlanFrontmatter trims body only", () => {
    expect(isLockedPlanPhase("EXECUTING")).toBe(false);
    expect(isLockedPlanPhase("complete")).toBe(false);
    expect(isLockedPlanPhase("pausing")).toBe(true);
    expect(stripPlanFrontmatter("  ---\nt:1\n---\n  body  \n")).toBe("body");
    expect(normalizePlanIdentity("  MiXeD  ")).toBe("mixed");
  });
});

// wave-304 residual
describe("plan-utils residual (wave-304)", () => {
  it("stripPlanFrontmatter requires both fences; CRLF supported; non-leading --- kept", () => {
    expect(stripPlanFrontmatter("---\r\ntitle: x\r\n---\r\nbody")).toBe("body");
    expect(stripPlanFrontmatter("prefix\n---\nt:1\n---\nbody")).toBe(
      "prefix\n---\nt:1\n---\nbody",
    );
    expect(stripPlanFrontmatter("---\nonly open fence")).toBe("---\nonly open fence");
    expect(stripPlanFrontmatter("")).toBe("");
  });

  it("samePlanIdentity prefers filename pair; empty filename falls through to title", () => {
    expect(
      samePlanIdentity(
        { filename: "A.MD", title: "ignored" },
        { filename: "a.md", title: "other" },
      ),
    ).toBe(true);
    // empty filename normalizes to falsy → product falls back to title pair
    expect(
      samePlanIdentity({ filename: "", title: "T" }, { filename: "x.md", title: "T" }),
    ).toBe(true);
    expect(
      samePlanIdentity({ filename: "", title: "A" }, { filename: "x.md", title: "B" }),
    ).toBe(false);
    expect(samePlanIdentity({ filename: "x.md" }, { filename: "y.md" })).toBe(false);
  });

  it("findReusablePlanMessage skips messages without planAction; failed preferred falls through", () => {
    const messages = [
      { id: "no-action" },
      {
        id: "pref-failed",
        planAction: { status: "failed" as const, title: "T", filename: "p.md" },
      },
      {
        id: "ok",
        planAction: { status: "pending" as const, title: "T", filename: "p.md" },
      },
    ];
    expect(findReusablePlanMessage(messages, { filename: "p.md" }, "no-action")?.id).toBe("ok");
    expect(findReusablePlanMessage(messages, { filename: "p.md" }, "pref-failed")?.id).toBe("ok");
    expect(findReusablePlanMessage([], { filename: "p.md" })).toBeUndefined();
    expect(isReusablePlanStatus(undefined)).toBe(true);
    expect(isLockedPlanPhase("draft")).toBe(false);
  });
});
