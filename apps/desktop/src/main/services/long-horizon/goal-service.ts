import { dirname } from "path";
import { randomUUID } from "crypto";
import type { GoalJudgeResult, GoalSetInput, GoalState, GoalStatus, GoalVerdict, LongHorizonSettings, PlanProgressUpdate } from "@shared";
import log from "electron-log/main";
import { LongHorizonDatabase } from "./database";
import type { TaskService } from "./task-service";
import { JudgeModelClient, type ModelMessage, type ResolvedModel, type ResolvedProvider } from "./judge-model-client";
import { JUDGE_SYSTEM, judgeUser, VerdictSchema, type Verdict } from "./judge-prompt";

type Send = (channel: string, workspaceId: string, payload: unknown) => void;

/**
 * Maximum number of judge-driven re-entries per goal before fail-open.
 * Matches MiMo Code `prompt.ts:133` (`MAX_GOAL_REACT = 12`).
 * Task 4 will make this configurable via `LongHorizonSettings.goal.maxReact`.
 */
export const MAX_GOAL_REACT = 12;
export const MAX_JUDGE_TRANSCRIPT_MESSAGES = 24;
export const MAX_JUDGE_TRANSCRIPT_CHARS = 20_000;

export interface JudgeTranscriptMessage {
    role: "user" | "assistant";
    content: string;
    id?: string;
}

type SecretRedaction = [RegExp, string | ((match: string, ...args: string[]) => string)];

