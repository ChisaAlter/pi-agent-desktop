import { describe, expect, it } from "vitest";
import { stripPlanFrontmatter } from "../plan-utils";
import { buildPlanExecutionPrompt } from "../plan-execution-prompt";

describe("stripPlanFrontmatter (plan-utils)", () => {
  it("removes YAML frontmatter when present", () => {
    const raw = "---\ntitle: x\nstatus: draft\n---\n# Goal\nDo the thing\n";
    expect(stripPlanFrontmatter(raw)).toBe("# Goal\nDo the thing");
  });

  it("returns content unchanged without frontmatter", () => {
    expect(stripPlanFrontmatter("# Plan\nstep 1")).toBe("# Plan\nstep 1");
  });
});

describe("buildPlanExecutionPrompt", () => {
  it("includes title, filename, option, and body without frontmatter", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "写 probe",
      filename: "plan-abc.md",
      selectedOption: "A",
      content: "---\ntitle: t\n---\n1. write plan_probe.txt\n2. verify PLAN_OK\n",
    });
    expect(outbound).toContain("请直接执行下面这份计划，不要重新生成计划。");
    expect(outbound).toContain("计划标题：写 probe");
    expect(outbound).toContain("计划文件：plan-abc.md");
    expect(outbound).toContain("已选择执行方案：A");
    expect(outbound).toContain("1. write plan_probe.txt");
    expect(outbound).toContain("[PLAN_DONE]");
    expect(outbound).toContain("[DONE:n]");
    expect(outbound).not.toContain("title: t");
  });

  it("omits filename and option lines when absent", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "简单计划",
      content: "step one",
    });
    expect(outbound).toContain("计划标题：简单计划");
    expect(outbound).not.toContain("计划文件：");
    expect(outbound).not.toContain("已选择执行方案：");
    expect(outbound).toContain("step one");
  });

  it("falls back body when content empty after strip", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "空",
      content: "---\nx: 1\n---\n   \n",
    });
    expect(outbound).toContain("执行当前计划。");
  });

  // wave-227 residual
  it("keeps DONE/PLAN_DONE contract lines and filters empty optional slots", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "T",
      content: "body line",
    });
    const lines = outbound.split("\n");
    expect(lines[0]).toBe("请直接执行下面这份计划，不要重新生成计划。");
    expect(lines).toContain("执行要求：");
    expect(lines).toContain("2. 每完成一个主要步骤，就输出一个 [DONE:n] 标记，n 从 1 开始递增。");
    expect(lines).toContain(
      "5. 只有全部步骤都完成时，先单独输出一行 [PLAN_DONE]，再输出最终中文总结。",
    );
    expect(lines).toContain("计划内容：");
    expect(lines).toContain("body line");
    // no consecutive blank lines from filtered undefined optional fields
    expect(outbound.includes("\n\n\n")).toBe(false);
  });

  it("preserves multi-line body and does not re-strip already bare content", () => {
    const body = "# Steps\n1. a\n2. b\n";
    const outbound = buildPlanExecutionPrompt({
      title: "multi",
      filename: "x.md",
      selectedOption: "B",
      content: body,
    });
    expect(outbound).toContain("# Steps");
    expect(outbound).toContain("1. a");
    expect(outbound).toContain("2. b");
    expect(outbound).toContain("已选择执行方案：B");
    expect(outbound).toContain("计划文件：x.md");
  });
});


// wave-294 residual
describe("buildPlanExecutionPrompt residual (wave-294)", () => {
  it("filters empty-string optional filename/option via Boolean(line)", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "T",
      filename: "",
      selectedOption: "",
      content: "body",
    });
    expect(outbound).not.toContain("计划文件：");
    expect(outbound).not.toContain("已选择执行方案：");
    expect(outbound).toContain("计划标题：T");
    expect(outbound).toContain("body");
  });

  it("uses fallback body for empty/whitespace-only content and trims stripped plan", () => {
    expect(buildPlanExecutionPrompt({ title: "e", content: "" })).toContain("执行当前计划。");
    expect(buildPlanExecutionPrompt({ title: "w", content: "   \n\t  " })).toContain("执行当前计划。");
    const outbound = buildPlanExecutionPrompt({
      title: "pad",
      content: "---\nk: v\n---\n  \n  step  \n  ",
    });
    expect(outbound).toContain("step");
    // join does not leave trailing/leading blank-only body noise after filter
    const afterLabel = outbound.split("计划内容：\n")[1] ?? "";
    expect(afterLabel.startsWith(" ")).toBe(false);
  });

  it("keeps fixed 5 execution-requirement lines and title even when only title+content", () => {
    const lines = buildPlanExecutionPrompt({ title: "only", content: "x" }).split("\n");
    expect(lines.filter((l) => /^\d\./.test(l))).toHaveLength(5);
    expect(lines).toContain("1. 严格按顺序实施并验证每个步骤。");
    expect(lines).toContain("3. 如果遇到阻塞，只说明阻塞点和原因，不要假装完成。");
    expect(lines).toContain("4. 完成全部步骤后，再用简短中文总结结果。");
    expect(lines.indexOf("计划标题：only")).toBeLessThan(lines.indexOf("执行要求："));
    expect(lines.indexOf("执行要求：")).toBeLessThan(lines.indexOf("计划内容："));
  });
});

// wave-305 residual
describe("buildPlanExecutionPrompt residual (wave-305)", () => {
  it("includes optional filename and selectedOption only when truthy after filter", () => {
    const full = buildPlanExecutionPrompt({
      title: "标题",
      filename: "plan.md",
      selectedOption: "方案B",
      content: "step",
    });
    expect(full).toContain("计划文件：plan.md");
    expect(full).toContain("已选择执行方案：方案B");
    expect(full).toContain("请直接执行下面这份计划，不要重新生成计划。");

    const bare = buildPlanExecutionPrompt({ title: "T", content: "x" });
    expect(bare).not.toContain("计划文件：");
    expect(bare).not.toContain("已选择执行方案：");
  });

  it("strips YAML frontmatter before body; empty stripped body uses 执行当前计划。", () => {
    const outbound = buildPlanExecutionPrompt({
      title: "P",
      content: "---\ntitle: hidden\n---\n\n",
    });
    expect(outbound).toContain("执行当前计划。");
    expect(outbound).not.toContain("title: hidden");
  });

  it("execution requirements keep DONE markers contract in fixed order", () => {
    const lines = buildPlanExecutionPrompt({ title: "o", content: "body" }).split("\n");
    const reqStart = lines.indexOf("执行要求：");
    const bodyStart = lines.indexOf("计划内容：");
    expect(reqStart).toBeGreaterThan(0);
    expect(bodyStart).toBeGreaterThan(reqStart);
    expect(lines.slice(reqStart + 1, bodyStart).filter((l) => /^\d\./.test(l))).toHaveLength(5);
    expect(lines.some((l) => l.includes("[DONE:n]"))).toBe(true);
    expect(lines.some((l) => l.includes("[PLAN_DONE]"))).toBe(true);
  });
});
