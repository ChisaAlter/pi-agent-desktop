import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLocalSkills } from "../list-local-skills";

describe("listLocalSkills", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "list-local-skills-"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty when .agents/skills is missing", async () => {
    await expect(listLocalSkills(root)).resolves.toEqual([]);
  });

  it("lists skill directories with first non-heading line as description", async () => {
    const skillDir = join(root, ".agents", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "# Demo\n\nUseful demo skill for tests.\n\nMore body\n",
      "utf-8",
    );
    // file entry should be ignored
    writeFileSync(join(root, ".agents", "skills", "not-a-dir.txt"), "x", "utf-8");

    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      {
        name: "demo-skill",
        description: "Useful demo skill for tests.",
        path: skillDir,
        enabled: true,
      },
    ]);
  });

  it("caches results for 30s TTL then refreshes", async () => {
    const skillDir = join(root, ".agents", "skills", "cached");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "First desc\n", "utf-8");

    const first = await listLocalSkills(root);
    expect(first[0]?.description).toBe("First desc");

    writeFileSync(join(skillDir, "SKILL.md"), "Second desc\n", "utf-8");
    // within TTL → still first
    const cached = await listLocalSkills(root);
    expect(cached[0]?.description).toBe("First desc");

    vi.advanceTimersByTime(30_001);
    const refreshed = await listLocalSkills(root);
    expect(refreshed[0]?.description).toBe("Second desc");
  });

  it("tolerates missing SKILL.md with empty description", async () => {
    const skillDir = join(root, ".agents", "skills", "bare");
    mkdirSync(skillDir, { recursive: true });
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      {
        name: "bare",
        description: "",
        path: skillDir,
        enabled: true,
      },
    ]);
  });

  // wave-103 residual
  it("lists multiple skills and truncates long descriptions", async () => {
    for (const name of ["alpha", "beta"]) {
      const skillDir = join(root, ".agents", "skills", name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `# ${name}\n\n${"x".repeat(150)}\n`,
        "utf-8",
      );
    }
    const skills = await listLocalSkills(root);
    expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    for (const skill of skills) {
      expect(skill.description.length).toBe(100);
      expect(skill.enabled).toBe(true);
    }
  });

  it("ignores pure markdown headings when deriving description", async () => {
    const skillDir = join(root, ".agents", "skills", "headings-only");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Title\n## Sub\n### Nested\n", "utf-8");
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      expect.objectContaining({ name: "headings-only", description: "" }),
    ]);
  });

  it("caches per workspace path independently", async () => {
    const other = mkdtempSync(join(tmpdir(), "list-local-skills-other-"));
    try {
      const aDir = join(root, ".agents", "skills", "a");
      const bDir = join(other, ".agents", "skills", "b");
      mkdirSync(aDir, { recursive: true });
      mkdirSync(bDir, { recursive: true });
      writeFileSync(join(aDir, "SKILL.md"), "A desc\n", "utf-8");
      writeFileSync(join(bDir, "SKILL.md"), "B desc\n", "utf-8");

      const a = await listLocalSkills(root);
      const b = await listLocalSkills(other);
      expect(a.map((s) => s.name)).toEqual(["a"]);
      expect(b.map((s) => s.name)).toEqual(["b"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  // wave-124 residual
  it("skips blank lines before the first non-heading description", async () => {
    const skillDir = join(root, ".agents", "skills", "spaced");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Title\n\n\n  First real line  \n\nbody\n", "utf-8");
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      expect.objectContaining({
        name: "spaced",
        description: "First real line",
        enabled: true,
      }),
    ]);
  });

  it("caches empty results for missing skills dirs within TTL", async () => {
    const missing = await listLocalSkills(root);
    expect(missing).toEqual([]);
    mkdirSync(join(root, ".agents", "skills", "late"), { recursive: true });
    writeFileSync(join(root, ".agents", "skills", "late", "SKILL.md"), "Late desc\n", "utf-8");
    // still within 30s TTL of empty cache
    await expect(listLocalSkills(root)).resolves.toEqual([]);
    vi.advanceTimersByTime(30_001);
    const refreshed = await listLocalSkills(root);
    expect(refreshed.map((s) => s.name)).toEqual(["late"]);
  });

  // wave-171 residual
  it("truncates description at exactly 100 chars and handles CRLF + headings", async () => {
    const skillDir = join(root, ".agents", "skills", "edge");
    mkdirSync(skillDir, { recursive: true });
    const exact = "e".repeat(100);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `# Title\r\n\r\n${exact}OVERFLOW\r\n`,
      "utf-8",
    );
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      expect.objectContaining({
        name: "edge",
        description: exact,
        enabled: true,
      }),
    ]);
    expect(skills[0].description).not.toContain("OVERFLOW");
  });

  it("ignores non-directory skill entries and keeps enabled true always", async () => {
    const skillsRoot = join(root, ".agents", "skills");
    mkdirSync(join(skillsRoot, "keep"), { recursive: true });
    writeFileSync(join(skillsRoot, "keep", "SKILL.md"), "Keep me\n", "utf-8");
    writeFileSync(join(skillsRoot, "file-only.md"), "not a skill dir", "utf-8");
    writeFileSync(join(skillsRoot, "SKILL.md"), "root skill md ignored", "utf-8");
    const skills = await listLocalSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["keep"]);
    expect(skills[0].enabled).toBe(true);
    expect(skills[0].description).toBe("Keep me");
  });

  // wave-233 residual
  it("startsWith('#') is untrimmed: leading-space hash line is description", async () => {
    const skillDir = join(root, ".agents", "skills", "hash-body");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "# Title\n  # indented hash is not a heading skip\n# another\n  real desc  \n",
      "utf-8",
    );
    // product: filter(l.trim()) then line.startsWith('#') on original line
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      expect.objectContaining({
        name: "hash-body",
        description: "# indented hash is not a heading skip",
        enabled: true,
      }),
    ]);
  });

  it("path is absolute skill dir; empty SKILL.md yields empty description", async () => {
    const skillDir = join(root, ".agents", "skills", "empty-md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "", "utf-8");
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      {
        name: "empty-md",
        description: "",
        path: skillDir,
        enabled: true,
      },
    ]);
  });

  it("TTL boundary: age < 30000 cache hit; age === 30000 refreshes", async () => {
    const skillDir = join(root, ".agents", "skills", "ttl-edge");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "v1\n", "utf-8");
    expect((await listLocalSkills(root))[0]?.description).toBe("v1");
    writeFileSync(join(skillDir, "SKILL.md"), "v2\n", "utf-8");
    // product: Date.now() - cached.ts < CACHE_TTL (strict less-than)
    vi.advanceTimersByTime(29_999);
    expect((await listLocalSkills(root))[0]?.description).toBe("v1");
    vi.advanceTimersByTime(1);
    expect((await listLocalSkills(root))[0]?.description).toBe("v2");
  });

  // wave-264 residual
  it("ignores files in skills root; only directories become skills; missing dir empty", async () => {
    const skillsRoot = join(root, ".agents", "skills");
    mkdirSync(skillsRoot, { recursive: true });
    writeFileSync(join(skillsRoot, "README.md"), "not a skill", "utf-8");
    const onlyFile = await listLocalSkills(root);
    expect(onlyFile).toEqual([]);

    const skillDir = join(skillsRoot, "dir-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "first real line\nsecond\n", "utf-8");
    // product: empty result is cached for 30s; new dirs invisible until TTL expires
    expect(await listLocalSkills(root)).toEqual([]);
    vi.advanceTimersByTime(30_000);
    const listed = await listLocalSkills(root);
    expect(listed).toEqual([
      expect.objectContaining({
        name: "dir-skill",
        description: "first real line",
        path: skillDir,
        enabled: true,
      }),
    ]);

    const missing = join(root, "no-workspace-here");
    expect(await listLocalSkills(missing)).toEqual([]);
  });

  it("description truncates to 100 chars; cache keyed per workspacePath", async () => {
    const long = "x".repeat(150);
    const skillDir = join(root, ".agents", "skills", "long-desc");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `${long}\n`, "utf-8");
    const a = await listLocalSkills(root);
    expect(a[0]?.description).toHaveLength(100);
    expect(a[0]?.description).toBe("x".repeat(100));

    // second workspace path is independent cache key
    const root2 = join(root, "ws2");
    mkdirSync(join(root2, ".agents", "skills", "other"), { recursive: true });
    writeFileSync(join(root2, ".agents", "skills", "other", "SKILL.md"), "other-desc\n", "utf-8");
    const b = await listLocalSkills(root2);
    expect(b.map((s) => s.name)).toEqual(["other"]);
    // original cache still returns long-desc without seeing other
    const a2 = await listLocalSkills(root);
    expect(a2.map((s) => s.name)).toContain("long-desc");
    expect(a2.map((s) => s.name)).not.toContain("other");
  });


  // wave-274 residual
  it("skips heading-only and blank lines; first non-heading body is description", async () => {
    const skillDir = join(root, ".agents", "skills", "heading-only");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "# Title\n## Sub\n\n\n  Actual body line here  \n# after\n",
      "utf-8",
    );
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      {
        name: "heading-only",
        description: "Actual body line here",
        path: skillDir,
        enabled: true,
      },
    ]);
  });

  it("missing SKILL.md still lists skill with empty description; enabled always true", async () => {
    const skillDir = join(root, ".agents", "skills", "no-md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "README.md"), "not skill md", "utf-8");
    const skills = await listLocalSkills(root);
    expect(skills).toEqual([
      {
        name: "no-md",
        description: "",
        path: skillDir,
        enabled: true,
      },
    ]);
  });

  it("cache hit returns same array reference within TTL", async () => {
    const skillDir = join(root, ".agents", "skills", "ref-cache");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "desc\n", "utf-8");
    const a = await listLocalSkills(root);
    const b = await listLocalSkills(root);
    expect(a).toBe(b);
    vi.advanceTimersByTime(30_000);
    const c = await listLocalSkills(root);
    expect(c).not.toBe(a);
    expect(c).toEqual(a);
  });

  // wave-283 residual
  it("skips non-directory entries; description is first non-heading line capped at 100", async () => {
    const skillDir = join(root, ".agents", "skills", "capped");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(root, ".agents", "skills", "not-a-dir.txt"), "file", "utf-8");
    const long = "x".repeat(150);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `# Title\n\n# another heading\n${long}\nsecond line ignored\n`,
      "utf-8",
    );
    const skills = await listLocalSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["capped"]);
    expect(skills[0]?.description).toBe("x".repeat(100));
    expect(skills[0]?.enabled).toBe(true);
  });

  it("missing skills dir caches empty and stays empty within TTL across workspaces", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "pi-skills-empty-"));
    const a = await listLocalSkills(emptyRoot);
    const b = await listLocalSkills(emptyRoot);
    expect(a).toEqual([]);
    expect(a).toBe(b);
    // different workspace path is independent cache key
    const other = await listLocalSkills(root);
    expect(other).not.toBe(a);
    rmSync(emptyRoot, { recursive: true, force: true });
  });



});
