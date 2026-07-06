import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS, type LongHorizonSettings } from "@shared";
import { LongHorizonDatabase } from "../database";
import { GoalService, MAX_GOAL_REACT, buildSafeJudgeTranscript, type GoalVerdict } from "../goal-service";
import type { JudgeModelClient, ResolvedModel, ResolvedProvider } from "../judge-model-client";
import { TaskService } from "../task-service";

describe("GoalService", () => {
    describe("buildSafeJudgeTranscript", () => {
        it("keeps newest messages within message and char limits", () => {
            const transcript = Array.from({ length: 6 }, (_, index) => ({
                id: `m${index + 1}`,
                role: index % 2 === 0 ? "user" : "assistant",
                content: `message-${index + 1}`,
            }));

            const safe = buildSafeJudgeTranscript(transcript, { maxMessages: 3, maxChars: 18 });

            expect(safe).toHaveLength(2);
            expect(safe.map((message) => message.content).join("")).toHaveLength(18);
            expect(safe).toEqual([
                { id: "m5", role: "user", content: "message-5" },
                { id: "m6", role: "assistant", content: "message-6" },
            ]);
        });

        it("redacts common secrets before judge model calls", () => {
            const safe = buildSafeJudgeTranscript([
                { id: "u1", role: "user", content: "Bearer abc.def.ghi sk-abc123456789 OPENAI_API_KEY=real-secret password=hunter2 token: abc123" },
                { id: "a1", role: "assistant", content: "done" },
            ]);

            expect(safe[0]?.content).toContain("Bearer [REDACTED]");
            expect(safe[0]?.content).toContain("sk-[REDACTED]");
            expect(safe[0]?.content).toContain("OPENAI_API_KEY=[REDACTED]");
            expect(safe[0]?.content).toContain("password=[REDACTED]");
            expect(safe[0]?.content).toContain("token: [REDACTED]");
            expect(safe[0]?.content).not.toContain("real-secret");
            expect(safe[0]?.content).not.toContain("hunter2");
            expect(safe.at(-1)).toMatchObject({ id: "a1", role: "assistant" });
        });
    });

    const dirs: string[] = [];
    const services: GoalService[] = [];
    const databases: LongHorizonDatabase[] = [];

    afterEach(async () => {
        for (const service of services.splice(0)) {
            await service.close();
        }
        for (const database of databases.splice(0)) {
            await database.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService(
        taskServiceOverride?: Pick<TaskService, "createTask">,
        judgeOptions?: {
            judgeModelClient?: JudgeModelClient;
            resolveActiveModel?: (workspaceId: string) => Promise<{ provider: ResolvedProvider; model: ResolvedModel } | null>;
            agentSessionLookup?: (workspaceId: string) => { followUp: (message: string) => Promise<void> } | null;
            getLongHorizonSettings?: (workspaceId: string) => LongHorizonSettings | undefined;
            transcriptLookup?: (workspaceId: string, agentId?: string) => Promise<Array<{ role: string; content: string; id?: string }>>;
        },
    ) {
        const dir = mkdtempSync(join(tmpdir(), "pi-goal-"));
        dirs.push(dir);
        const send = vi.fn();
        const database = new LongHorizonDatabase(dir);
        databases.push(database);
        const taskService = taskServiceOverride ?? new TaskService(database);
        const service = new GoalService({
            database,
            rootDir: dir,
            legacyStateFile: join(dir, "goals.json"),
            send,
            taskService,
            ...judgeOptions,
        });
        services.push(service);
        return { dir, send, service, taskService };
    }

    it("persists a goal and emits a shared plan-progress task keyed by goal id", async () => {
        const { dir, send, service } = createService();

        const goal = await service.set({ workspaceId: "ws1", condition: "完成长程能力" });
        const reloadedDb = new LongHorizonDatabase(dir);
        databases.push(reloadedDb);
        const reloaded = new GoalService({
            database: reloadedDb,
            rootDir: dir,
            legacyStateFile: join(dir, "goals.json"),
            send: vi.fn(),
            taskService: new TaskService(reloadedDb),
        });
        services.push(reloaded);

        expect(goal.status).toBe("running");
        expect(await service.get("ws1")).toMatchObject({ condition: "完成长程能力" });
        expect(await reloaded.get("ws1")).toMatchObject({ condition: "完成长程能力" });
        expect(existsSync(join(dir, "long-horizon.db"))).toBe(true);
        expect(send).toHaveBeenCalledWith("goal:changed", "ws1", expect.objectContaining({ condition: "完成长程能力" }));
        expect(send).toHaveBeenCalledWith("plan:progress", "ws1", expect.objectContaining({
            items: [expect.objectContaining({ id: expect.stringMatching(/^T\d+$/), text: "完成长程能力", status: "running" })],
        }));
    });

    it("clears active display without deleting the historical store file", async () => {
        const { dir, send, service } = createService();
        await service.set({ workspaceId: "ws1", condition: "通过测试" });
        send.mockClear();

        const cleared = await service.clear("ws1");
        const reloaded = new GoalService(join(dir, "goals.json"), vi.fn());
        services.push(reloaded);

        expect(cleared.status).toBe("cleared");
        expect(await service.get("ws1")).toBeNull();
        expect(await reloaded.get("ws1")).toBeNull();
        expect(send).toHaveBeenCalledWith("goal:changed", "ws1", expect.objectContaining({ status: "cleared" }));
    });

    it("clears the workspace default goal when the clear request includes an agent id", async () => {
        const { service } = createService();
        await service.set({ workspaceId: "ws1", condition: "默认目标" });

        await service.clear("ws1", "agent-1");

        expect(await service.get("ws1")).toBeNull();
        expect(await service.get("ws1", "agent-1")).toBeNull();
    });

    it("preserves a workspace default goal when clearing an agent-specific goal", async () => {
        const { service } = createService();
        await service.set({ workspaceId: "ws1", condition: "默认目标" });
        await service.set({ workspaceId: "ws1", agentId: "agent-1", condition: "Agent 目标" });

        await service.clear("ws1", "agent-1");

        expect(await service.get("ws1")).toMatchObject({ condition: "默认目标" });
        expect(await service.get("ws1", "agent-1")).toMatchObject({ condition: "默认目标" });
    });

    it("maps judge results back to goal and task status", async () => {
        const { send, service } = createService();
        await service.set({ workspaceId: "ws1", condition: "发布完成" });
        send.mockClear();

        const checked = await service.markChecking("ws1", undefined, "需要再验证");
        const judged = await service.applyJudgeResult("ws1", { ok: false, impossible: true, reason: "缺少凭据" });

        expect(checked).toMatchObject({ status: "checking", reason: "需要再验证" });
        expect(judged).toMatchObject({ status: "impossible", reason: "缺少凭据" });
        expect(send).toHaveBeenCalledWith("plan:progress", "ws1", expect.objectContaining({
            items: [expect.objectContaining({ status: "blocked" })],
        }));
    });

    it("updates the workspace default goal when judge updates arrive with an agent id fallback", async () => {
        const { service } = createService();
        await service.set({ workspaceId: "ws1", condition: "默认目标" });

        await service.markChecking("ws1", "agent-1", "agent 检查");

        expect(await service.get("ws1")).toMatchObject({ status: "checking", reason: "agent 检查" });
        expect(await service.get("ws1", "agent-1")).toMatchObject({ status: "checking", reason: "agent 检查" });
    });

    it("allows agent-scoped and workspace-scoped goals to coexist without task id collisions", async () => {
        const { service } = createService();

        await service.set({ workspaceId: "ws1", agentId: "agent-1", condition: "agent 目标" });
        await service.set({ workspaceId: "ws1", condition: "workspace 目标" });

        expect(await service.get("ws1", "agent-1")).toMatchObject({ condition: "agent 目标" });
        expect(await service.get("ws1")).toMatchObject({ condition: "workspace 目标" });
    });

    it("migrates a legacy goals.json file into long-horizon.db on first load", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-goal-"));
        dirs.push(dir);
        writeFileSync(join(dir, "goals.json"), JSON.stringify({
            goals: [
                {
                    id: "legacy-goal",
                    workspaceId: "ws1",
                    condition: "legacy 目标",
                    status: "running",
                    createdAt: 1,
                    updatedAt: 2,
                },
            ],
        }), "utf8");

        const service = new GoalService(join(dir, "goals.json"), vi.fn());
        services.push(service);
        await service.ready();

        expect(await service.get("ws1")).toMatchObject({ id: "legacy-goal", condition: "legacy 目标" });
        expect(existsSync(join(dir, "goals.json.migrated"))).toBe(true);
        expect(existsSync(join(dir, "long-horizon.db"))).toBe(true);
    });

    it("creates a registry task via createTask when a goal is set", async () => {
        const createTask = vi.fn().mockResolvedValue({
            id: "T1",
            sessionId: "ws1",
            status: "open" as const,
            summary: "完成长程能力",
            createdAt: 0,
            lastEventAt: 0,
        });
        const { service, send } = createService({ createTask });

        await service.set({ workspaceId: "ws1", condition: "完成长程能力", agentId: "agent-1" });

        expect(createTask).toHaveBeenCalledWith({
            sessionId: "ws1",
            summary: "完成长程能力",
            owner: "agent-1",
        });
        expect(send).toHaveBeenCalledWith("plan:progress", "ws1", expect.objectContaining({
            items: [expect.objectContaining({ id: "T1", text: "完成长程能力", status: "running" })],
        }));
    });

    it("reuses the existing task id on subsequent goal updates without creating duplicates", async () => {
        const createTask = vi.fn().mockResolvedValue({
            id: "T1",
            sessionId: "ws1",
            status: "open" as const,
            summary: "目标",
            createdAt: 0,
            lastEventAt: 0,
        });
        const { service } = createService({ createTask });

        await service.set({ workspaceId: "ws1", condition: "目标" });
        await service.markChecking("ws1", undefined, "检查中");
        await service.applyJudgeResult("ws1", { ok: true, reason: "完成" });

        expect(createTask).toHaveBeenCalledTimes(1);
    });

    // ---- Task 2: react counter ---------------------------------------------

    describe("react counter", () => {
        it("bumpReact returns 1 on first call and 2 on second", () => {
            const { service } = createService();
            expect(service.bumpReact("ws1")).toBe(1);
            expect(service.bumpReact("ws1")).toBe(2);
        });

        it("getReact returns 0 when the workspace has no counter", () => {
            const { service } = createService();
            expect(service.getReact("ws1")).toBe(0);
        });

        it("resetReact clears the counter so the next bumpReact restarts at 1", () => {
            const { service } = createService();
            service.bumpReact("ws1");
            service.bumpReact("ws1");

            service.resetReact("ws1");

            expect(service.getReact("ws1")).toBe(0);
            expect(service.bumpReact("ws1")).toBe(1);
        });

        it("resetReact is a no-op when the workspace has no counter", () => {
            const { service } = createService();
            expect(() => service.resetReact("ws1")).not.toThrow();
            expect(service.getReact("ws1")).toBe(0);
        });

        it("set() resets the react counter when a new goal is set", async () => {
            const { service } = createService();
            service.bumpReact("ws1");
            service.bumpReact("ws1");
            expect(service.getReact("ws1")).toBe(2);

            await service.set({ workspaceId: "ws1", condition: "新目标" });

            expect(service.getReact("ws1")).toBe(0);
        });

        it("clear() removes the react counter", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "目标" });
            service.bumpReact("ws1");
            expect(service.getReact("ws1")).toBe(1);

            await service.clear("ws1");

            expect(service.getReact("ws1")).toBe(0);
        });

        it("counters are isolated per workspace", () => {
            const { service } = createService();
            service.bumpReact("ws1");
            service.bumpReact("ws2");
            service.bumpReact("ws2");

            expect(service.getReact("ws1")).toBe(1);
            expect(service.getReact("ws2")).toBe(2);
        });
    });

    // ---- Task 2: evaluate --------------------------------------------------

    describe("evaluate", () => {
        function mockJudgeClient(completeImpl: ReturnType<typeof vi.fn>): JudgeModelClient {
            return { complete: completeImpl } as unknown as JudgeModelClient;
        }

        const fakeProvider: ResolvedProvider = { id: "p", baseUrl: "https://example.test", api: "anthropic-messages" };
        const fakeModel: ResolvedModel = { id: "m" };

        it("returns a satisfied verdict when the judge model reports ok=true", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "transcript shows the work is done" });
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成长程能力",
                transcript: [
                    { role: "user", content: "请帮我实现" },
                    { role: "assistant", content: "已完成" },
                ],
            });

            expect(verdict).toEqual({ verdict: "satisfied", reason: "transcript shows the work is done" });
            expect(resolveActiveModel).toHaveBeenCalledWith("ws1");
            expect(complete).toHaveBeenCalledTimes(1);
            const params = complete.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; temperature: number };
            expect(params.temperature).toBe(0);
            // System prompt prepended, transcript preserved, judge user prompt appended.
            expect(params.messages[0]).toMatchObject({ role: "system" });
            expect(params.messages[1]).toMatchObject({ role: "user", content: "请帮我实现" });
            expect(params.messages[2]).toMatchObject({ role: "assistant", content: "已完成" });
            expect(params.messages[3]).toMatchObject({ role: "user" });
            expect(params.messages[3].content).toContain("完成长程能力");
        });

        it("maps ok=false && impossible=true to a failed verdict", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, impossible: true, reason: "self-contradictory" });
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "failed", reason: "self-contradictory" });
        });

        it("maps ok=false && impossible unset to an inconclusive verdict", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "insufficient evidence" });
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "inconclusive", reason: "insufficient evidence" });
        });

        it("fail-opens to inconclusive when JudgeModelClient.complete throws", async () => {
            const complete = vi.fn().mockRejectedValue(new Error("network"));
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "inconclusive", reason: "judge error: network", confidence: 0 });
        });

        it("fail-opens to inconclusive when no judgeModelClient is configured", async () => {
            const { service } = createService();

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "inconclusive", reason: "judge client not configured", confidence: 0 });
        });

        it("returns inconclusive when resolveActiveModel yields no model", async () => {
            const complete = vi.fn();
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue(null);
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "inconclusive", reason: "no judge model available", confidence: 0 });
            expect(complete).not.toHaveBeenCalled();
        });

        it("returns inconclusive when resolveActiveModel is not configured", async () => {
            const complete = vi.fn();
            const judgeModelClient = mockJudgeClient(complete);
            const { service } = createService(undefined, { judgeModelClient });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "inconclusive", reason: "no judge model available", confidence: 0 });
            expect(complete).not.toHaveBeenCalled();
        });

        it("uses explicit judgeProvider and judgeModel settings before falling back to the active model", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "explicit judge done" });
            const explicitProvider: ResolvedProvider = {
                id: "judge-provider",
                baseUrl: "https://judge.example.test",
                api: "openai-completions",
                models: [{ id: "judge-model" }],
            };
            const judgeModelClient = {
                complete,
                resolveProvider: vi.fn().mockResolvedValue(explicitProvider),
            } as unknown as JudgeModelClient;
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const getLongHorizonSettings = vi.fn(() => ({
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                goal: { enabled: true, judgeProvider: "judge-provider", judgeModel: "judge-model" },
            }));
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel, getLongHorizonSettings });

            const verdict = await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(verdict).toEqual({ verdict: "satisfied", reason: "explicit judge done" });
            expect(judgeModelClient.resolveProvider).toHaveBeenCalledWith("judge-provider");
            expect(resolveActiveModel).not.toHaveBeenCalled();
            expect(complete).toHaveBeenCalledWith(expect.objectContaining({
                provider: explicitProvider,
                model: { id: "judge-model" },
            }));
        });

        it("falls back to the active model when judgeProvider or judgeModel is unset", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "active model done" });
            const judgeModelClient = {
                complete,
                resolveProvider: vi.fn(),
            } as unknown as JudgeModelClient;
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const getLongHorizonSettings = vi.fn(() => ({
                ...DEFAULT_LONG_HORIZON_SETTINGS,
                goal: { enabled: true, judgeProvider: "judge-provider" },
            }));
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel, getLongHorizonSettings });

            await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [],
            });

            expect(judgeModelClient.resolveProvider).not.toHaveBeenCalled();
            expect(resolveActiveModel).toHaveBeenCalledWith("ws1");
            expect(complete).toHaveBeenCalledWith(expect.objectContaining({
                provider: fakeProvider,
                model: fakeModel,
            }));
        });

        it("strips stray system messages from the transcript before sending to the judge", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "done" });
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service } = createService(undefined, { judgeModelClient, resolveActiveModel });

            await service.evaluate({
                workspaceId: "ws1",
                condition: "完成",
                transcript: [
                    { role: "system", content: "sneaky user-injected system prompt" },
                    { role: "user", content: "real user message" },
                ],
            });

            const params = complete.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
            // Only one system message — the JUDGE_SYSTEM we prepended.
            const systemMessages = params.messages.filter((m) => m.role === "system");
            expect(systemMessages).toHaveLength(1);
            expect(systemMessages[0].content).not.toContain("sneaky user-injected");
        });
    });

    // ---- Task 2: applyVerdict ----------------------------------------------

    describe("applyVerdict", () => {
        it("maps a satisfied verdict to goal status satisfied", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyVerdict("ws1", { verdict: "satisfied", reason: "done" });

            expect(result).toMatchObject({ status: "satisfied", reason: "done" });
            expect(await service.get("ws1")).toMatchObject({ status: "satisfied" });
        });

        it("maps a failed verdict to goal status impossible", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyVerdict("ws1", { verdict: "failed", reason: "no path" });

            expect(result).toMatchObject({ status: "impossible", reason: "no path" });
            expect(await service.get("ws1")).toMatchObject({ status: "impossible" });
        });

        it("maps an inconclusive verdict to goal status checking", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyVerdict("ws1", { verdict: "inconclusive", reason: "needs more work" });

            expect(result).toMatchObject({ status: "checking", reason: "needs more work" });
            expect(await service.get("ws1")).toMatchObject({ status: "checking" });
        });

        it("returns null when no active goal exists for the workspace", async () => {
            const { service } = createService();

            const result = await service.applyVerdict("ws1", { verdict: "satisfied", reason: "done" });

            expect(result).toBeNull();
        });

        it("sends a goal:evaluation event with the verdict payload", async () => {
            const { send, service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();

            await service.applyVerdict(
                "ws1",
                { verdict: "satisfied", reason: "done" },
                "agent-1",
                "msg-42",
            );

            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                workspaceId: "ws1",
                agentId: "agent-1",
                verdict: "satisfied",
                reason: "done",
                attempt: 0,
                judgedMessageId: "msg-42",
                error: false,
            }));
        });

        it("reports the current react counter as attempt in the event payload", async () => {
            const { send, service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });
            service.bumpReact("ws1");
            service.bumpReact("ws1");
            send.mockClear();

            await service.applyVerdict("ws1", { verdict: "inconclusive", reason: "needs more" });

            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                attempt: 2,
            }));
        });

        it("flags the event payload as an error for inconclusive judge-error verdicts", async () => {
            const { send, service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();

            await service.applyVerdict("ws1", { verdict: "inconclusive", reason: "judge error: network", confidence: 0 });

            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                error: true,
            }));
        });

        it("does not flag the event payload as an error for non-judge-error inconclusive verdicts", async () => {
            const { send, service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();

            await service.applyVerdict("ws1", { verdict: "inconclusive", reason: "insufficient evidence" });

            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                error: false,
            }));
        });
    });

    // ---- Task 2: applyJudgeResult backwards-compat -------------------------

    describe("applyJudgeResult", () => {
        it("remains backwards-compatible with the legacy GoalJudgeResult shape (satisfied)", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyJudgeResult("ws1", { ok: true, reason: "完成" });

            expect(result).toMatchObject({ status: "satisfied", reason: "完成" });
        });

        it("remains backwards-compatible with the legacy GoalJudgeResult shape (impossible)", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyJudgeResult("ws1", { ok: false, impossible: true, reason: "缺少凭据" });

            expect(result).toMatchObject({ status: "impossible", reason: "缺少凭据" });
        });

        it("remains backwards-compatible with the legacy GoalJudgeResult shape (inconclusive)", async () => {
            const { service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });

            const result = await service.applyJudgeResult("ws1", { ok: false, reason: "再试试" });

            // Previously mapped to "running"; now delegates to applyVerdict
            // which maps inconclusive → "checking" (preserves running semantics).
            expect(result).toMatchObject({ status: "checking", reason: "再试试" });
        });

        it("accepts the new judgedMessageId param and propagates it to the goal:evaluation event", async () => {
            const { send, service } = createService();
            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();

            await service.applyJudgeResult(
                "ws1",
                { ok: true, reason: "done" },
                undefined,
                undefined,
                "msg-99",
            );

            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                verdict: "satisfied",
                judgedMessageId: "msg-99",
            }));
        });
    });

    // ---- Task 3: onTurnEnd stop-gate trigger --------------------------------

    describe("onTurnEnd", () => {
        function mockJudgeClient(completeImpl: ReturnType<typeof vi.fn>): JudgeModelClient {
            return { complete: completeImpl } as unknown as JudgeModelClient;
        }

        const fakeProvider: ResolvedProvider = { id: "p", baseUrl: "https://example.test", api: "anthropic-messages" };
        const fakeModel: ResolvedModel = { id: "m" };

        function createJudgeService(opts: {
            complete: ReturnType<typeof vi.fn>;
            followUp?: ReturnType<typeof vi.fn>;
            getLongHorizonSettings?: (workspaceId: string) => LongHorizonSettings | undefined;
            transcriptLookup?: (workspaceId: string, agentId?: string) => Promise<Array<{ role: string; content: string; id?: string }>>;
        }) {
            const judgeModelClient = mockJudgeClient(opts.complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const followUp = opts.followUp ?? vi.fn().mockResolvedValue(undefined);
            const agentSessionLookup = vi.fn().mockReturnValue({ followUp });
            const { service, send } = createService(undefined, {
                judgeModelClient,
                resolveActiveModel,
                agentSessionLookup,
                getLongHorizonSettings: opts.getLongHorizonSettings,
                transcriptLookup: opts.transcriptLookup,
            });
            return { service, send, complete: opts.complete, followUp, agentSessionLookup };
        }

        // LongHorizonSettings mock fixtures — derived from the shared default
        // so tests don't drift when new fields are added in Task 4.
        const disabledSettings: LongHorizonSettings = {
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: false,
        };

        const goalDisabledSettings: LongHorizonSettings = {
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: true,
            goal: { enabled: false },
        };

        const enabledSettings: LongHorizonSettings = {
            ...DEFAULT_LONG_HORIZON_SETTINGS,
            enabled: true,
            goal: { enabled: true },
        };

        it("skips evaluation when longHorizon is disabled", async () => {
            const complete = vi.fn();
            const { service, followUp } = createJudgeService({
                complete,
                getLongHorizonSettings: () => disabledSettings,
            });
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1");

            expect(complete).not.toHaveBeenCalled();
            expect(followUp).not.toHaveBeenCalled();
            expect(service.getTurnCount("ws1")).toBe(0);
        });

        it("skips evaluation when goal evaluation is disabled", async () => {
            const complete = vi.fn();
            const { service, followUp } = createJudgeService({
                complete,
                getLongHorizonSettings: () => goalDisabledSettings,
            });
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1");

            expect(complete).not.toHaveBeenCalled();
            expect(followUp).not.toHaveBeenCalled();
        });

        it("skips evaluation when no active goal exists", async () => {
            const complete = vi.fn();
            const { service, followUp } = createJudgeService({ complete });

            await service.onTurnEnd("ws1");

            expect(complete).not.toHaveBeenCalled();
            expect(followUp).not.toHaveBeenCalled();
            expect(service.getTurnCount("ws1")).toBe(0);
        });

        it("skips evaluation when the goal status is not running", async () => {
            const complete = vi.fn();
            const { service, followUp } = createJudgeService({ complete });
            await service.set({ workspaceId: "ws1", condition: "完成" });
            // Move the goal to a terminal state — onTurnEnd should no-op.
            await service.applyVerdict("ws1", { verdict: "satisfied", reason: "done" });
            expect((await service.get("ws1"))?.status).toBe("satisfied");
            complete.mockClear();

            await service.onTurnEnd("ws1");

            expect(complete).not.toHaveBeenCalled();
            expect(followUp).not.toHaveBeenCalled();
        });

        it("runs the judge and applies a satisfied verdict (agent stops)", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "transcript shows completion" });
            const { service, followUp } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            await service.onTurnEnd("ws1", "agent-1", "msg-7");

            expect(complete).toHaveBeenCalledTimes(1);
            expect(await service.get("ws1")).toMatchObject({
                status: "satisfied",
                reason: "transcript shows completion",
            });
            // Satisfied → no followUp injection (agent stops naturally).
            expect(followUp).not.toHaveBeenCalled();
        });

        it("runs the judge and applies a failed verdict (agent stops)", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, impossible: true, reason: "self-contradictory" });
            const { service, followUp } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            await service.onTurnEnd("ws1");

            expect(await service.get("ws1")).toMatchObject({
                status: "impossible",
                reason: "self-contradictory",
            });
            expect(followUp).not.toHaveBeenCalled();
        });

        it("bumps react and injects followUp on inconclusive (within cap)", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "needs more work" });
            const { service, send, followUp } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();
            await service.onTurnEnd("ws1", "agent-1", "msg-1");

            // React counter bumped to 1 (within MAX_GOAL_REACT).
            expect(service.getReact("ws1")).toBe(1);
            // followUp injected with the judge's reasoning.
            expect(followUp).toHaveBeenCalledTimes(1);
            expect(followUp).toHaveBeenCalledWith("needs more work");
            // goal:evaluation event broadcast with the verdict.
            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                verdict: "inconclusive",
                reason: "needs more work",
                attempt: 1,
                judgedMessageId: "msg-1",
            }));
        });

        it("does NOT change goal status on inconclusive (preserves running)", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "needs more work" });
            const { service } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            await service.onTurnEnd("ws1");

            // Status stays "running" — applyVerdict is NOT called for
            // inconclusive-within-cap (avoids flipping to "checking").
            expect(await service.get("ws1")).toMatchObject({ status: "running" });
        });

        it("fails open when react exceeds MAX_GOAL_REACT", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "still inconclusive" });
            const { service, send, followUp } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            // Pre-bump react to the cap so the next bump exceeds it.
            for (let i = 0; i < MAX_GOAL_REACT; i++) {
                service.bumpReact("ws1");
            }
            expect(service.getReact("ws1")).toBe(MAX_GOAL_REACT);
            send.mockClear();

            await service.onTurnEnd("ws1");

            // bumpReact fires once more inside onTurnEnd → react = 13 > 12.
            expect(service.getReact("ws1")).toBe(MAX_GOAL_REACT + 1);
            // Goal fails open with a clear reason.
            expect(await service.get("ws1")).toMatchObject({
                status: "impossible",
                reason: expect.stringContaining("exceeded MAX_GOAL_REACT"),
            });
            // No followUp injected — agent stops.
            expect(followUp).not.toHaveBeenCalled();
            // Evaluation event reports a failed verdict.
            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                verdict: "failed",
                attempt: MAX_GOAL_REACT + 1,
            }));
        });

        it("increments turnCount per onTurnEnd call", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "more" });
            const { service } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            expect(service.getTurnCount("ws1")).toBe(0);

            await service.onTurnEnd("ws1");
            expect(service.getTurnCount("ws1")).toBe(1);

            await service.onTurnEnd("ws1");
            expect(service.getTurnCount("ws1")).toBe(2);
        });

        it("resets turnCount when a new goal is set", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "more" });
            const { service } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "目标 A" });
            await service.onTurnEnd("ws1");
            await service.onTurnEnd("ws1");
            expect(service.getTurnCount("ws1")).toBe(2);

            await service.set({ workspaceId: "ws1", condition: "目标 B" });
            expect(service.getTurnCount("ws1")).toBe(0);
            expect(service.getReact("ws1")).toBe(0);
        });

        it("resets turnCount when the goal is cleared", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "more" });
            const { service } = createJudgeService({ complete });

            await service.set({ workspaceId: "ws1", condition: "目标" });
            await service.onTurnEnd("ws1");
            expect(service.getTurnCount("ws1")).toBe(1);

            await service.clear("ws1");
            expect(service.getTurnCount("ws1")).toBe(0);
            expect(service.getReact("ws1")).toBe(0);
        });

        it("still emits the evaluation event when no agentSessionLookup is wired", async () => {
            // No followUp delivery path, but the judge + react + event still fire.
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "no delivery" });
            const judgeModelClient = mockJudgeClient(complete);
            const resolveActiveModel = vi.fn().mockResolvedValue({ provider: fakeProvider, model: fakeModel });
            const { service, send } = createService(undefined, {
                judgeModelClient,
                resolveActiveModel,
                // agentSessionLookup intentionally omitted.
            });

            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();
            await service.onTurnEnd("ws1");

            expect(service.getReact("ws1")).toBe(1);
            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                verdict: "inconclusive",
                reason: "no delivery",
                attempt: 1,
            }));
            // Goal stays running (no applyVerdict on inconclusive-within-cap).
            expect(await service.get("ws1")).toMatchObject({ status: "running" });
        });

        it("uses evaluateInterval from settings instead of monkey-patched private state", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "not yet" });
            const { service, followUp } = createJudgeService({
                complete,
                getLongHorizonSettings: () => ({
                    ...DEFAULT_LONG_HORIZON_SETTINGS,
                    enabled: true,
                    goal: { enabled: true, evaluateInterval: 3 },
                }),
            });
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1", "agent-1");
            await service.onTurnEnd("ws1", "agent-1");
            expect(complete).not.toHaveBeenCalled();

            await service.onTurnEnd("ws1", "agent-1");
            expect(complete).toHaveBeenCalledTimes(1);
            expect(followUp).not.toHaveBeenCalled();
        });

        it("uses maxReact from settings when bounding judge re-entry", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: false, reason: "still inconclusive" });
            const { service, followUp } = createJudgeService({
                complete,
                getLongHorizonSettings: () => ({
                    ...DEFAULT_LONG_HORIZON_SETTINGS,
                    enabled: true,
                    goal: { enabled: true, maxReact: 1 },
                }),
            });
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1", "agent-1");
            await service.onTurnEnd("ws1", "agent-1");

            expect(followUp).toHaveBeenCalledTimes(1);
            expect(await service.get("ws1")).toMatchObject({
                status: "impossible",
                reason: "exceeded MAX_GOAL_REACT (1)",
            });
        });

        it("uses transcriptLookup for onTurnEnd evaluation and anchors the last assistant message", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "done" });
            const transcriptLookup = vi.fn().mockResolvedValue([
                { id: "u1", role: "user", content: "请完成" },
                { id: "a1", role: "assistant", content: "处理中" },
                { id: "a2", role: "assistant", content: "已完成" },
            ]);
            const { service, send } = createJudgeService({ complete, transcriptLookup });
            await service.set({ workspaceId: "ws1", condition: "完成" });
            send.mockClear();

            await service.onTurnEnd("ws1", "agent-1");

            expect(transcriptLookup).toHaveBeenCalledWith("ws1", "agent-1");
            expect(complete).toHaveBeenCalledWith(expect.objectContaining({
                messages: expect.arrayContaining([
                    expect.objectContaining({ role: "assistant", content: "已完成" }),
                ]),
            }));
            expect(send).toHaveBeenCalledWith("goal:evaluation", "ws1", expect.objectContaining({
                judgedMessageId: "a2",
            }));
        });

        it("evaluates when getLongHorizonSettings is not configured (default enabled)", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "done" });
            const { service } = createJudgeService({ complete });
            // No getLongHorizonSettings — onTurnEnd should assume enabled.
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1");

            expect(complete).toHaveBeenCalledTimes(1);
        });

        it("evaluates when getLongHorizonSettings returns enabled settings", async () => {
            const complete = vi.fn().mockResolvedValue({ ok: true, reason: "done" });
            const { service } = createJudgeService({
                complete,
                getLongHorizonSettings: () => enabledSettings,
            });
            await service.set({ workspaceId: "ws1", condition: "完成" });

            await service.onTurnEnd("ws1");

            expect(complete).toHaveBeenCalledTimes(1);
        });
    });
});

// Compile-time guard: ensure GoalVerdict is exported for the renderer / future
// shared-types migration in Task 4.
const _typeCheck: GoalVerdict = { verdict: "inconclusive", reason: "guard" };
void _typeCheck;
