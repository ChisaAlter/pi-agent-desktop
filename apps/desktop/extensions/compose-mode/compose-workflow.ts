import { readFileSync, writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureComposeArtifactDirs, resolveComposeArtifactPaths } from "./artifact-paths.ts";
import { runChildAgent } from "./child-agent.ts";
import {
    applyComposeWorktreePatch,
    commitComposeWorkspace,
    type ComposeWorktreeBase,
    createComposeWorktree,
    detectGitWorktreeSupport,
    captureComposeWorktreePatch,
    removeComposeWorktree,
    workspaceHasGitChanges,
} from "./git-worktree.ts";
import { workflowPhaseLines, type WorkflowRunStore } from "./workflow-run-store.ts";
import type {
    ComposeWorkflowArgs,
    ComposeWorkflowTask,
    WorkflowRunOutcome,
    WorkflowRunSnapshot,
} from "./types.ts";

interface ExecuteComposeWorkflowOptions {
    runId: string;
    args: ComposeWorkflowArgs;
    ctx: ExtensionContext;
    store: WorkflowRunStore;
    onUpdate?: (message: string) => void;
}

interface ImplementTaskResult {
    taskId: string;
    mode: "worktree" | "sequential";
    changed: boolean;
    changedFiles: string[];
    summary: string;
}

function summarizeText(value: string, max = 280): string {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return "no output";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function extractSection(body: string, marker: string): string {
    const pattern = new RegExp(`===${marker}===\\s*([\\s\\S]*?)(?=\\n===|$)`, "i");
    return pattern.exec(body)?.[1]?.trim() ?? "";
}

function extractTaskList(body: string): ComposeWorkflowTask[] {
    const raw = extractSection(body, "TASKS");
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap((item, index): ComposeWorkflowTask[] => {
            if (!item || typeof item !== "object") return [];
            const task = item as Record<string, unknown>;
            const description = typeof task.description === "string" ? task.description.trim() : "";
            const acceptance = typeof task.acceptance === "string" ? task.acceptance.trim() : "";
            if (!description || !acceptance) return [];
            return [{
                id: typeof task.id === "string" && task.id.trim() ? task.id.trim() : `task-${index + 1}`,
                description,
                acceptance,
                dependsOn: Array.isArray(task.dependsOn)
                    ? task.dependsOn.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                    : [],
                files: Array.isArray(task.files)
                    ? task.files.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                    : undefined,
            }];
        });
    } catch {
        return [];
    }
}

function defaultSpec(task: string): string {
    return [
        "# Compose Runtime Generated Spec",
        "",
        "## Task",
        task,
        "",
        "## Scope",
        "- Deliver the requested change in the current workspace.",
        "- Keep the implementation grounded in repository evidence.",
    ].join("\n");
}

function defaultTasks(args: ComposeWorkflowArgs): ComposeWorkflowTask[] {
    return [{
        id: "task-1",
        description: args.task,
        acceptance: "Implement the requested change and verify it with repository-appropriate checks.",
        dependsOn: [],
    }];
}

function defaultPlan(args: ComposeWorkflowArgs, tasks = defaultTasks(args)): string {
    return [
        "# Compose Runtime Generated Plan",
        "",
        ...tasks.map((task, index) => `${index + 1}. ${task.id}: ${task.description}`),
        "",
        "## Verification",
        "- Run the relevant repository checks after implementation.",
    ].join("\n");
}

const REVIEW_MARKER = "===REVIEW===";

interface ReviewResult {
    ready: boolean;
    critical: string[];
    important: string[];
}

function parseReviewResult(body: string): ReviewResult {
    // Fail-safe defaults: any parse problem → ready:false so Merge is blocked.
    const empty: ReviewResult = { ready: false, critical: [], important: [] };
    const idx = body.indexOf(REVIEW_MARKER);
    if (idx < 0) return empty;
    try {
        const raw = body.substring(idx + REVIEW_MARKER.length).trim();
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return empty;
        const obj = parsed as Record<string, unknown>;
        const ready = typeof obj.ready === "boolean" ? obj.ready : false;
        const critical = Array.isArray(obj.critical)
            ? obj.critical.filter((v): v is string => typeof v === "string")
            : [];
        const important = Array.isArray(obj.important)
            ? obj.important.filter((v): v is string => typeof v === "string")
            : [];
        return { ready, critical, important };
    } catch {
        return empty;
    }
}

