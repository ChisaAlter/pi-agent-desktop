import { describe, it, expect, vi } from "vitest";

vi.mock("../builtin-skillhub", () => ({
    searchSkills: vi.fn(),
    listInstalled: vi.fn(),
    installSkill: vi.fn(),
    uninstallSkill: vi.fn(),
    checkSkillhubApi: vi.fn(),
    parseSearchOutput: vi.fn((json: string) => {
        const parsed = JSON.parse(json);
        if (!parsed.results || !Array.isArray(parsed.results)) return [];
        return parsed.results.map((r: any) => ({
            slug: r.slug ?? "",
            name: r.name ?? "",
            description: r.description ?? "",
            version: r.version ?? "0.0.0",
            source: r.source,
        }));
    }),
}));

import { searchSkills, listInstalled, installSkill, parseSearchOutput } from "../skillhub-adapter";
import * as builtin from "../builtin-skillhub";

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
    it("calls builtin search and returns results", async () => {
        (builtin.searchSkills as any).mockResolvedValue([
            { slug: "x", name: "X", description: "d", version: "1.0.0", source: "community" },
        ]);
        const r = await searchSkills("hello");
        expect(r).toHaveLength(1);
        expect(r[0].slug).toBe("x");
        expect(builtin.searchSkills).toHaveBeenCalledWith("hello", 20);
    });
    it("rejects on search error", async () => {
        (builtin.searchSkills as any).mockRejectedValue(new Error("search failed"));
        await expect(searchSkills("x")).rejects.toThrow("search failed");
    });
});

describe("listInstalled", () => {
    it("calls builtin list and returns results", async () => {
        (builtin.listInstalled as any).mockResolvedValue(["skill-one", "skill-two", "skill-three"]);
        const r = await listInstalled();
        expect(r).toEqual(["skill-one", "skill-two", "skill-three"]);
    });
    it("returns empty array when no skills", async () => {
        (builtin.listInstalled as any).mockResolvedValue([]);
        const r = await listInstalled();
        expect(r).toEqual([]);
    });
});

describe("installSkill", () => {
    it("calls builtin install with slug", async () => {
        (builtin.installSkill as any).mockResolvedValue(undefined);
        await installSkill("hello-world");
        expect(builtin.installSkill).toHaveBeenCalled();
    });
    it("rejects on install error", async () => {
        (builtin.installSkill as any).mockRejectedValue(new Error("install failed"));
        await expect(installSkill("bad-skill")).rejects.toThrow("install failed");
    });

    // wave-231 residual
    it("fills missing skill fields with empty strings and version 0.0.0", () => {
        const json = JSON.stringify({
            results: [
                { slug: "only-slug" },
                { name: "Named", description: "d", version: "2.0.0", source: "official" },
            ],
        });
        const r = parseSearchOutput(json);
        expect(r).toHaveLength(2);
        expect(r[0]).toEqual({
            slug: "only-slug",
            name: "",
            description: "",
            version: "0.0.0",
            source: undefined,
        });
        expect(r[1].name).toBe("Named");
        expect(r[1].version).toBe("2.0.0");
    });

    it("returns empty array when results is not an array", () => {
        expect(parseSearchOutput(JSON.stringify({ results: null }))).toEqual([]);
        expect(parseSearchOutput(JSON.stringify({ results: "x" }))).toEqual([]);
        expect(parseSearchOutput(JSON.stringify({}))).toEqual([]);
    });
});
