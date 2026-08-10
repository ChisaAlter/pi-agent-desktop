import { describe, expect, it } from "vitest";
import { computeTurnChromeIds } from "./turn-chrome";

describe("computeTurnChromeIds", () => {
    it("marks only the last assistant in each user turn", () => {
        const ids = computeTurnChromeIds([
            { id: "u1", role: "user" },
            { id: "a1", role: "assistant" },
            { id: "a2", role: "assistant" },
            { id: "a3", role: "assistant" },
            { id: "u2", role: "user" },
            { id: "a4", role: "assistant" },
        ]);
        expect([...ids].sort()).toEqual(["a3", "a4"]);
    });

    it("includes the live streaming bubble while streaming", () => {
        const ids = computeTurnChromeIds(
            [
                { id: "u1", role: "user" },
                { id: "a1", role: "assistant" },
            ],
            { isStreaming: true, streamingMessageId: "a1" },
        );
        expect(ids.has("a1")).toBe(true);
    });
});