function refreshWorkflowUi(ctx: ExtensionContext, snapshot: WorkflowRunSnapshot): void {
    ctx.ui.setStatus("compose-workflow", `workflow:${snapshot.currentPhase ?? snapshot.status}`);
    ctx.ui.setWidget("plan-todos", workflowPhaseLines(snapshot));
}

function currentModelSelection(ctx: ExtensionContext): { provider?: string; modelId?: string } {
    if (!ctx.model) return {};
    return {
        provider: ctx.model.provider,
        modelId: ctx.model.id,
    };
}

function throwIfCancelled(store: WorkflowRunStore, runId: string): void {
    const snapshot = store.get(runId);
    if (snapshot?.status === "cancelled") {
        throw new Error(snapshot.outcome?.summary || "workflow cancelled");
    }
    const signal = store.abortSignal(runId);
    if (signal?.aborted) {
        throw new Error(typeof signal.reason === "string" ? signal.reason : "workflow cancelled");
    }
}

function beginPhase(options: ExecuteComposeWorkflowOptions, phase: string): void {
    throwIfCancelled(options.store, options.runId);
    const snapshot = options.store.beginPhase(options.runId, phase);
    if (snapshot) refreshWorkflowUi(options.ctx, snapshot);
    options.onUpdate?.(`▶ ${phase}`);
}

function completePhase(options: ExecuteComposeWorkflowOptions, phase: string, summary: string): void {
    const snapshot = options.store.completePhase(options.runId, phase, summary);
    if (snapshot) refreshWorkflowUi(options.ctx, snapshot);
    options.onUpdate?.(`✓ ${phase}: ${summary}`);
}

function skipPhase(options: ExecuteComposeWorkflowOptions, phase: string, summary: string): void {
    const snapshot = options.store.skipPhase(options.runId, phase, summary);
    if (snapshot) refreshWorkflowUi(options.ctx, snapshot);
    options.onUpdate?.(`- ${phase}: ${summary}`);
}

function failPhase(options: ExecuteComposeWorkflowOptions, phase: string, message: string): void {
    const snapshot = options.store.failPhase(options.runId, phase, message);
    if (snapshot) refreshWorkflowUi(options.ctx, snapshot);
}

async function runChildStep(
    options: ExecuteComposeWorkflowOptions,
    input: {
        label: string;
        prompt: string;
        cwd?: string;
        timeoutMs?: number;
    },
): Promise<string> {
    throwIfCancelled(options.store, options.runId);
    const model = currentModelSelection(options.ctx);
    const result = await runChildAgent({
        label: input.label,
        cwd: input.cwd ?? options.ctx.cwd,
        prompt: input.prompt,
        provider: model.provider,
        modelId: model.modelId,
        timeoutMs: input.timeoutMs,
        signal: options.store.abortSignal(options.runId),
    });
    if (!result.ok) {
        throw new Error(result.text || result.stderr || `${input.label} failed`);
    }
    return result.text || result.stdout;
}

async function runSingleChildPhase(
    options: ExecuteComposeWorkflowOptions,
    phase: string,
    prompt: string,
    cwd = options.ctx.cwd,
    timeoutMs = 5 * 60 * 1000,
): Promise<string> {
    beginPhase(options, phase);
    try {
        const output = await runChildStep(options, {
            label: phase,
            prompt,
            cwd,
            timeoutMs,
        });
        completePhase(options, phase, summarizeText(output));
        return output;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failPhase(options, phase, message);
        throw error;
    }
}

function normalizeTasks(args: ComposeWorkflowArgs, body: string): ComposeWorkflowTask[] {
    const extracted = extractTaskList(body);
    return extracted.length > 0 ? extracted : defaultTasks(args);
}

