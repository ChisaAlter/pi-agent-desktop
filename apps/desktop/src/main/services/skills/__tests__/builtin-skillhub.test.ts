import { mkdir, mkdtemp, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
    installSkill,
    isSafeTarEntry,
    listInstalled,
    parseSearchOutput,
    uninstallSkill,
} from "../builtin-skillhub";

describe("builtin skillhub installer safety", () => {
    it("rejects tar entries that can escape the target directory", () => {
        expect(isSafeTarEntry("SKILL.md")).toBe(true);
        expect(isSafeTarEntry("nested/SKILL.md")).toBe(true);
        expect(isSafeTarEntry("nested\\SKILL.md")).toBe(true);
        expect(isSafeTarEntry("")).toBe(true);
        expect(isSafeTarEntry("   ")).toBe(true);
        expect(isSafeTarEntry("../SKILL.md")).toBe(false);
        expect(isSafeTarEntry("nested/../../SKILL.md")).toBe(false);
        expect(isSafeTarEntry("/tmp/SKILL.md")).toBe(false);
        expect(isSafeTarEntry("~/SKILL.md")).toBe(false);
        expect(isSafeTarEntry("C:/Users/demo/SKILL.md")).toBe(false);
        expect(isSafeTarEntry("C:\\Users\\demo\\SKILL.md")).toBe(false);
    });

    it("rejects target paths that escape the skills directory before downloading", async () => {
        const dir = await mkdtemp(join(tmpdir(), "pi-skillhub-"));

        await expect(installSkill("../escape", dir)).rejects.toThrow("escapes skills directory");
        await expect(stat(join(dir, ".agents", "escape"))).rejects.toThrow();
    });

    it("rejects uninstall slugs that escape the skills directory", async () => {
        const dir = await mkdtemp(join(tmpdir(), "pi-skillhub-un-"));
        const skillsDir = join(dir, ".agents", "skills");
        await mkdir(skillsDir, { recursive: true });
        // Sentinel outside skills dir must survive a path-escape uninstall attempt.
        const sentinel = join(dir, ".agents", "escape-marker.txt");
        await writeFile(sentinel, "keep", "utf8");

        await expect(uninstallSkill("../escape-marker.txt", dir)).rejects.toThrow(
            "escapes skills directory",
        );
        await expect(stat(sentinel)).resolves.toBeTruthy();
    });
});

describe("listInstalled", () => {
    it("returns empty when .agents/skills is missing", async () => {
        const dir = await mkdtemp(join(tmpdir(), "pi-skillhub-list-"));
        await expect(listInstalled(dir)).resolves.toEqual([]);
    });

    it("lists only skill directories", async () => {
        const dir = await mkdtemp(join(tmpdir(), "pi-skillhub-list-"));
        const skillsDir = join(dir, ".agents", "skills");
        await mkdir(join(skillsDir, "alpha"), { recursive: true });
        await mkdir(join(skillsDir, "beta"), { recursive: true });
        await writeFile(join(skillsDir, "not-a-dir.md"), "x", "utf8");

        const names = await listInstalled(dir);
        expect(names.sort()).toEqual(["alpha", "beta"]);
    });
});

describe("parseSearchOutput", () => {
    it("maps missing fields to safe defaults", () => {
        const json = JSON.stringify({
            results: [{ slug: "s1" }, { name: "OnlyName" }],
        });
        expect(parseSearchOutput(json)).toEqual([
            { slug: "s1", name: "", description: "", version: "0.0.0", source: undefined },
            { slug: "", name: "OnlyName", description: "", version: "0.0.0", source: undefined },
        ]);
    });

    it("throws on invalid JSON", () => {
        expect(() => parseSearchOutput("not-json")).toThrow(/not valid JSON/);
    });

    it("returns empty when results is missing or not an array", () => {
        expect(parseSearchOutput(JSON.stringify({}))).toEqual([]);
        expect(parseSearchOutput(JSON.stringify({ results: null }))).toEqual([]);
        expect(parseSearchOutput(JSON.stringify({ results: "x" }))).toEqual([]);
    });

    // wave-171 residual
    it("preserves full skill fields and empty results array", () => {
        const json = JSON.stringify({
            results: [
                {
                    slug: "full",
                    name: "Full",
                    description: "desc",
                    version: "2.1.0",
                    source: "official",
                },
            ],
        });
        expect(parseSearchOutput(json)).toEqual([
            {
                slug: "full",
                name: "Full",
                description: "desc",
                version: "2.1.0",
                source: "official",
            },
        ]);
        expect(parseSearchOutput(JSON.stringify({ results: [] }))).toEqual([]);
    });
});