const SECRET_REDACTIONS: SecretRedaction[] = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
    [/sk-[A-Za-z0-9_-]{10,}/gi, "sk-[REDACTED]"],
    [/\b[A-Z0-9_]*API_KEY\s*=\s*[^\s'"]+/gi, (match) => `${match.split("=")[0]?.trim() ?? "API_KEY"}=[REDACTED]`],
    [/\b(password|token)\s*=\s*[^\s'"]+/gi, (_match, name: string) => `${name}=[REDACTED]`],
    [/\b(password|token)\s*:\s*[^\s,'"}]+/gi, (_match, name: string) => `${name}: [REDACTED]`],
];

export function redactJudgeTranscriptSecrets(content: string): string {
    let redacted = content;
    for (const [pattern, replacement] of SECRET_REDACTIONS) {
        redacted = typeof replacement === "string"
            ? redacted.replace(pattern, replacement)
            : redacted.replace(pattern, replacement);
    }
    return redacted;
}

export function buildSafeJudgeTranscript(
    transcript: Array<{ role: string; content: string; id?: string }>,
    limits: { maxMessages?: number; maxChars?: number } = {},
): JudgeTranscriptMessage[] {
    const maxMessages = limits.maxMessages ?? MAX_JUDGE_TRANSCRIPT_MESSAGES;
    const maxChars = limits.maxChars ?? MAX_JUDGE_TRANSCRIPT_CHARS;
    if (maxMessages <= 0 || maxChars <= 0) return [];

    const selected: JudgeTranscriptMessage[] = [];
    let remainingChars = maxChars;
    for (let index = transcript.length - 1; index >= 0 && selected.length < maxMessages && remainingChars > 0; index -= 1) {
        const message = transcript[index];
        if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
        const redacted = redactJudgeTranscriptSecrets(message.content).trim();
        if (!redacted) continue;
        const content = redacted.length > remainingChars ? redacted.slice(redacted.length - remainingChars) : redacted;
        selected.push({
            id: message.id,
            role: message.role,
            content,
        });
        remainingChars -= content.length;
    }
    return selected.reverse();
}

// Re-export GoalVerdict from @shared so existing callers (tests, IPC handlers)
// can keep importing it from this module. Task 4 migrated the type definition
// to @shared as the authority source.
export type { GoalVerdict } from "@shared";

interface GoalServiceOptions {
    database?: LongHorizonDatabase;
    rootDir?: string;
    legacyStateFile?: string;
    send: Send;
    taskService?: Pick<TaskService, "createTask">;
    judgeModelClient?: JudgeModelClient;
    resolveActiveModel?: (workspaceId: string) => Promise<{ provider: ResolvedProvider; model: ResolvedModel } | null>;
    transcriptLookup?: (workspaceId: string, agentId?: string) => Promise<Array<{ role: string; content: string; id?: string }>>;
    agentSessionLookup?: (workspaceId: string) => { followUp: (message: string) => Promise<void> } | null;
    /**
     * Returns the per-workspace LongHorizonSettings so {@link onTurnEnd} can
     * short-circuit when long-horizon or goal evaluation is disabled, and so
     * Task 4 can read `goal.evaluateInterval` / `goal.maxReact` overrides.
     * When unset, {@link onTurnEnd} assumes evaluation is enabled and runs
     * in stop-gate mode (`evaluateInterval = 0`).
     */
    getLongHorizonSettings?: (workspaceId: string) => LongHorizonSettings | undefined;
}

function findLastAssistantMessageId(transcript: Array<{ role: string; id?: string }>): string | undefined {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        const message = transcript[index];
        if (message?.role === "assistant" && message.id) return message.id;
    }
    return undefined;
}

export class GoalService {
    private readonly database: LongHorizonDatabase;
    private readonly ownsDatabase: boolean;
    private readonly send: Send;
    private readonly taskService?: Pick<TaskService, "createTask">;
    private readonly migrationPromise: Promise<void>;
    /** Maps goal.id → registry task id (T<n>) so updates reuse the same task. */
    private readonly goalTaskIds = new Map<string, string>();
    private readonly reactCounts = new Map<string, number>();
    private readonly turnCounts = new Map<string, number>();
    private readonly judgeModelClient?: JudgeModelClient;
    private readonly resolveActiveModel?: (workspaceId: string) => Promise<{ provider: ResolvedProvider; model: ResolvedModel } | null>;
    private readonly transcriptLookup?: (workspaceId: string, agentId?: string) => Promise<Array<{ role: string; content: string; id?: string }>>;
    private readonly agentSessionLookup?: (workspaceId: string) => { followUp: (message: string) => Promise<void> } | null;
    private readonly getLongHorizonSettings?: (workspaceId: string) => LongHorizonSettings | undefined;

    constructor(stateFile: string, send: Send);
    constructor(options: GoalServiceOptions);
    constructor(stateFileOrOptions: string | GoalServiceOptions, maybeSend?: Send) {
        if (typeof stateFileOrOptions === "string") {
            if (!maybeSend) throw new Error("GoalService requires a send callback");
            this.database = new LongHorizonDatabase(dirname(stateFileOrOptions));
            this.ownsDatabase = true;
            this.migrationPromise = this.database.migrateLegacyGoalsFile(stateFileOrOptions);
            this.send = maybeSend;
            return;
        }

        const rootDir = stateFileOrOptions.rootDir
            ?? (stateFileOrOptions.legacyStateFile ? dirname(stateFileOrOptions.legacyStateFile) : undefined);
        this.database = stateFileOrOptions.database ?? new LongHorizonDatabase(rootDir ?? ".");
        this.ownsDatabase = !stateFileOrOptions.database;
        this.migrationPromise = stateFileOrOptions.legacyStateFile
            ? this.database.migrateLegacyGoalsFile(stateFileOrOptions.legacyStateFile)
            : Promise.resolve();
        this.send = stateFileOrOptions.send;
        this.taskService = stateFileOrOptions.taskService;
        this.judgeModelClient = stateFileOrOptions.judgeModelClient;
        this.resolveActiveModel = stateFileOrOptions.resolveActiveModel;
        this.transcriptLookup = stateFileOrOptions.transcriptLookup;
        this.agentSessionLookup = stateFileOrOptions.agentSessionLookup;
        this.getLongHorizonSettings = stateFileOrOptions.getLongHorizonSettings;
    }

    async ready(): Promise<void> {
        await this.migrationPromise;
    }

    async get(workspaceId: string, agentId?: string): Promise<GoalState | null> {
        return this.database.getGoal(workspaceId, agentId);
    }

    async set(input: GoalSetInput): Promise<GoalState> {
        const now = Date.now();
        const goal = await this.database.upsertGoal({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            condition: input.condition.trim(),
            status: "running",
            createdAt: now,
            updatedAt: now,
        });
        // Reset react/turn counters whenever a new goal is set so prior
        // judge-driven re-entries don't bleed into the new goal.
        this.resetReact(input.workspaceId);
        this.emit(goal);
        await this.emitTopLevelTask(goal);
        return goal;
    }

    async clear(workspaceId: string, agentId?: string): Promise<GoalState> {
        const previous = await this.database.clearGoal(workspaceId, agentId);
        const now = Date.now();
        const cleared: GoalState = {
            id: previous?.id ?? randomUUID(),
            workspaceId,
            agentId: previous?.agentId ?? agentId,
            condition: previous?.condition ?? "",
            status: "cleared",
            reason: "已清除",
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
        };
        // Drop the in-memory goal→task mapping; the registry task row persists
        // in `task`/`task_event` for history (no setSourceTasks clear needed).
        if (previous) {
            this.goalTaskIds.delete(previous.id);
        }
        this.resetReact(workspaceId);
        this.emit(cleared);
        return cleared;
    }

    async markChecking(workspaceId: string, agentId?: string, reason = "judge 检查中"): Promise<GoalState | null> {
        return this.update(workspaceId, agentId, { status: "checking", reason });
    }

    /**
     * Backwards-compatible adapter: accepts the legacy {@link GoalJudgeResult}
     * shape and delegates to {@link applyVerdict} after mapping to a
     * {@link GoalVerdict}. The optional `attempt` and `judgedMessageId` fields
     * are accepted for forward-compat with Task 3 (MAX_GOAL_REACT) and the
     * `goal:evaluation` event payload respectively.
     */
    async applyJudgeResult(
        workspaceId: string,
        result: GoalJudgeResult,
        agentId?: string,
        _attempt?: number,
        judgedMessageId?: string,
    ): Promise<GoalState | null> {
        const verdict: GoalVerdict = result.ok
            ? { verdict: "satisfied", reason: result.reason ?? "" }
            : result.impossible
                ? { verdict: "failed", reason: result.reason ?? "" }
                : { verdict: "inconclusive", reason: result.reason ?? "" };
        return this.applyVerdict(workspaceId, verdict, agentId, judgedMessageId);
    }

    /**
     * Apply a {@link GoalVerdict} to the active goal: persist the mapped status
     * to the DB and broadcast a `goal:evaluation` event. The react counter is
     * read via {@link getReact} so the event payload reports the current
     * attempt number without mutating it (bumping is the caller's job).
     */
    async applyVerdict(
        workspaceId: string,
        verdict: GoalVerdict,
        agentId?: string,
        judgedMessageId?: string,
    ): Promise<GoalState | null> {
        const status: GoalStatus =
            verdict.verdict === "satisfied" ? "satisfied"
                : verdict.verdict === "failed" ? "impossible"
                    : "checking";
        const updated = await this.update(workspaceId, agentId, { status, reason: verdict.reason });
        this.emitEvaluation(workspaceId, agentId, verdict, judgedMessageId);
        return updated;
    }

    /**
     * Inject a synthetic user turn into the workspace's active agent session.
     * Used by Task 3 stop-gate logic to feed the judge's verdict.reason back to
     * the agent when the goal isn't yet satisfied. Safe to call when no
     * `agentSessionLookup` is configured or no session exists — returns false
     * without throwing.
     *
     * @returns true when the followUp was delivered; false otherwise.
     */
    async injectFollowUp(workspaceId: string, message: string): Promise<boolean> {
        if (!this.agentSessionLookup) return false;
        const session = this.agentSessionLookup(workspaceId);
        if (!session) return false;
        await session.followUp(message);
        return true;
    }

    /**
     * Run the judge model against `transcript` to decide whether `condition`
     * is satisfied. Fail-opens to `inconclusive` on any error so a flaky
     * judge never blocks the agent from stopping.
     *
     * Task 2 resolves the judge model via `resolveActiveModel` only. Task 4
     * will additionally consult `LongHorizonSettings.goal.judgeProvider` /
     * `judgeModel` once that type is extended.
     */
    async evaluate(input: {
        workspaceId: string;
        agentId?: string;
        condition: string;
        transcript: Array<{ role: string; content: string }>;
    }): Promise<GoalVerdict> {
        if (!this.judgeModelClient) {
            return { verdict: "inconclusive", reason: "judge client not configured", confidence: 0 };
        }

        let provider: ResolvedProvider | null = null;
        let model: ResolvedModel | null = null;
        const settings = this.getLongHorizonSettings?.(input.workspaceId);
        const judgeProviderId = settings?.goal.judgeProvider?.trim();
        const judgeModelId = settings?.goal.judgeModel?.trim();

        if (judgeProviderId && judgeModelId) {
            try {
                const resolvedProvider = await this.judgeModelClient.resolveProvider(judgeProviderId);
                const resolvedModel = resolvedProvider.models?.find((candidate) => candidate.id === judgeModelId) ?? { id: judgeModelId };
                provider = resolvedProvider;
                model = resolvedModel;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { verdict: "inconclusive", reason: `judge error: ${msg}`, confidence: 0 };
            }
        } else if (this.resolveActiveModel) {
            const resolved = await this.resolveActiveModel(input.workspaceId);
            if (resolved) {
                provider = resolved.provider;
                model = resolved.model;
            }
        }
        if (!provider || !model) {
            return { verdict: "inconclusive", reason: "no judge model available", confidence: 0 };
        }

        const transcriptMessages: ModelMessage[] = buildSafeJudgeTranscript(input.transcript)
            .map((m) => ({
                role: m.role,
                content: m.content,
            }));
        const messages: ModelMessage[] = [
            { role: "system", content: JUDGE_SYSTEM },
            ...transcriptMessages,
            { role: "user", content: judgeUser(input.condition) },
        ];

        try {
            const verdict = await this.judgeModelClient.complete({
                provider,
                model,
                messages,
                schema: VerdictSchema,
                temperature: 0,
            });
            return this.mapVerdict(verdict);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { verdict: "inconclusive", reason: `judge error: ${msg}`, confidence: 0 };
        }
    }

    private mapVerdict(verdict: Verdict): GoalVerdict {
        if (verdict.ok) {
            return { verdict: "satisfied", reason: verdict.reason };
        }
        if (verdict.impossible) {
            return { verdict: "failed", reason: verdict.reason };
        }
        return { verdict: "inconclusive", reason: verdict.reason };
    }

    /**
     * Increment the per-workspace react counter (judge-driven re-entries) and
     * return the new value. Bounded by MAX_GOAL_REACT in Task 3.
     */
    bumpReact(workspaceId: string): number {
        const current = this.reactCounts.get(workspaceId) ?? 0;
        const next = current + 1;
        this.reactCounts.set(workspaceId, next);
        return next;
    }

    getReact(workspaceId: string): number {
        return this.reactCounts.get(workspaceId) ?? 0;
    }

    resetReact(workspaceId: string): void {
        this.reactCounts.delete(workspaceId);
        this.turnCounts.delete(workspaceId);
    }

    /**
     * Drop all in-memory state scoped to `workspaceId` so the goal service
     * doesn't leak react/turn counters or the goal→task id mapping when the
     * workspace session is torn down. The DB rows (goal/task records) are
     * left intact for history — only the caches are cleared.
     */
    disposeWorkspace(workspaceId: string): void {
        this.reactCounts.delete(workspaceId);
        this.turnCounts.delete(workspaceId);
        // Drop the goal→task id mapping for any goals owned by this workspace.
        // The map is keyed by goal.id (UUID), so we walk the goal table to
        // resolve which ids belong to this workspace. When no DB is wired
        // (string ctor path), the map is left untouched — entries there are
        // process-lifetime only.
        if (this.ownsDatabase) {
            void this.database.getGoal(workspaceId, undefined)
                .then((goal) => {
                    if (goal) this.goalTaskIds.delete(goal.id);
                })
                .catch((err) => {
                    log.warn("[GoalService] disposeWorkspace: failed to clear goalTaskIds", err);
                });
        }
    }

    /**
     * Increment the per-workspace turn counter (number of `turn_end` events
     * observed for the active goal) and return the new value. Reset by
     * {@link resetReact} on `goal:set` / `goal:clear`.
     */
    bumpTurn(workspaceId: string): number {
        const current = this.turnCounts.get(workspaceId) ?? 0;
        const next = current + 1;
        this.turnCounts.set(workspaceId, next);
        return next;
    }

    getTurnCount(workspaceId: string): number {
        return this.turnCounts.get(workspaceId) ?? 0;
    }

    /**
     * Bound on the number of judge-driven re-entries per goal. Task 3 returns
     * the {@link MAX_GOAL_REACT} default; Task 4 will read
     * `LongHorizonSettings.goal.maxReact` (falling back to the default).
     */
    private getMaxReact(workspaceId: string): number {
        const maxReact = this.getLongHorizonSettings?.(workspaceId)?.goal.maxReact;
        return typeof maxReact === "number" && Number.isInteger(maxReact) && maxReact > 0 ? maxReact : MAX_GOAL_REACT;
    }

    /**
     * Periodic evaluation interval in turns. `0` (default) means stop-gate
     * mode: evaluate on every `turn_end`. `N > 0` means evaluate every Nth
     * turn_end and skip the followUp injection (informational only). Task 4
     * will read `LongHorizonSettings.goal.evaluateInterval`; Task 3 returns 0.
     */
    private getEvaluateInterval(workspaceId: string): number {
        const interval = this.getLongHorizonSettings?.(workspaceId)?.goal.evaluateInterval;
        return typeof interval === "number" && Number.isInteger(interval) && interval > 0 ? interval : 0;
    }

    /**
     * Stop-gate trigger: invoked by `event-bridge.ts` on every `turn_end` of
     * the main agent. When a goal is active and long-horizon/goal evaluation
     * is enabled, runs the judge and reacts to the verdict per
     * {@link https://www.notion.so | the stop-gate spec}:
     *
     * - `satisfied` / `failed` → {@link applyVerdict} (agent stops naturally).
     * - `inconclusive` and `react <= MAX_GOAL_REACT` → in stop-gate mode,
     *   injects `verdict.reason` as a synthetic followUp turn so the agent
     *   keeps working; in periodic mode, only emits the evaluation event.
     *   Does NOT call {@link applyVerdict} so the goal status stays `running`
     *   rather than flipping to `checking`.
     * - `inconclusive` and `react > MAX_GOAL_REACT` → fails open with
     *   `verdict: "failed"` reason `"exceeded MAX_GOAL_REACT (N)"` and calls
     *   {@link applyVerdict} (agent stops).
     *
     * Returns early (no-op) when:
     *   - long-horizon or goal evaluation is disabled
     *   - no active goal exists or its status is not `"running"`
     *   - periodic mode and `turnCount % interval !== 0`
     *
     * Transcript is currently empty (Task 6 will wire the real transcript
     * extraction from the active {@link AgentSession}); an empty transcript
     * will make the judge return `inconclusive`, which is a safe fallback.
     */
    async onTurnEnd(
        workspaceId: string,
        agentId?: string,
        lastAssistantMessageId?: string,
    ): Promise<void> {
        // 1. Check enabled — when no settings provider is wired, treat as enabled.
        if (this.getLongHorizonSettings) {
            const settings = this.getLongHorizonSettings(workspaceId);
            if (settings) {
                if (!settings.enabled || !settings.goal.enabled) return;
            }
        }

        // 2. Check active goal — only `running` goals are eligible for
        //    evaluation; `checking` / `satisfied` / `impossible` / `cleared`
        //    short-circuit so we don't re-judge a goal that's already
        //    terminal or mid-evaluation.
        const goal = await this.get(workspaceId, agentId);
        if (!goal || goal.status !== "running") return;

        // Guard: skip evaluation entirely when the judge is not configured.
        // This prevents injecting "judge client not configured" as a synthetic
        // followUp message into the live agent conversation.
        if (!this.judgeModelClient) {
            log.debug("[GoalService] onTurnEnd: judge client not configured, skipping");
            return;
        }

        // 3. Increment the per-workspace turn counter (reset on goal:set/clear
        //    via resetReact). turnCount >= 1 here means at least one turn_end
        //    has fired since the goal was set, which matches the spec's "no
        //    evaluation on first turn" guard (zero turn_end events = skip).
        const turnCount = this.bumpTurn(workspaceId);

        // 4. Periodic mode: skip when not on the interval. Stop-gate mode
        //    (interval === 0) evaluates on every turn_end.
        const interval = this.getEvaluateInterval(workspaceId);
        if (interval > 0 && turnCount % interval !== 0) return;

        // 5. Run the judge. Transcript is empty for now (Task 6 will wire the
        //    real transcript extraction from the active AgentSession).
        const transcript = this.transcriptLookup ? await this.transcriptLookup(workspaceId, agentId) : [];
        const judgedMessageId = lastAssistantMessageId ?? findLastAssistantMessageId(transcript);
        const verdict = await this.evaluate({
            workspaceId,
            agentId,
            condition: goal.condition,
            transcript,
        });

        // 6. Apply verdict.
        if (verdict.verdict === "satisfied" || verdict.verdict === "failed") {
            await this.applyVerdict(workspaceId, verdict, agentId, judgedMessageId);
            return;
        }

        // Inconclusive: bump react counter, then check the cap.
        const react = this.bumpReact(workspaceId);
        const maxReact = this.getMaxReact(workspaceId);
        if (react > maxReact) {
            // Exceeded the cap — fail-open so the agent stops instead of
            // looping forever on a flaky / indecisive judge.
            const failedVerdict: GoalVerdict = {
                verdict: "failed",
                reason: `exceeded MAX_GOAL_REACT (${maxReact})`,
            };
            await this.applyVerdict(workspaceId, failedVerdict, agentId, judgedMessageId);
            return;
        }

        // Within the cap. Emit the evaluation event manually (do NOT call
        // applyVerdict — that would flip status to `checking` and lose the
        // `running` semantics the agent relies on to keep working).
        this.emitEvaluation(workspaceId, agentId, verdict, judgedMessageId);

        // Stop-gate mode: inject the verdict.reason as a synthetic followUp
        // turn so the agent continues with the judge's guidance. Periodic
        // mode is informational only — no followUp injection. Skip injection
        // when the reason indicates the judge itself is unavailable — that
        // string is not actionable guidance for the agent.
        if (interval === 0 && verdict.reason !== "no judge model available") {
            const delivered = await this.injectFollowUp(workspaceId, verdict.reason);
            if (!delivered) {
                log.warn(
                    `[GoalService] onTurnEnd: verdict inconclusive but no agent session to deliver followUp`,
                    { workspaceId, agentId, react, maxReact },
                );
            }
        }
    }

    private async update(
        workspaceId: string,
        agentId: string | undefined,
        updates: Pick<Partial<GoalState>, "status" | "reason">,
    ): Promise<GoalState | null> {
        const current = await this.database.getGoal(workspaceId, agentId);
        if (!current) return null;
        const next = await this.database.upsertGoal({
            ...current,
            ...updates,
            updatedAt: Date.now(),
        });
        this.emit(next);
        await this.emitTopLevelTask(next);
        return next;
    }

    private emit(goal: GoalState): void {
        this.send("goal:changed", goal.workspaceId, goal);
    }

    private emitEvaluation(
        workspaceId: string,
        agentId: string | undefined,
        verdict: GoalVerdict,
        judgedMessageId: string | undefined,
    ): void {
        const payload = {
            workspaceId,
            agentId,
            verdict: verdict.verdict,
            reason: verdict.reason,
            attempt: this.getReact(workspaceId),
            judgedMessageId,
            error: verdict.verdict === "inconclusive" && verdict.reason.startsWith("judge error"),
        };
        this.send("goal:evaluation", workspaceId, payload);
    }

    private async emitTopLevelTask(goal: GoalState): Promise<void> {
        const taskStatus: PlanProgressUpdate["items"][number]["status"] =
            goal.status === "satisfied" ? "completed"
                : goal.status === "impossible" ? "blocked"
                    : "running";

        // Reuse the registry task id when the goal has been seen before so we
        // don't allocate a new T<n> on every status update.
        let taskId = this.goalTaskIds.get(goal.id);
        if (this.taskService && !taskId) {
            const task = await this.taskService.createTask({
                sessionId: goal.workspaceId,
                summary: goal.condition,
                owner: goal.agentId,
            });
            taskId = task.id;
            this.goalTaskIds.set(goal.id, taskId);
        }
        // Legacy fallback when no taskService is wired (e.g. string ctor).
        const effectiveTaskId = taskId ?? `goal:${goal.id}`;

        this.send("plan:progress", goal.workspaceId, {
            workspaceId: goal.workspaceId,
            status: goal.status === "satisfied" ? "completed" : "executing",
            items: [
                {
                    id: effectiveTaskId,
                    text: goal.condition,
                    status: taskStatus,
                },
            ],
        } satisfies PlanProgressUpdate);
    }

    async close(): Promise<void> {
        if (this.ownsDatabase) {
            await this.database.close();
        }
    }
}
