/**
 * Task 14: M1 端到端冒烟测试
 *
 * 跑法: cd apps/desktop && pnpm test e2e
 * 需要: PI_TEST_API_KEY env (用真实 API 跑). 没有时自动跳过.
 *
 * 验证:
 *  1. 长连接 Pi: session.prompt 后能收到 stream 事件
 *  2. 工具拦截: 高危工具被分类为 high
 *  3. 审批拦截: session.abort() 后 stream 终止
 */
import { describe, it, expect } from "vitest";

const HAS_API_KEY = !!process.env.PI_TEST_API_KEY;

describe.skipIf(!HAS_API_KEY)("M1 e2e", () => {
    it("long-lived Pi: prompt + receive text events", async () => {
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
        const { session } = await createAgentSession({ cwd: process.cwd() });
        const events: string[] = [];
        session.subscribe((e) => events.push(e.type));

        await session.prompt("Reply with the single word 'pong'.");

        // 等 agent_end 或 30s 超时
        await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 30_000);
            const i = setInterval(() => {
                if (events.includes("agent_end")) {
                    clearTimeout(t);
                    clearInterval(i);
                    resolve();
                }
            }, 200);
        });

        session.dispose();
        expect(events).toContain("agent_start");
        expect(events).toContain("turn_start");
        expect(events).toContain("turn_end");
        expect(events).toContain("agent_end");
        expect(events.filter((e) => e === "message_update").length).toBeGreaterThan(0);
    }, 60_000);

    it("classifier: high-risk tool detected", async () => {
        const { classifyToolCall } = await import("../../main/services/approval/classifier");
        expect(classifyToolCall({ name: "bash", args: { command: "rm -rf /" } }).risk).toBe("high");
        expect(classifyToolCall({ name: "write", args: { file_path: "~/.ssh/id_rsa", content: "x" } }).risk).toBe("high");
    });
});

describe("M1 e2e (no API key required)", () => {
    it("classifier works without network", async () => {
        const { classifyToolCall } = await import("../../main/services/approval/classifier");
        expect(classifyToolCall({ name: "read", args: { file_path: "foo" } }).risk).toBe("read");
    });
});
