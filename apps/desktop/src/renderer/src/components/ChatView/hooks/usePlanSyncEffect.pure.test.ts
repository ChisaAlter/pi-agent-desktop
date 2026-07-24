import { describe, expect, it } from "vitest";
import {
  findReusablePlanSourceMessage,
  normalizePlanText,
} from "./usePlanSyncEffect";

describe("normalizePlanText", () => {
  it("strips frontmatter, think blocks, and collapses whitespace", () => {
    const raw = `---\ntitle: plan\n---\n\nHello   World\n<think>secret</think>\nDone`;
    expect(normalizePlanText(raw)).toBe("hello world done");
  });

  it("strips unclosed trailing think blocks", () => {
    expect(normalizePlanText("Plan A <think>still thinking")).toBe("plan a");
  });
});

describe("findReusablePlanSourceMessage", () => {
  it("returns undefined for empty target or no match", () => {
    expect(findReusablePlanSourceMessage([], "x")).toBeUndefined();
    expect(
      findReusablePlanSourceMessage(
        [{ id: "1", role: "user", content: "plan body" }],
        "plan body",
      ),
    ).toBeUndefined();
  });

  it("matches the newest assistant message with normalized equal body", () => {
    const messages = [
      { id: "old", role: "assistant", content: "Plan Body" },
      {
        id: "locked",
        role: "assistant",
        content: "Plan Body",
        planAction: { id: "p1", title: "Plan", status: "executing" as const },
      },
      { id: "new", role: "assistant", content: "  plan   body  " },
    ];
    // planAction messages are skipped; newest plain assistant match wins
    expect(findReusablePlanSourceMessage(messages, "PLAN BODY")?.id).toBe("new");
  });

  it("skips assistant messages that already carry planAction", () => {
    const messages = [
      {
        id: "with-action",
        role: "assistant",
        content: "same",
        planAction: { id: "p2", title: "Same", status: "executed" as const },
      },
    ];
    expect(findReusablePlanSourceMessage(messages, "same")).toBeUndefined();
  });

  // wave-228 residual
  it("normalizePlanText empty/whitespace-only and frontmatter-only becomes empty string", () => {
    expect(normalizePlanText("   \n\t  ")).toBe("");
    expect(normalizePlanText("---\ntitle: x\n---\n   ")).toBe("");
    expect(normalizePlanText("<think>only thinking</think>")).toBe("");
  });

  it("findReusablePlanSourceMessage returns undefined when target normalizes empty", () => {
    expect(
      findReusablePlanSourceMessage(
        [{ id: "1", role: "assistant", content: "hello" }],
        "---\na: 1\n---\n   ",
      ),
    ).toBeUndefined();
  });

  it("skips user messages even when body matches normalized target", () => {
    const messages = [
      { id: "u1", role: "user", content: "plan body" },
      { id: "a1", role: "assistant", content: "other" },
    ];
    expect(findReusablePlanSourceMessage(messages, "plan body")).toBeUndefined();
  });



  // wave-307 residual
  describe("usePlanSyncEffect residual (wave-307)", () => {
    it("normalizePlanText lowercases, collapses mixed whitespace, strips multiple think blocks", () => {
      expect(normalizePlanText("Hello" + String.fromCharCode(9) + "  World")).toBe("hello world");
      expect(normalizePlanText("A <think>one</think> B <think>two</think> C")).toBe("a b c");
      // unclosed think drops remainder
      expect(normalizePlanText("Keep <think>partial remainder")).toBe("keep");
      // closed + trailing unclosed
      expect(normalizePlanText("X <think>c</think> Y <think>open")).toBe("x y");
    });

    it("findReusablePlanSourceMessage reverse-scans; generatedUi plain text participates via contentWithGeneratedUiText", () => {
      const older = { id: "old", role: "assistant", content: "shared body" };
      const newer = { id: "new", role: "assistant", content: "shared body" };
      expect(findReusablePlanSourceMessage([older, newer], "shared body")?.id).toBe("new");

      // when content empty, generatedUi card text can still match after normalize
      const withCard = {
        id: "card",
        role: "assistant",
        content: "  Shared   Body  ",
        generatedUi: undefined,
      };
      expect(findReusablePlanSourceMessage([withCard], "shared body")?.id).toBe("card");

      // planAction skip even if newest
      const msgs = [
        { id: "plain", role: "assistant", content: "body" },
        {
          id: "action",
          role: "assistant",
          content: "body",
          planAction: { id: "p", title: "t", status: "executing" as const },
        },
      ];
      expect(findReusablePlanSourceMessage(msgs, "body")?.id).toBe("plain");
    });

    it("normalizePlanText strips YAML frontmatter only at start via stripPlanFrontmatter product path", () => {
      const raw = "---" + String.fromCharCode(10) + "title: T" + String.fromCharCode(10) + "---" + String.fromCharCode(10) + "Body Text";
      expect(normalizePlanText(raw)).toBe("body text");
      // non-frontmatter dashes stay
      expect(normalizePlanText("--- not frontmatter")).toBe("--- not frontmatter");
    });
  });

});