describe("isSafeTarEntry residual (wave-171)", () => {
    it("rejects absolute/UNC-like and parent segments; allows nested relative", () => {
        expect(isSafeTarEntry("./nested/file.md")).toBe(true);
        expect(isSafeTarEntry("a/b/c.txt")).toBe(true);
        expect(isSafeTarEntry("..")).toBe(false);
        expect(isSafeTarEntry("a/../b")).toBe(false);
        expect(isSafeTarEntry("d:/x")).toBe(false);
        expect(isSafeTarEntry("E:\\x")).toBe(false);
        expect(isSafeTarEntry("/var/tmp/x")).toBe(false);
        expect(isSafeTarEntry("~/hidden")).toBe(false);
    });
});

// wave-235 residual
describe("isSafeTarEntry residual (wave-235)", () => {
    it("empty/whitespace-only entries are treated as safe", () => {
        expect(isSafeTarEntry("")).toBe(true);
        expect(isSafeTarEntry("   ")).toBe(true);
        expect(isSafeTarEntry("\t")).toBe(true);
    });

    it("normalizes backslashes then rejects parent and drive prefixes", () => {
        expect(isSafeTarEntry("safe\\nested\\file.md")).toBe(true);
        expect(isSafeTarEntry("safe\\..\\evil")).toBe(false);
        expect(isSafeTarEntry("C:\\Windows\\x")).toBe(false);
        expect(isSafeTarEntry("z:/abs")).toBe(false);
    });

    it("rejects absolute unix paths and home tilde; allows single-dot segments", () => {
        expect(isSafeTarEntry("/etc/passwd")).toBe(false);
        expect(isSafeTarEntry("~/.ssh/id")).toBe(false);
        expect(isSafeTarEntry("./ok.md")).toBe(true);
        expect(isSafeTarEntry("ok.md")).toBe(true);
    });
});

describe("parseSearchOutput residual (wave-235)", () => {
    it("defaults missing fields to empty string / 0.0.0 and keeps optional source", () => {
        expect(
            parseSearchOutput(
                JSON.stringify({
                    results: [{ slug: "s1" }, { name: "only-name", version: "1.2.3" }],
                }),
            ),
        ).toEqual([
            { slug: "s1", name: "", description: "", version: "0.0.0", source: undefined },
            {
                slug: "",
                name: "only-name",
                description: "",
                version: "1.2.3",
                source: undefined,
            },
        ]);
    });

    it("throws on invalid JSON and returns [] when results missing/non-array", () => {
        expect(() => parseSearchOutput("not-json")).toThrow(/not valid JSON/);
        expect(parseSearchOutput(JSON.stringify({}))).toEqual([]);
        expect(parseSearchOutput(JSON.stringify({ results: { slug: "x" } }))).toEqual([]);
    });



// wave-308 residual
describe("skillhub pure residual (wave-308)", () => {
  it("isSafeTarEntry trims; rejects absolute unix/windows/tilde; allows empty after trim", () => {
    expect(isSafeTarEntry("  ok/file.md  ")).toBe(true);
    expect(isSafeTarEntry("  ")).toBe(true);
    expect(isSafeTarEntry("a/../../b")).toBe(false);
    expect(isSafeTarEntry("..\\evil")).toBe(false);
    expect(isSafeTarEntry("c:/abs")).toBe(false);
    expect(isSafeTarEntry("nested/../ok")).toBe(false);
    expect(isSafeTarEntry("nested/./ok")).toBe(true);
  });

  it("parseSearchOutput defaults missing fields; preserves source; rejects non-array results", () => {
    expect(
      parseSearchOutput(
        JSON.stringify({
          results: [{}, { slug: "s", name: "N", description: "D", version: "1.2.3", source: "hub" }],
        }),
      ),
    ).toEqual([
      { slug: "", name: "", description: "", version: "0.0.0", source: undefined },
      { slug: "s", name: "N", description: "D", version: "1.2.3", source: "hub" },
    ]);
    expect(parseSearchOutput(JSON.stringify({ results: 3 }))).toEqual([]);
    expect(() => parseSearchOutput("{")).toThrow(/not valid JSON/);
  });
});

});
