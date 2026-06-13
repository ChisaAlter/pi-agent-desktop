import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { installSkill, isSafeTarEntry } from "../builtin-skillhub";

describe("builtin skillhub installer safety", () => {
    it("rejects tar entries that can escape the target directory", () => {
        expect(isSafeTarEntry("SKILL.md")).toBe(true);
        expect(isSafeTarEntry("nested/SKILL.md")).toBe(true);
        expect(isSafeTarEntry("../SKILL.md")).toBe(false);
        expect(isSafeTarEntry("nested/../../SKILL.md")).toBe(false);
        expect(isSafeTarEntry("/tmp/SKILL.md")).toBe(false);
        expect(isSafeTarEntry("C:/Users/demo/SKILL.md")).toBe(false);
    });

    it("rejects target paths that escape the skills directory before downloading", async () => {
        const dir = await mkdtemp(join(tmpdir(), "pi-skillhub-"));

        await expect(installSkill("../escape", dir)).rejects.toThrow("escapes skills directory");
        await expect(stat(join(dir, ".agents", "escape"))).rejects.toThrow();
    });
});
