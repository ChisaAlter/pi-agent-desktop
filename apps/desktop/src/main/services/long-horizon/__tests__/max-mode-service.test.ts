import { describe, expect, it, vi } from "vitest";
import { MaxModeService } from "../max-mode-service";

describe("MaxModeService", () => {
    it("runs candidates, judges them, and replays the winner into the primary session", async () => {
        const dispose = vi.fn();
        const service = new MaxModeService({
            candidates: 3,
            createCandidate: vi.fn(async (index) => ({
                id: `c${index}`,
                prompt: vi.fn(async () => undefined),
                readResult: vi.fn(() => `方案 ${index}`),
                dispose,
            })),
            judge: vi.fn(async (candidates) => ({
                winnerId: candidates[1]!.id,
                reason: "第二个更完整",
            })),
        });
        const replay = vi.fn(async () => undefined);

        const result = await service.run({
            prompt: "实现 Goal",
            replayWinner: replay,
        });

        expect(result.winnerId).toBe("c2");
        expect(result.reason).toBe("第二个更完整");
        expect(result.overhead.candidates).toBe(3);
        expect(replay).toHaveBeenCalledWith("方案 2");
        expect(dispose).toHaveBeenCalledTimes(3);
    });
});
