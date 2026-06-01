/**
 * Task 0 Spike: 验证 Pi AgentSession 可在 in-process 调用
 *
 * 跑法: cd apps/desktop && node scripts/spike-pi-inprocess.mjs
 * 需要: API key 在 env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY)
 */
import { createAgentSession, getAgentDir } from "@earendil-works/pi-coding-agent";

console.log("[spike] getAgentDir =", getAgentDir());

const cwd = process.cwd();
console.log("[spike] cwd =", cwd);

try {
    console.log("[spike] creating AgentSession...");
    const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({ cwd });

    if (modelFallbackMessage) {
        console.log("[spike] model fallback:", modelFallbackMessage);
    }

    console.log("[spike] extensions loaded:", extensionsResult?.extensions?.length ?? 0);

    const events = [];
    session.subscribe((event) => {
        events.push(event.type);
        if (event.type === "message_update" && event.subtype) {
            console.log("[event]", event.type, event.subtype, event.delta ? `delta=${JSON.stringify(event.delta).slice(0, 50)}` : "");
        } else if (event.type === "tool_execution_start") {
            console.log("[event]", event.type, event.toolName, JSON.stringify(event.args).slice(0, 100));
        } else if (event.type === "tool_execution_end") {
            console.log("[event]", event.type, event.toolName, "isError=", event.isError);
        } else {
            console.log("[event]", event.type);
        }
    });

    console.log("[spike] sending prompt...");
    await session.prompt("Reply with exactly the word 'pong' and nothing else.");

    // 等最多 30 秒, 看 turn_end
    await new Promise((resolve) => {
        const t = setTimeout(resolve, 30000);
        const check = setInterval(() => {
            if (events.includes("agent_end")) {
                clearTimeout(t);
                clearInterval(check);
                resolve();
            }
        }, 200);
    });

    console.log("[spike] events seen:", events.join(", "));

    session.dispose();
    console.log("[spike] SUCCESS");
} catch (err) {
    console.error("[spike] FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
}