function topoSortTasks(tasks: ComposeWorkflowTask[]): { batches: ComposeWorkflowTask[][]; degradedReason?: string } {
    if (tasks.length <= 1) return { batches: tasks.map((task) => [task]) };
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const unknownDeps: string[] = [];
    const outgoing = new Map<string, string[]>();
    for (const task of tasks) outgoing.set(task.id, []);
    // Build adjacency (dep -> dependents). Skip unknown deps but record them.
    for (const task of tasks) {
        for (const dep of task.dependsOn) {
            if (!byId.has(dep)) {
                if (!unknownDeps.includes(dep)) unknownDeps.push(dep);
                continue;
            }
            outgoing.get(dep)?.push(task.id);
        }
    }
    const selfLoops = new Set<string>();
    for (const task of tasks) {
        if (task.dependsOn.includes(task.id)) selfLoops.add(task.id);
    }

    // Tarjan's SCC algorithm. Produces SCCs in reverse topological order.
    let index = 0;
    const indices = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    const strongconnect = (v: string): void => {
        indices.set(v, index);
        lowLinks.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
        for (const w of outgoing.get(v) ?? []) {
            if (!indices.has(w)) {
                strongconnect(w);
                lowLinks.set(v, Math.min(lowLinks.get(v)!, lowLinks.get(w)!));
            } else if (onStack.has(w)) {
                lowLinks.set(v, Math.min(lowLinks.get(v)!, indices.get(w)!));
            }
        }
        if (lowLinks.get(v) === indices.get(v)) {
            const scc: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);
            sccs.push(scc);
        }
    };
    for (const task of tasks) {
        if (!indices.has(task.id)) strongconnect(task.id);
    }

    // Map each task id to its SCC index.
    const sccId = new Map<string, number>();
    sccs.forEach((scc, i) => {
        for (const id of scc) sccId.set(id, i);
    });
    // An SCC is "cyclic" if it has >1 node, or a single node with a self-loop.
    const cyclicSccs = new Set<number>();
    sccs.forEach((scc, i) => {
        if (scc.length > 1) cyclicSccs.add(i);
        else if (selfLoops.has(scc[0])) cyclicSccs.add(i);
    });

    // Build condensation DAG and indegrees between SCCs.
    const sccOutgoing = new Map<number, Set<number>>();
    const sccIndegree = new Map<number, number>();
    sccs.forEach((_, i) => {
        sccOutgoing.set(i, new Set());
        sccIndegree.set(i, 0);
    });
    for (const task of tasks) {
        const u = sccId.get(task.id)!;
        for (const w of outgoing.get(task.id) ?? []) {
            const v = sccId.get(w)!;
            if (u !== v && !sccOutgoing.get(u)!.has(v)) {
                sccOutgoing.get(u)!.add(v);
                sccIndegree.set(v, (sccIndegree.get(v) ?? 0) + 1);
            }
        }
    }

    // Kahn's algorithm on the condensation. Each "wave" of ready SCCs:
    //  - non-cyclic SCCs (size 1, no self-loop) collapse into one parallel batch
    //  - cyclic SCCs expand to one serial batch per task (cycle → run serially)
    const remainingSccs = new Set(sccs.map((_, i) => i));
    const batches: ComposeWorkflowTask[][] = [];
    let cyclicTaskCount = 0;

    while (remainingSccs.size > 0) {
        const ready = [...remainingSccs].filter((i) => (sccIndegree.get(i) ?? 0) === 0);
        if (ready.length === 0) {
            // Defensive: should be unreachable after SCC decomposition.
            const leftover = [...remainingSccs].flatMap((i) => sccs[i].map((id) => byId.get(id)!).filter(Boolean));
            batches.push(leftover);
            break;
        }
        const nonCyclicReady = ready.filter((i) => !cyclicSccs.has(i));
        const cyclicReady = ready.filter((i) => cyclicSccs.has(i));
        if (nonCyclicReady.length > 0) {
            const batch: ComposeWorkflowTask[] = [];
            for (const i of nonCyclicReady) {
                for (const id of sccs[i]) {
                    const t = byId.get(id);
                    if (t) batch.push(t);
                }
            }
            batches.push(batch);
        }
        for (const i of cyclicReady) {
            cyclicTaskCount += sccs[i].length;
            for (const id of sccs[i]) {
                const t = byId.get(id);
                if (t) batches.push([t]);
            }
        }
        for (const i of ready) {
            remainingSccs.delete(i);
            for (const v of sccOutgoing.get(i) ?? []) {
                sccIndegree.set(v, Math.max(0, (sccIndegree.get(v) ?? 0) - 1));
            }
        }
    }

    const reasons: string[] = [];
    if (cyclicTaskCount > 0) {
        reasons.push(`${cyclicTaskCount} task(s) formed cycles and will run serially within each cycle; acyclic tasks remain parallel`);
    }
    if (unknownDeps.length > 0) {
        reasons.push(`unknown dependencies ignored: ${unknownDeps.join(", ")}`);
    }
    return {
        batches,
        degradedReason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
}

