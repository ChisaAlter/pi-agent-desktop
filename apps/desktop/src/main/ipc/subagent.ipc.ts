// Subagent IPC Handler (Phase E Task 6 SubTask 6.4)
//
// 3 request-response channels (validated by Zod in schemas.ts):
//   - subagent:list-types     → SubagentType[] (all 4 built-ins, hidden ones
//                                                  flagged via `hidden: true`)
//   - subagent:list-instances → SubagentInstance[] (live actors for `agentId`)
//   - subagent:cancel         → SubagentInstance | null (idempotent cancel)
//
// Plus the renderer subscribes to `subagent:event` (broadcast) for state
// transitions. The SubagentManager `onEvent` callback in main/index.ts wires
// each emitted `SubagentManagerEvent` to a `webContents.send("subagent:event", …)`
// — the preload exposes it as `piAPI.onSubagentEvent(cb)`.
//
// Errors return IpcError (same convention as plan.ipc / chat.ipc). No thrown
// exceptions escape the handlers.

import { ipcMain } from "electron";
import log from "electron-log/main";
import type { ZodError } from "zod";
import { ipcError, type IpcError, type SubagentInstance, type SubagentType } from "@shared";
import type { SubagentManager } from "../services/subagent/manager";
import { listAll } from "../services/subagent/registry";
import { SubagentCancelSchema, SubagentListInstancesSchema, SubagentListTypesSchema } from "./schemas";

export interface SubagentIpcDeps {
    /** SubagentManager singleton (constructed in main/index.ts). */
    subagentManager: SubagentManager;
}

function invalidInput(err: ZodError | Error): IpcError {
    return ipcError(
        "ipcErrors.subagent.invalidInput",
        `subagent 入参无效: ${err instanceof Error ? err.message : String(err)}`,
    );
}

export function setupSubagentIpc(deps: SubagentIpcDeps): void {
    // ── subagent:list-types ──────────────────────────────────────
    // Returns the full list of built-in subagent types. `hidden: true` flags
    // dream / distill (only spawnable via slash commands). The renderer can
    // show all 4 in the Subagent panel; the actor tool's enum source uses the
    // non-hidden subset separately (subagent/registry `listSpawnable`).
    ipcMain.handle("subagent:list-types", async (_event, input: unknown) => {
        try {
            SubagentListTypesSchema.parse(input ?? {});
        } catch (err) {
            log.warn("[subagent.ipc] list-types invalid input:", err);
            return invalidInput(err as ZodError);
        }
        // Return copies so callers can't mutate the frozen registry entries.
        return listAll().map((entry) => ({ ...entry })) as SubagentType[];
    });

    // ── subagent:list-instances ──────────────────────────────────
    // Returns live + terminal SubagentInstance snapshots owned by `agentId`.
    ipcMain.handle("subagent:list-instances", async (_event, input: unknown) => {
        let parsed: { agentId: string };
        try {
            parsed = SubagentListInstancesSchema.parse(input);
        } catch (err) {
            log.warn("[subagent.ipc] list-instances invalid input:", err);
            return invalidInput(err as ZodError);
        }
        try {
            const instances = deps.subagentManager.listInstances(parsed.agentId);
            // Defensive copy — SubagentInstance is mutable inside the manager
            // (turnCount / lastTurnTime update on every turn_end), so hand the
            // renderer a snapshot it can hold without aliasing concerns.
            return instances.map((inst) => ({ ...inst })) as SubagentInstance[];
        } catch (err) {
            log.error("[subagent.ipc] list-instances failed:", err);
            return ipcError(
                "ipcErrors.subagent.listFailed",
                `列出 subagent 失败: ${err instanceof Error ? err.message : String(err)}`,
                { agentId: parsed.agentId },
            );
        }
    });

    // ── subagent:cancel ──────────────────────────────────────────
    // Idempotent cancel. Returns the post-cancel snapshot (or null when the
    // actor is unknown / already terminal). The renderer treats `null` as
    // "nothing to cancel", not an error.
    ipcMain.handle("subagent:cancel", async (_event, input: unknown) => {
        let parsed: { agentId: string; actorId: string };
        try {
            parsed = SubagentCancelSchema.parse(input);
        } catch (err) {
            log.warn("[subagent.ipc] cancel invalid input:", err);
            return invalidInput(err as ZodError);
        }
        try {
            const snapshot = deps.subagentManager.cancel(parsed.agentId, parsed.actorId);
            return snapshot ? ({ ...snapshot } as SubagentInstance) : null;
        } catch (err) {
            log.error("[subagent.ipc] cancel failed:", err);
            return ipcError(
                "ipcErrors.subagent.cancelFailed",
                `取消 subagent 失败: ${err instanceof Error ? err.message : String(err)}`,
                { agentId: parsed.agentId, actorId: parsed.actorId },
            );
        }
    });
}
