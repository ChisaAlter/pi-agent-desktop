/**
 * M3 E2E 冒烟测试
 */
import { describe, it, expect } from "vitest";
import { parseSearchOutput } from "../../main/services/skills/skillhub-adapter";

describe("M3 utilities", () => {
    it("parseSearchOutput: handles valid JSON", () => {
        const json = JSON.stringify({
            query: "x", count: 1,
            results: [{ slug: "a", name: "A", description: "d", version: "1.0.0" }],
            warnings: [],
        });
        const r = parseSearchOutput(json);
        expect(r).toHaveLength(1);
        expect(r[0].slug).toBe("a");
        expect(r[0].name).toBe("A");
    });

    it("parseSearchOutput: empty results", () => {
        expect(
            parseSearchOutput(JSON.stringify({ query: "x", count: 0, results: [], warnings: [] }))
        ).toHaveLength(0);
    });

    it("parseSearchOutput: throws on invalid JSON", () => {
        expect(() => parseSearchOutput("bad json")).toThrow();
    });

    it("parseSearchOutput: maps source field", () => {
        const json = JSON.stringify({
            query: "x", count: 2,
            results: [
                { slug: "official-1", name: "O", description: "d", version: "1.0.0", source: "official" },
                { slug: "community-1", name: "C", description: "d", version: "1.0.0", source: "community" },
            ],
            warnings: [],
        });
        const r = parseSearchOutput(json);
        expect(r[0].source).toBe("official");
        expect(r[1].source).toBe("community");
    });
});
