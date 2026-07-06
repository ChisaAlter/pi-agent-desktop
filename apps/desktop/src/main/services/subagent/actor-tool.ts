import { Type, type Static } from "typebox";
import {
    defineTool,
    type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import type { SubagentInstance, SubagentResult } from "@shared";
import { listSpawnable } from "./registry";
import type { SubagentManager } from "./manager";

/**
 * actor tool — Phase E Task 3.
 *
 * Pi CLI `ToolDefinition` injected into the primary agent's `customTools`
 * (via `createWorkspaceSession({ customTools: [actorTool] })`). Lets the LLM
 * delegate work to specialized subagents and await their result inline.
 *
 * Verbs (mirrors MiMo Code `tool/actor.ts` minus spawn / send / models):
 *  - `run`     — spawn a subagent, block until terminal, return `<actor_result>`.
 *  - `status`  — non-blocking snapshot of an actor.
 *  - `wait`    — block until terminal (or `timeout_ms`).
 *  - `cancel`  — abort a running actor; idempotent.
 *
 * Nesting prevention: subagent sessions are created WITHOUT the `actor` tool
 * in their `customTools`, so the LLM cannot call `actor` from inside a
 * subagent. There is no `ctx.agentType` field on Pi CLI's `ExtensionContext`
 * to detect this at runtime; the implicit prevention (tool not registered) is
 * the contract. A defensive runtime check is documented but not implemented.
 *
 * Context inheritance:
 *  - `none`  (default) — subagent starts with empty conversation.
 *  - `state` — TODO Task 4: prepend `<session-state>` from `checkpointService`.
 *              Currently falls back to `none` (no checkpoint integration yet).
 *  - `full`  — REJECTED. Pi CLI SDK has no fork-agent / prefix-cache support.
 *
 * Result format (per spec.md "Subagent Result Handoff"):
 *   actor_id: <id>
 *
 *   <actor_result status="success" summary="<optional 1-line>">
 *   <final assistant text>
 *   </actor_result>
 *
 * On hard errors (e.g., `context: "full"`, unknown spawnable types), the tool
 * throws — the Pi CLI runtime catches and surfaces it as an error tool result.
 * On soft errors (unknown `actor_id` in status/wait/cancel), returns a JSON
 * snapshot with `status: "unknown"` so the LLM can react without retrying.
 */

// ── Dynamic subagent_type enum ──────────────────────────────────

const SPAWNABLE_NAMES = listSpawnable().map((s) => s.name);
if (SPAWNABLE_NAMES.length === 0) {
    // Per spec SubTask 3.5: empty list → fail-fast at construction time.
    // `createActorTool` is called from `AgentRuntimeRegistry.create`, so a
    // missing registry would surface at app startup, not at runtime.
    throw new Error("No spawnable subagent types — registry misconfigured");
}

const subagentTypeEnum = Type.Union(
    SPAWNABLE_NAMES.map((name) => Type.Literal(name)),
    { description: "Spawnable subagent type. Hidden types (dream/distill) are excluded — use slash commands." },
);

// ── Operation schemas ───────────────────────────────────────────

const contextEnum = Type.Union(
    [Type.Literal("none"), Type.Literal("state"), Type.Literal("full")],
    {
        description:
            "(optional) Context inheritance. 'none' (default): child sees only the prompt. 'state': child gets a checkpoint summary (Task 4). 'full': REJECTED in Pi Desktop.",
    },
);

const runOperationSchema = Type.Object({
    action: Type.Literal("run", { description: "Spawn a subagent and block until it completes; the result is returned inline as the tool response." }),
    subagent_type: subagentTypeEnum,
    description: Type.String({ description: "A short (3-5 words) description of the task." }),
    prompt: Type.String({ description: "The task for the subagent to perform." }),
    timeout_ms: Type.Optional(
        Type.Number({
            description: "(optional) Milliseconds to wait before returning status='timeout'. Default 600000 (10 min).",
        }),
    ),
    context: Type.Optional(contextEnum),
});

const statusOperationSchema = Type.Object({
    action: Type.Literal("status", { description: "Return a non-blocking snapshot of an actor." }),
    actor_id: Type.String({ description: "Actor session id returned by a prior `run` call." }),
});

const waitOperationSchema = Type.Object({
    action: Type.Literal("wait", { description: "Block until the actor reaches a terminal state or timeout." }),
    actor_id: Type.String({ description: "Actor session id returned by a prior `run` call." }),
    timeout_ms: Type.Optional(
        Type.Number({
            description: "(optional) Max wait in milliseconds. Default 600000 (10 min). Returns null on timeout.",
        }),
    ),
});

const cancelOperationSchema = Type.Object({
    action: Type.Literal("cancel", { description: "Abort a running actor. Idempotent — no-op on terminal actors." }),
    actor_id: Type.String({ description: "Actor session id returned by a prior `run` call." }),
});

const parameters = Type.Object({
    operation: Type.Union(
        [runOperationSchema, statusOperationSchema, waitOperationSchema, cancelOperationSchema],
        { description: "Actor operation. Use `run` to delegate work; `status`/`wait`/`cancel` to manage prior actors." },
    ),
});

type ActorOperation = Static<typeof parameters>["operation"];
type ActorToolDetails = { result?: SubagentResult; snapshot?: SubagentInstance };

// ── Factory ─────────────────────────────────────────────────────

export interface ActorToolWorkspace {
    workspaceId: string;
    workspacePath: string;
}

/**
 * Construct the `actor` tool bound to a specific primary agent + workspace.
 *
 * Deviation from spec SubTask 3.1: signature is `(manager, agentId, workspace)`
 * instead of `(manager, agentId)`. The workspace info is required by
 * `manager.spawn({ context: { workspaceId, workspacePath, agentId } })` and
 * cannot be derived from `agentId` alone without a lookup table in the
 * manager. Task 7's `attachToAgent` may later centralize this, but for now
 * the explicit arg is simpler.
 *
 * Return type is intentionally inferred (no explicit annotation) — `defineTool()`
 * returns `ToolDefinition<TParams, TDetails> & AnyToolDefinition`, and an
 * explicit annotation would lose the intersection, breaking assignability to
 * `ToolDefinition[]` in `createWorkspaceSession({ customTools })`.
 */
export function createActorTool(
    manager: SubagentManager,
    agentId: string,
    workspace: ActorToolWorkspace,
) {
    return defineTool({
        name: "actor",
        label: "Actor",
        description:
            "Invoke specialized subagents (general / explore) for delegated work. " +
            "The `run` action blocks until the subagent completes and returns its " +
            "final assistant message as `<actor_result>`. Use `status` / `wait` / " +
            "`cancel` to manage prior actors. Subagents cannot call this tool.",
        parameters,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<ActorToolDetails>> {
            const op = params.operation as ActorOperation;

            if (op.action === "run") {
                return handleRun(manager, agentId, workspace, op);
            }
            if (op.action === "status") {
                return handleStatus(manager, agentId, op);
            }
            if (op.action === "wait") {
                return handleWait(manager, agentId, op);
            }
            if (op.action === "cancel") {
                return handleCancel(manager, agentId, op);
            }
            // Exhaustive check — unreachable.
            const _exhaustive: never = op;
            return _exhaustive;
        },
    });
}

// ── Verb handlers ───────────────────────────────────────────────

async function handleRun(
    manager: SubagentManager,
    agentId: string,
    workspace: ActorToolWorkspace,
    op: Extract<ActorOperation, { action: "run" }>,
): Promise<AgentToolResult<ActorToolDetails>> {
    // SubTask 3.7: reject `context: "full"` — Pi CLI SDK has no fork-agent.
    if (op.context === "full") {
        throw new Error(
            "context='full' is not supported in Pi Desktop (requires Pi CLI SDK fork-agent support). " +
                "Use context: \"state\" instead.",
        );
    }

    // `context: "state"` is accepted but currently treated as "none" until
    // Task 4 wires up `checkpointService.rebuildContext`. The checkpoint
    // summary would be prepended to the prompt here.
    const effectivePrompt = op.prompt;

    const { actorId, outcome } = await manager.spawn({
        context: {
            workspaceId: workspace.workspaceId,
            workspacePath: workspace.workspacePath,
            agentId,
        },
        subagentType: op.subagent_type,
        description: op.description,
        prompt: effectivePrompt,
        timeoutMs: op.timeout_ms,
    });

    const result = await outcome;
    return {
        content: [{ type: "text", text: formatResult(actorId, result) }],
        details: { result },
    };
}

async function handleStatus(
    manager: SubagentManager,
    agentId: string,
    op: Extract<ActorOperation, { action: "status" }>,
): Promise<AgentToolResult<ActorToolDetails>> {
    const snapshot = manager.status(agentId, op.actor_id);
    if (!snapshot) {
        return {
            content: [{ type: "text", text: formatUnknown(op.actor_id) }],
            details: {},
        };
    }
    return {
        content: [{ type: "text", text: formatSnapshot(snapshot) }],
        details: { snapshot },
    };
}

async function handleWait(
    manager: SubagentManager,
    agentId: string,
    op: Extract<ActorOperation, { action: "wait" }>,
): Promise<AgentToolResult<ActorToolDetails>> {
    const result = await manager.wait(agentId, op.actor_id, op.timeout_ms);
    if (!result) {
        return {
            content: [{ type: "text", text: formatUnknown(op.actor_id) }],
            details: {},
        };
    }
    return {
        content: [{ type: "text", text: formatResult(op.actor_id, result) }],
        details: { result },
    };
}

async function handleCancel(
    manager: SubagentManager,
    agentId: string,
    op: Extract<ActorOperation, { action: "cancel" }>,
): Promise<AgentToolResult<ActorToolDetails>> {
    const snapshot = manager.cancel(agentId, op.actor_id);
    if (!snapshot) {
        return {
            content: [{ type: "text", text: formatUnknown(op.actor_id) }],
            details: {},
        };
    }
    return {
        content: [{ type: "text", text: formatSnapshot(snapshot) }],
        details: { snapshot },
    };
}

// ── Formatters ──────────────────────────────────────────────────

/** Max first-line length eligible to become the `summary` attribute. */
const SUMMARY_MAX_LEN = 80;

/**
 * Format the terminal payload per spec.md "Subagent Result Handoff":
 *
 *   actor_id: <id>
 *
 *   <actor_result status="success" summary="<optional 1-line>">
 *   <final assistant text>
 *   </actor_result>
 *
 * Failure paths surface the error inline rather than throwing — the LLM gets
 * the structured text and can decide whether to retry / give up.
 */
function formatResult(actorId: string, result: SubagentResult): string {
    const header = `actor_id: ${actorId}\n\n`;
    switch (result.status) {
        case "success": {
            const text = result.lastAssistantText ?? "";
            const summary = extractSummary(text);
            const summaryAttr = summary ? ` summary="${escapeAttr(summary)}"` : "";
            return `${header}<actor_result status="success"${summaryAttr}>\n${text}\n</actor_result>`;
        }
        case "cancelled": {
            return `${header}<actor_result status="cancelled">task was cancelled</actor_result>`;
        }
        case "timeout": {
            return `${header}<actor_result status="timeout">task did not complete within timeout</actor_result>`;
        }
        case "failed": {
            const message = result.error ?? "unknown error";
            return `${header}<actor_result status="failure">${escapeXmlText(message)}</actor_result>`;
        }
        default: {
            // Exhaustive — unreachable. If a new status is added to the union,
            // this assignment will fail at compile time, surfacing the gap.
            const _exhaustive: never = result.status;
            throw new Error(`unhandled subagent result status: ${_exhaustive}`);
        }
    }
}

/**
 * Format a runtime snapshot (status / cancel response):
 *
 *   actor_id: <id>
 *   status: running
 *   subagent_type: explore
 *   description: <short>
 *   turn_count: 3
 *   last_outcome: <optional>
 */
function formatSnapshot(snapshot: SubagentInstance): string {
    const lines = [
        `actor_id: ${snapshot.actorId}`,
        `status: ${snapshot.status}`,
        `subagent_type: ${snapshot.subagentType}`,
        `description: ${snapshot.description}`,
        `turn_count: ${snapshot.turnCount}`,
    ];
    if (snapshot.lastOutcome) {
        lines.push(`last_outcome: ${snapshot.lastOutcome}`);
    }
    return lines.join("\n");
}

/** Soft-error response for unknown actor_id (status/wait/cancel). */
function formatUnknown(actorId: string): string {
    return `actor_id: ${actorId}\nstatus: unknown`;
}

/**
 * Extract the first line of the assistant text, if it's short enough to be
 * a useful summary attribute. Returns `undefined` to omit the attribute.
 */
function extractSummary(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const newlineIdx = trimmed.indexOf("\n");
    const firstLine = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
    if (firstLine.length === 0 || firstLine.length > SUMMARY_MAX_LEN) return undefined;
    return firstLine;
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
