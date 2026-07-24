import { describe, expect, it } from "vitest";
import { JUDGE_SYSTEM, VerdictSchema, judgeUser } from "../judge-prompt";

describe("judge-prompt", () => {
  it("exposes judge system prompt with JSON shapes", () => {
    expect(JUDGE_SYSTEM).toContain('"ok": true');
    expect(JUDGE_SYSTEM).toContain('"impossible": true');
    expect(JUDGE_SYSTEM).toContain("reason");
  });

  it("builds user condition prompt", () => {
    const text = judgeUser("all tests pass");
    expect(text).toContain("all tests pass");
    expect(text).toContain("stopping condition");
    expect(text).toContain("transcript evidence");
  });

  it("parses valid verdicts via Zod schema", () => {
    expect(VerdictSchema.parse({ ok: true, reason: "done" })).toEqual({
      ok: true,
      reason: "done",
    });
    expect(
      VerdictSchema.parse({ ok: false, impossible: true, reason: "blocked" }),
    ).toEqual({ ok: false, impossible: true, reason: "blocked" });
  });

  it("rejects verdicts missing reason", () => {
    expect(() => VerdictSchema.parse({ ok: true })).toThrow();
    expect(() => VerdictSchema.parse({ ok: false, reason: 1 })).toThrow();
  });

  // wave-167 residual
  it("embeds empty and special-character conditions without dropping prefix", () => {
    expect(judgeUser("")).toContain("Condition: ");
    expect(judgeUser("a <b> & \"c\"")).toContain('Condition: a <b> & "c"');
    expect(judgeUser("多显示器")).toContain("多显示器");
  });

  it("JUDGE_SYSTEM requires reason and insufficient-evidence default guidance", () => {
    expect(JUDGE_SYSTEM).toContain("insufficient evidence in transcript");
    expect(JUDGE_SYSTEM).toMatch(/When in doubt, return \{"ok": false\} without "impossible"/);
    expect(JUDGE_SYSTEM).toContain("independently confirm");
  });

  it("VerdictSchema strips unknown keys and rejects non-boolean ok", () => {
    const parsed = VerdictSchema.parse({
      ok: false,
      reason: "x",
      extra: "drop-me",
    });
    expect(parsed).toEqual({ ok: false, reason: "x" });
    expect(() => VerdictSchema.parse({ ok: "yes", reason: "x" })).toThrow();
    expect(() => VerdictSchema.parse({ ok: false, impossible: "true", reason: "x" })).toThrow();
  });

  // wave-224 residual
  it("judgeUser prefixes condition exactly once and keeps multiline conditions", () => {
    const multi = "line1\nline2";
    const text = judgeUser(multi);
    expect(text.startsWith("Based on the conversation transcript above")).toBe(true);
    expect(text).toContain(`Condition: ${multi}`);
    expect(text.split("Condition:").length).toBe(2);
  });

  it("VerdictSchema allows ok true with impossible undefined; rejects empty reason as valid string still", () => {
    expect(VerdictSchema.parse({ ok: true, reason: "" })).toEqual({ ok: true, reason: "" });
    expect(VerdictSchema.parse({ ok: false, impossible: false, reason: "no" })).toEqual({
      ok: false,
      impossible: false,
      reason: "no",
    });
    expect(() => VerdictSchema.parse(null)).toThrow();
    expect(() => VerdictSchema.parse({ reason: "only" })).toThrow();
  });

  it("JUDGE_SYSTEM documents all three JSON response shapes", () => {
    expect(JUDGE_SYSTEM).toContain('{"ok": true, "reason":');
    expect(JUDGE_SYSTEM).toContain('{"ok": false, "reason":');
    expect(JUDGE_SYSTEM).toContain('"impossible": true');
    expect(JUDGE_SYSTEM).toContain("JSON object");
  });


  // wave-292 residual
  it("judgeUser interpolates condition after fixed prefix; empty condition keeps Condition label", () => {
    const text = judgeUser("deploy green");
    expect(text).toContain("Based on the conversation transcript above, has the following stopping condition been satisfied?");
    expect(text).toContain("Answer based on transcript evidence only.");
    expect(text.endsWith("Condition: deploy green")).toBe(true);
    expect(judgeUser("").endsWith("Condition: ")).toBe(true);
  });

  it("VerdictSchema requires ok+reason; impossible optional boolean only", () => {
    expect(VerdictSchema.parse({ ok: true, reason: "quote" })).toEqual({
      ok: true,
      reason: "quote",
    });
    expect(
      VerdictSchema.safeParse({ ok: false, impossible: true, reason: "nope" }).success,
    ).toBe(true);
    expect(VerdictSchema.safeParse({ ok: true }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ok: false, reason: 3 }).success).toBe(false);
    expect(JUDGE_SYSTEM).toContain("Mimo Code");
    expect(JUDGE_SYSTEM).toContain("insufficient evidence in transcript");
  });



  // wave-302 residual
  it("judgeUser embeds condition after fixed transcript instructions", () => {
    const text = judgeUser("tests green");
    expect(text).toContain("Based on the conversation transcript above");
    expect(text).toContain("Answer based on transcript evidence only.");
    expect(text).toContain("Condition: tests green");
    expect(judgeUser("a\nb").endsWith("Condition: a\nb")).toBe(true);
  });

  it("VerdictSchema requires ok boolean + reason string; impossible optional", () => {
    expect(VerdictSchema.safeParse({ ok: true, reason: "quote" }).success).toBe(true);
    expect(
      VerdictSchema.safeParse({ ok: false, impossible: true, reason: "blocked" }).success,
    ).toBe(true);
    expect(VerdictSchema.safeParse({ ok: true }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ok: "true", reason: "x" }).success).toBe(false);
    expect(JUDGE_SYSTEM).toContain('"ok": true');
    expect(JUDGE_SYSTEM).toContain("insufficient evidence in transcript");
  });


  // wave-316 residual
  it("JUDGE_SYSTEM requires independent confirmation and three JSON shapes", () => {
    expect(JUDGE_SYSTEM).toContain("independently confirm");
    expect(JUDGE_SYSTEM).toContain("assistant claiming the goal is impossible is evidence, not proof");
    expect(JUDGE_SYSTEM).toContain('{"ok": true, "reason":');
    expect(JUDGE_SYSTEM).toContain('{"ok": false, "reason":');
    expect(JUDGE_SYSTEM).toContain('"impossible": true');
    expect(JUDGE_SYSTEM).toContain('When in doubt, return {"ok": false} without "impossible"');
  });

  it("judgeUser keeps Condition label and does not escape condition content", () => {
    const weird = ["nested-label", String.fromCharCode(10), '{"ok": true}'].join("");
    const text = judgeUser(weird);
    expect(text).toContain("Condition: " + weird);
    // only the product label prefix, not inside condition
    expect(text.split("Condition:").length).toBe(2);
    expect(text).toContain("transcript evidence only");
    // if condition itself includes the label token, product still embeds raw
    const nested = "Condition: inside";
    const nestedText = judgeUser(nested);
    expect(nestedText).toContain("Condition: Condition: inside");
    expect(nestedText.split("Condition:").length).toBe(3);
  });

  it("VerdictSchema allows ok true with impossible true; rejects non-string reason", () => {
    expect(
      VerdictSchema.parse({ ok: true, impossible: true, reason: "schema allows combo" }),
    ).toEqual({ ok: true, impossible: true, reason: "schema allows combo" });
    expect(VerdictSchema.safeParse({ ok: false, reason: null }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ok: false, reason: ["x"] }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ok: false, impossible: 1, reason: "x" }).success).toBe(false);
  });


});
