import { describe, it, expect, vi } from "vitest";

vi.mock("child_process", () => ({
    execFile: vi.fn(),
}));

import { execFile } from "child_process";
import { searchSkills, listInstalled, installSkill, parseSearchOutput } from "../skillhub-adapter";

describe("parseSearchOutput", () => {
    it("parses valid JSON", () => {
        const json = JSON.stringify({
            query: "hello",
            count: 2,
            results: [
                { slug: "a", name: "A", description: "d", version: "1.0.0", source: "community" },
                { slug: "b", name: "B", description: "d2", version: "1.0.1", source: "official" },
            ],
            warnings: [],
        });
        const r = parseSearchOutput(json);
        expect(r).toHaveLength(2);
        expect(r[0].slug).toBe("a");
        expect(r[0].name).toBe("A");
    });
    it("throws on invalid JSON", () => {
        expect(() => parseSearchOutput("not json")).toThrow();
    });
    it("returns empty on no results", () => {
        const json = JSON.stringify({ query: "x", count: 0, results: [], warnings: [] });
        expect(parseSearchOutput(json)).toHaveLength(0);
    });
});

describe("searchSkills", () => {
    it("calls skillhub with --json and parses", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[]) => {
            expect(cmd).toBe("skillhub");
            expect(args).toContain("search");
            expect(args).toContain("hello");
            expect(args).toContain("--json");
            return Promise.resolve({
                stdout: JSON.stringify({
                    query: "hello", count: 1,
                    results: [{ slug: "x", name: "X", description: "d", version: "1.0.0", source: "community" }],
                    warnings: [],
                }),
                stderr: "",
            });
        });
        const r = await searchSkills("hello");
        expect(r).toHaveLength(1);
        expect(r[0].slug).toBe("x");
    });
    it("rejects on exec error", async () => {
        (execFile as any).mockImplementation(() => {
            return Promise.reject(new Error("skillhub not found"));
        });
        await expect(searchSkills("x")).rejects.toThrow("skillhub not found");
    });
});

describe("listInstalled", () => {
    it("parses text output (one slug per line)", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[]) => {
            expect(args).toContain("list");
            return Promise.resolve({
                stdout: "skill-one\nskill-two\nskill-three\n",
                stderr: "",
            });
        });
        const r = await listInstalled();
        expect(r).toEqual(["skill-one", "skill-two", "skill-three"]);
    });
    it("returns empty array when no skills", async () => {
        (execFile as any).mockImplementation(() => {
            return Promise.resolve({
                stdout: "No installed skills.\n",
                stderr: "",
            });
        });
        const r = await listInstalled();
        expect(r).toEqual([]);
    });
});

describe("installSkill", () => {
    it("calls skillhub install with slug", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[]) => {
            expect(args).toContain("install");
            expect(args).toContain("hello-world");
            return Promise.resolve({
                stdout: "Installing hello-world...\nDone\n",
                stderr: "",
            });
        });
        await installSkill("hello-world");
    });
    it("rejects on install error", async () => {
        (execFile as any).mockImplementation(() => {
            return Promise.reject(new Error("install failed"));
        });
        await expect(installSkill("bad-skill")).rejects.toThrow("install failed");
    });
});