function defaultCommitMessage(args: ComposeWorkflowArgs): string {
    const summary = args.task.replace(/\s+/g, " ").trim().slice(0, 68);
    if (args.commitMessage?.trim()) return args.commitMessage.trim();
    if (args.type === "bugfix") return `fix(compose): ${summary}`;
    if (args.type === "refactor") return `refactor(compose): ${summary}`;
    if (args.type === "feedback") return `chore(compose): ${summary}`;
    return `feat(compose): ${summary}`;
}

async function runWorktreeTask(
    options: ExecuteComposeWorkflowOptions,
    task: ComposeWorkflowTask,
    specPath: string,
    planPath: string,
    worktreeBase: ComposeWorktreeBase,
): Promise<ImplementTaskResult> {
    const worktree = createComposeWorktree(options.ctx.cwd, options.runId, task.id, worktreeBase);
    let primaryError: unknown;
    let result: ImplementTaskResult | null = null;
    try {
        const output = await runChildStep(options, {
            label: `Implement ${task.id}`,
            cwd: worktree.worktreePath,
            timeoutMs: 15 * 60 * 1000,
            prompt: [
                "You are the Implement phase of Pi Desktop Compose runtime.",
                `Task ID: ${task.id}`,
                `Task Description: ${task.description}`,
                `Acceptance: ${task.acceptance}`,
                task.files?.length ? `Relevant Files: ${task.files.join(", ")}` : "",
                `Read and follow:\n- ${specPath}\n- ${planPath}`,
                "Implement only this task inside the current worktree. Do not commit; the runtime will integrate the patch.",
                "Return a concise bullet summary of changed files and behavior.",
            ].filter(Boolean).join("\n"),
        });
        const patch = captureComposeWorktreePatch(worktree.worktreePath);
        if (!patch.changed || !patch.patch) {
            result = {
                taskId: task.id,
                mode: "worktree",
                changed: false,
                changedFiles: [],
                summary: `${task.id}: no workspace changes`,
            };
            return result;
        }
        applyComposeWorktreePatch(worktree.gitRoot, patch.patch, task.id);
        result = {
            taskId: task.id,
            mode: "worktree",
            changed: true,
            changedFiles: patch.changedFiles,
            summary: `${task.id}: ${summarizeText(output)}; ${patch.summary}`,
        };
        return result;
    } catch (error) {
        primaryError = error;
    } finally {
        try {
            removeComposeWorktree(worktree);
        } catch (cleanupError) {
            if (!primaryError) {
                primaryError = cleanupError;
            }
            options.onUpdate?.(`! cleanup ${task.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
    }
    if (primaryError) throw primaryError;
    if (!result) throw new Error(`Worktree task ${task.id} did not produce a result.`);
    return result;
}

async function runSequentialTask(
    options: ExecuteComposeWorkflowOptions,
    task: ComposeWorkflowTask,
    specPath: string,
    planPath: string,
    degradedReason?: string,
): Promise<ImplementTaskResult> {
    const output = await runChildStep(options, {
        label: `Implement ${task.id}`,
        timeoutMs: 15 * 60 * 1000,
        prompt: [
            "You are the Implement phase of Pi Desktop Compose runtime.",
            `Task ID: ${task.id}`,
            `Task Description: ${task.description}`,
            `Acceptance: ${task.acceptance}`,
            task.files?.length ? `Relevant Files: ${task.files.join(", ")}` : "",
            `Read and follow:\n- ${specPath}\n- ${planPath}`,
            "Implement only this task in the current workspace. Keep scope tight and do not commit.",
            degradedReason ? `Sequential fallback reason: ${degradedReason}` : "",
            "Return a concise bullet summary of changed files and behavior.",
        ].filter(Boolean).join("\n"),
    });
    return {
        taskId: task.id,
        mode: "sequential",
        changed: true,
        changedFiles: [],
        summary: `${task.id}: ${summarizeText(output)}`,
    };
}

// TODO: split into phases/*.ts (SubTask 25.5 deferred). Each phase
// (brainstorm/design/implement/verify/review/report/merge) should become its
// own module to shrink this orchestrator. Deferred because the 7-file split is
// high-risk and the logic fixes above are the priority.
export async function executeComposeWorkflow(
    options: ExecuteComposeWorkflowOptions,
): Promise<WorkflowRunOutcome> {
    const { args, ctx, store, runId, onUpdate } = options;
    const artifactPaths = resolveComposeArtifactPaths(ctx.cwd, args);
    ensureComposeArtifactDirs(artifactPaths);
    store.setArtifacts(runId, [artifactPaths.specPath, artifactPaths.planPath, artifactPaths.reportPath]);
    const worktreeSupport = detectGitWorktreeSupport(ctx.cwd);
    const worktreeBase = worktreeSupport.supported && worktreeSupport.gitRoot && worktreeSupport.headSha
        ? {
            gitRoot: worktreeSupport.gitRoot,
            headSha: worktreeSupport.headSha,
        }
        : undefined;
    const phaseSummaries: string[] = [];
    const taskHistory: ImplementTaskResult[] = [];
    // Global deadline for the whole workflow. Default 1h.
    const deadline = Date.now() + (args.timeoutMs ?? 60 * 60 * 1000);
    const assertBeforeDeadline = (): void => {
        if (Date.now() > deadline) {
            throw new Error("compose.timeout: Compose 工作流超时");
        }
    };

    try {
        // SubTask 25.2: fast-fail if commit was requested but the repo is dirty.
        // worktreeSupport.clean is undefined when not a git repo; treat as not-dirty
        // so the Merge phase can produce its own clearer error for non-repo workspaces.
        if (args.commit === true && worktreeSupport.clean === false) {
            throw new Error("compose.dirtyRepo: 仓库不干净,无法提交");
        }

        assertBeforeDeadline();
        const brainstorm = await runSingleChildPhase(
            options,
            "Brainstorm",
            [
                "You are the Brainstorm phase of Pi Desktop Compose runtime.",
                `Task: ${args.task}`,
                "Read AGENTS.md and the most relevant source files if they exist.",
                "Return concise markdown with sections: Context, Constraints, Risks, Proposed Approach.",
            ].join("\n"),
        );
        phaseSummaries.push(`Brainstorm: ${summarizeText(brainstorm)}`);

        assertBeforeDeadline();
        const design = await runSingleChildPhase(
            options,
            "Design",
            [
                "You are the Design phase of Pi Desktop Compose runtime.",
                `Task: ${args.task}`,
                "Produce a spec, an implementation plan, and a machine-usable task list.",
                "Keep the task list tight: one small change should remain one task, not many copies.",
                "Return exactly this format and nothing else:",
                "===SPEC===",
                "<markdown spec>",
                "===PLAN===",
                "<markdown implementation plan>",
                "===TASKS===",
                '[{"id":"task-1","description":"...","acceptance":"...","dependsOn":[],"files":["optional/path.ts"]}]',
            ].join("\n"),
        );

        const tasks = normalizeTasks(args, design);
        const specMarkdown = extractSection(design, "SPEC") || defaultSpec(args.task);
        const planMarkdown = extractSection(design, "PLAN") || defaultPlan(args, tasks);
        writeFileSync(artifactPaths.specPath, specMarkdown.endsWith("\n") ? specMarkdown : `${specMarkdown}\n`, "utf8");
        writeFileSync(artifactPaths.planPath, planMarkdown.endsWith("\n") ? planMarkdown : `${planMarkdown}\n`, "utf8");
        phaseSummaries.push(`Design: wrote ${artifactPaths.specPath} and ${artifactPaths.planPath}`);

        assertBeforeDeadline();
        beginPhase(options, "Implement");
        const topo = topoSortTasks(tasks);
        if (topo.degradedReason) {
            onUpdate?.(`! Implement fallback: ${topo.degradedReason}`);
            phaseSummaries.push(`Implement fallback: ${topo.degradedReason}`);
        }
        let canUseWorktrees = worktreeSupport.supported;
        let sequentialReason = worktreeSupport.supported
            ? undefined
            : worktreeSupport.reason ?? "Git worktree support is unavailable.";
        const requestedConcurrency = Math.max(1, args.maxConcurrent ?? 2);

        for (const [batchIndex, batch] of topo.batches.entries()) {
            throwIfCancelled(store, runId);
            const batchIds = batch.map((task) => task.id).join(", ");
            const preferIsolation = args.isolateWorktrees === true
                || (args.isolateWorktrees !== false && batch.length > 1);
            const useWorktrees = preferIsolation && canUseWorktrees && batch.length > 1;

            if (useWorktrees) {
                if (!worktreeBase) {
                    throw new Error(worktreeSupport.reason ?? "Git worktree support is unavailable.");
                }
                onUpdate?.(`↺ Implement batch ${batchIndex + 1}: isolated worktrees for ${batchIds}`);
                const concurrency = Math.max(1, Math.min(requestedConcurrency, batch.length));
                for (let index = 0; index < batch.length; index += concurrency) {
                    const chunk = batch.slice(index, index + concurrency);
                    const chunkResults = await Promise.all(chunk.map((task) => runWorktreeTask(
                        options,
                        task,
                        artifactPaths.specPath,
                        artifactPaths.planPath,
                        worktreeBase,
                    )));
                    taskHistory.push(...chunkResults);
                }
                canUseWorktrees = !workspaceHasGitChanges(ctx.cwd) ? canUseWorktrees : false;
                if (!canUseWorktrees) {
                    sequentialReason = "Primary workspace now contains uncommitted compose changes; later dependent tasks run sequentially.";
                }
                continue;
            }

            const reason = sequentialReason ?? (preferIsolation && batch.length > 1
                ? "Worktree isolation was requested but could not be used for this batch."
                : undefined);
            onUpdate?.(`↺ Implement batch ${batchIndex + 1}: sequential ${reason ? `(${reason})` : batchIds}`);
            for (const task of batch) {
                const result = await runSequentialTask(
                    options,
                    task,
                    artifactPaths.specPath,
                    artifactPaths.planPath,
                    reason,
                );
                taskHistory.push(result);
            }
            if (workspaceHasGitChanges(ctx.cwd)) {
                canUseWorktrees = false;
                sequentialReason = "Primary workspace has uncommitted compose changes, so later tasks stay sequential.";
            }
        }

        const implementSummary = taskHistory.length > 0
            ? taskHistory.map((task) => task.summary).join("; ")
            : "no implementation tasks were emitted";
        completePhase(options, "Implement", summarizeText(implementSummary, 500));
        phaseSummaries.push(`Implement: ${summarizeText(implementSummary, 500)}`);

        assertBeforeDeadline();
        const verify = await runSingleChildPhase(
            options,
            "Verify",
            [
                "You are the Verify phase of Pi Desktop Compose runtime.",
                `Task: ${args.task}`,
                "Run the relevant verification commands for this repository from the correct working directory.",
                "Return sections: Result, Commands, Failures.",
            ].join("\n"),
            ctx.cwd,
            10 * 60 * 1000,
        );
        phaseSummaries.push(`Verify: ${summarizeText(verify)}`);

        assertBeforeDeadline();
        const review = await runSingleChildPhase(
            options,
            "Review",
            [
                "You are the Review phase of Pi Desktop Compose runtime.",
                `Task: ${args.task}`,
                `Read ${artifactPaths.specPath} and ${artifactPaths.planPath}.`,
                "Review the current workspace changes against them.",
                "Return exactly this format and nothing else:",
                "===REVIEW===",
                '{"ready": true|false, "critical": ["..."], "important": ["..."]}',
                "ready=false if any critical issue would block merge. critical/important are short bullet strings.",
            ].join("\n"),
        );
        const reviewResult = parseReviewResult(review);
        phaseSummaries.push(`Review: ${reviewResult.ready ? "ready" : "not ready"}`);

        assertBeforeDeadline();
        if (args.skipReport) {
            skipPhase(options, "Report", "report generation skipped by args.skipReport");
            phaseSummaries.push("Report: skipped");
        } else {
            beginPhase(options, "Report");
            const reportBody = [
                "# Compose Workflow Report",
                "",
                `Task: ${args.task}`,
                `Run ID: ${runId}`,
                "",
                "## Artifact Paths",
                `- Spec: ${artifactPaths.specPath}`,
                `- Plan: ${artifactPaths.planPath}`,
                `- Report: ${artifactPaths.reportPath}`,
                "",
                "## Worktree Support",
                `- Supported: ${worktreeSupport.supported ? "yes" : "no"}`,
                `- Reason: ${worktreeSupport.reason ?? "n/a"}`,
                "",
                "## Task Execution",
                ...(taskHistory.length > 0
                    ? taskHistory.map((task) => `- ${task.taskId} [${task.mode}] ${task.summary}`)
                    : ["- No implementation tasks were emitted."]),
                "",
                "## Phase Summaries",
                ...phaseSummaries.map((line) => `- ${line}`),
                "",
                "## Review",
                `- Ready: ${reviewResult.ready ? "yes" : "no"}`,
                ...(reviewResult.critical.length > 0 ? ["- Critical:", ...reviewResult.critical.map((line) => `  - ${line}`)] : []),
                ...(reviewResult.important.length > 0 ? ["- Important:", ...reviewResult.important.map((line) => `  - ${line}`)] : []),
                "",
                "## Verification Output",
                "```text",
                verify.trim(),
                "```",
            ].join("\n");
            writeFileSync(artifactPaths.reportPath, reportBody.endsWith("\n") ? reportBody : `${reportBody}\n`, "utf8");
            completePhase(options, "Report", `wrote ${artifactPaths.reportPath}`);
            phaseSummaries.push(`Report: wrote ${artifactPaths.reportPath}`);
        }

        assertBeforeDeadline();
        beginPhase(options, "Merge");
        let mergeSummary: string;
        if (!reviewResult.ready) {
            mergeSummary = "Merge skipped because review produced critical findings.";
        } else if (!args.commit) {
            mergeSummary = workspaceHasGitChanges(ctx.cwd)
                ? "Commit not requested; compose changes remain uncommitted in the workspace."
                : "Commit not requested and no additional git changes remained.";
        } else if (!worktreeSupport.gitRoot) {
            mergeSummary = "Commit requested but the workspace is not a git repository.";
            failPhase(options, "Merge", mergeSummary);
            throw new Error(mergeSummary);
        } else if (worktreeSupport.clean === false) {
            mergeSummary = "Commit requested but the repository started dirty, so Compose will not auto-commit mixed changes.";
            failPhase(options, "Merge", mergeSummary);
            throw new Error(mergeSummary);
        } else {
            const commitResult = commitComposeWorkspace(ctx.cwd, defaultCommitMessage(args));
            mergeSummary = commitResult.committed
                ? `${commitResult.summary}${commitResult.sha ? ` sha=${commitResult.sha}` : ""}`
                : commitResult.summary;
        }
        completePhase(options, "Merge", mergeSummary);
        phaseSummaries.push(`Merge: ${mergeSummary}`);

        if (!reviewResult.ready) {
            throw new Error(`Review blocked merge: ${reviewResult.critical.join("; ") || "critical findings present"}`);
        }

        return {
            status: "completed",
            summary: `Compose workflow completed for: ${args.task}`,
            artifacts: [artifactPaths.specPath, artifactPaths.planPath, artifactPaths.reportPath],
            phaseSummaries,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const existingReport = artifactPaths.reportPath;
        try {
            const prior = (() => {
                try {
                    return readFileSync(existingReport, "utf8");
                } catch {
                    return "";
                }
            })();
            const failureReport = [
                prior.trim(),
                prior.trim() ? "" : "# Compose Workflow Failure Report",
                prior.trim() ? "" : `Task: ${args.task}`,
                "## Failure",
                message,
            ].join("\n").trim();
            writeFileSync(existingReport, `${failureReport}\n`, "utf8");
        } catch {
            // ignore best-effort report write failure
        }
        const cancelled = store.get(runId)?.status === "cancelled";
        if (!cancelled) {
            store.fail(runId, message, phaseSummaries);
        }
        throw error;
    } finally {
        const snapshot = store.get(runId);
        if (snapshot) refreshWorkflowUi(ctx, snapshot);
    }
}
