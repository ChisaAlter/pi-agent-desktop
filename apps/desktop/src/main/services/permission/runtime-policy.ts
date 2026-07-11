import { DEVELOPMENT_TOOL_PERMISSIONS, type AgentMode, type ToolPermissions } from "@shared";
import {
    classifyToolName,
    isCoreTool,
    isModeRequiredTool,
    normalizeToolName,
} from "./tool-category";

const PLAN_DENIED_TOOL_NAMES = [
    "bash",
    "shell",
    "write",
    "edit",
    "apply_patch",
    "multiedit",
] as const;

export interface RuntimePolicyInput {
    mode: AgentMode;
    workspacePermissions: ToolPermissions;
    sessionPermissions?: ToolPermissions;
}

export interface RuntimeToolPolicy {
    mode: AgentMode;
    permissions: ToolPermissions;
    immutableDeniedTools: ReadonlySet<string>;
}

export type BashCommandDecision =
    | { allowed: true }
    | { allowed: false; reason: string };

export function resolveStoredToolPermissions(input: {
    sessionPermissions?: ToolPermissions;
    workspacePermissions?: ToolPermissions;
}): ToolPermissions {
    return {
        ...(input.sessionPermissions ?? input.workspacePermissions ?? DEVELOPMENT_TOOL_PERMISSIONS),
    };
}

export function resolveRuntimePolicy(input: RuntimePolicyInput): RuntimeToolPolicy {
    const selectedPermissions = input.sessionPermissions ?? input.workspacePermissions;

    return {
        mode: input.mode,
        permissions: Object.freeze({ ...selectedPermissions }),
        immutableDeniedTools: new Set(input.mode === "plan" ? PLAN_DENIED_TOOL_NAMES : []),
    };
}

export function filterActiveTools(toolNames: readonly string[], policy: RuntimeToolPolicy): string[] {
    return toolNames.filter((toolName) => {
        const normalized = normalizeToolName(toolName);
        const category = classifyToolName(normalized);

        if (policy.immutableDeniedTools.has(normalized)) return false;
        if (category === "fileRead" && !policy.permissions.fileRead) return false;
        if (category === "fileWrite" && !policy.permissions.fileWrite) return false;
        if (category === "shell" && !policy.permissions.shell) return false;
        if (category === "network" && !policy.permissions.network) return false;
        if (!policy.permissions.extensions
            && !isCoreTool(normalized)
            && !isModeRequiredTool(normalized, policy.mode)) return false;

        return true;
    });
}

export function checkBashCommand(command: string, policy: RuntimeToolPolicy): BashCommandDecision {
    if (policy.immutableDeniedTools.has("bash") || policy.immutableDeniedTools.has("shell")) {
        return { allowed: false, reason: "Shell commands are disabled in Plan mode" };
    }
    if (!policy.permissions.shell) {
        return { allowed: false, reason: "Shell commands are disabled" };
    }
    if (!policy.permissions.git && containsGitCommand(command)) {
        return { allowed: false, reason: "Git commands are disabled" };
    }
    return { allowed: true };
}

function containsGitCommand(command: string): boolean {
    return command
        .split(/\r?\n|&&|\|\||[;|]/)
        .some((segment) => isGitCommandSegment(segment));
}

function isGitCommandSegment(segment: string): boolean {
    const normalized = segment.trim().replace(/^&\s*/, "");
    if (/^git(?:\.exe)?(?=\s|$)/i.test(normalized)) return true;

    const cmdWrapped = normalized.match(/^cmd(?:\.exe)?\s+\/[ck]\s+([\s\S]+)$/i);
    if (cmdWrapped) return isGitCommandSegment(cmdWrapped[1]);

    const powerShellWrapped = normalized.match(/^(?:powershell|pwsh)(?:\.exe)?\b[\s\S]*?\s-(?:command|c)\s+([\s\S]+)$/i);
    if (!powerShellWrapped) return false;
    return isGitCommandSegment(powerShellWrapped[1].replace(/^["']|["']$/g, ""));
}
