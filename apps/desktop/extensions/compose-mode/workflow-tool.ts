import { Type } from "typebox";
import { defineTool, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { executeComposeWorkflow } from "./compose-workflow.ts";
import { workflowPhaseLines, type WorkflowRunStore } from "./workflow-run-store.ts";
import type { ComposeWorkflowArgs, WorkflowRunSnapshot } from "./types.ts";

const workflowArgsSchema = Type.Object({
    task: Type.String({ description: "The user request that Compose should execute." }),
    type: Type.Optional(Type.String({ description: "feature | bugfix | refactor | feedback" })),
    featureName: Type.Optional(Type.String({ description: "Optional artifact slug override." })),
    maxConcurrent: Type.Optional(Type.Number({ description: "Requested concurrency cap." })),
    skipReport: Type.Optional(Type.Boolean({ description: "Skip writing the compose report." })),
    isolateWorktrees: Type.Optional(Type.Boolean({ description: "Prefer worktree isolation when supported." })),
    commit: Type.Optional(Type.Boolean({ description: "Request a commit during Merge phase." })),
    commitMessage: Type.Optional(Type.String({ description: "Optional commit message for Merge phase." })),
    timeoutMs: Type.Optional(Type.Number({ description: "Global deadline (ms) for the whole workflow. Defaults to 1h." })),
});

const workflowSchema = Type.Union([
    Type.Object({
        operation: Type.Literal("run"),
        name: Type.String({ description: "Currently only `compose` is supported." }),
        args: workflowArgsSchema,
    }),
    Type.Object({
        operation: Type.Literal("status"),
        runId: Type.String({ description: "Workflow run id." }),
    }),
    Type.Object({
        operation: Type.Literal("wait"),
        runId: Type.String({ description: "Workflow run id." }),
    }),
    Type.Object({
        operation: Type.Literal("cancel"),
        runId: Type.String({ description: "Workflow run id." }),
    }),
]);

function snapshotSummary(snapshot: WorkflowRunSnapshot): string {
    const phases = workflowPhaseLines(snapshot).join("\n");
    return [
        `run_id: ${snapshot.id}`,
        `status: ${snapshot.status}`,
        snapshot.currentPhase ? `current_phase: ${snapshot.currentPhase}` : undefined,
        "",
        phases,
        snapshot.outcome?.summary ? `\nsummary: ${snapshot.outcome.summary}` : undefined,
        snapshot.error ? `\nerror: ${snapshot.error}` : undefined,
    ].filter(Boolean).join("\n");
}

function normalizeComposeArgs(args: Record<string, unknown>): ComposeWorkflowArgs {
    return {
        task: typeof args.task === "string" ? args.task.trim() : "",
        type: args.type === "bugfix" || args.type === "refactor" || args.type === "feedback" || args.type === "feature"
            ? args.type
            : undefined,
        featureName: typeof args.featureName === "string" ? args.featureName.trim() : undefined,
        maxConcurrent: typeof args.maxConcurrent === "number" ? args.maxConcurrent : undefined,
        skipReport: args.skipReport === true,
        isolateWorktrees: typeof args.isolateWorktrees === "boolean" ? args.isolateWorktrees : undefined,
        commit: args.commit === true,
        commitMessage: typeof args.commitMessage === "string" ? args.commitMessage.trim() : undefined,
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    };
}

function updateWorkflowUi(ctx: ExtensionContext, snapshot: WorkflowRunSnapshot): void {
    ctx.ui.setStatus("compose-workflow", `workflow:${snapshot.currentPhase ?? snapshot.status}`);
    ctx.ui.setWidget("plan-todos", workflowPhaseLines(snapshot));
}

export interface WorkflowToolOptions {
    onSnapshot?: (snapshot: WorkflowRunSnapshot) => void;
}

function publishWorkflowUi(ctx: ExtensionContext, snapshot: WorkflowRunSnapshot, options: WorkflowToolOptions): void {
    updateWorkflowUi(ctx, snapshot);
    options.onSnapshot?.(snapshot);
}

export function createWorkflowTool(store: WorkflowRunStore, options: WorkflowToolOptions = {}): ToolDefinition<typeof workflowSchema, { run?: WorkflowRunSnapshot }> {
    return defineTool({
        name: "workflow",
        label: "Workflow",
        description: "Run the built-in Compose workflow only for complex multi-step implementation work. Do not use it for simple Q&A, web research, read-only exploration, explanations, or one small direct edit.",
        parameters: workflowSchema,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            if (params.operation === "status") {
                const snapshot = store.get(params.runId);
                if (!snapshot) {
                    return {
                        content: [{ type: "text", text: `Unknown workflow run: ${params.runId}` }],
                        details: {},
                        isError: true,
                    };
                }
                publishWorkflowUi(ctx, snapshot, options);
                return {
                    content: [{ type: "text", text: snapshotSummary(snapshot) }],
                    details: { run: snapshot },
                };
            }
            if (params.operation === "wait") {
                const outcome = await store.wait(params.runId);
                const snapshot = store.get(params.runId);
                if (snapshot) publishWorkflowUi(ctx, snapshot, options);
                return {
                    content: [{ type: "text", text: snapshot ? snapshotSummary(snapshot) : outcome.summary }],
                    details: snapshot ? { run: snapshot } : {},
                    isError: outcome.status === "failed",
                };
            }
            if (params.operation === "cancel") {
                const snapshot = store.requestCancel(params.runId, "workflow cancelled by tool call");
                if (!snapshot) {
                    return {
                        content: [{ type: "text", text: `Unknown workflow run: ${params.runId}` }],
                        details: {},
                        isError: true,
                    };
                }
                publishWorkflowUi(ctx, snapshot, options);
                return {
                    content: [{ type: "text", text: snapshotSummary(snapshot) }],
                    details: { run: snapshot },
                };
            }

            if (params.name !== "compose") {
                return {
                    content: [{ type: "text", text: `Unsupported workflow name: ${params.name}. Only \`compose\` is available.` }],
                    details: {},
                    isError: true,
                };
            }

            const args = normalizeComposeArgs(params.args);
            if (!args.task) {
                return {
                    content: [{ type: "text", text: "workflow compose requires args.task" }],
                    details: {},
                    isError: true,
                };
            }

            const run = store.createComposeRun(args.task);
            publishWorkflowUi(ctx, run, options);
            onUpdate?.({
                content: [{ type: "text", text: `Started compose workflow ${run.id}` }],
                details: { run },
            });

            if (signal) {
                signal.addEventListener("abort", () => {
                    store.requestCancel(run.id, "workflow tool execution aborted");
                }, { once: true });
            }

            try {
                const outcome = await executeComposeWorkflow({
                    runId: run.id,
                    args,
                    ctx,
                    store,
                    onUpdate: (message) => {
                        const snapshot = store.get(run.id);
                        onUpdate?.({
                            content: [{ type: "text", text: message }],
                            details: snapshot ? { run: snapshot } : {},
                        });
                    },
                });
                const snapshot = store.complete(run.id, outcome) ?? store.get(run.id);
                if (snapshot) publishWorkflowUi(ctx, snapshot, options);
                return {
                    content: [{ type: "text", text: snapshot ? snapshotSummary(snapshot) : outcome.summary }],
                    details: snapshot ? { run: snapshot } : {},
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const cancelledSnapshot = store.get(run.id);
                const snapshot = cancelledSnapshot?.status === "cancelled"
                    ? cancelledSnapshot
                    : (store.fail(run.id, message) ?? store.get(run.id));
                if (snapshot) publishWorkflowUi(ctx, snapshot, options);
                return {
                    content: [{ type: "text", text: snapshot ? snapshotSummary(snapshot) : message }],
                    details: snapshot ? { run: snapshot } : {},
                    isError: snapshot?.status !== "cancelled",
                };
            }
        },
    });
}
