import { realpath } from "fs/promises";
import { resolve } from "path";
import {
    createBashToolDefinition,
    createEditToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createLsToolDefinition,
    createReadToolDefinition,
    createWriteToolDefinition,
    type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { getProtectedPathReason } from "../protected-paths";
import { resolveCanonicalTarget } from "../path-canonical";
import { checkBashCommand, type RuntimeToolPolicy } from "./runtime-policy";
import { classifyToolName } from "./tool-category";

export interface RuntimePolicyController {
    getPolicy: () => RuntimeToolPolicy;
    setPolicy: (policy: RuntimeToolPolicy) => void;
}

export function createRuntimePolicyController(initialPolicy: RuntimeToolPolicy): RuntimePolicyController {
    let currentPolicy = initialPolicy;
    return {
        getPolicy: () => currentPolicy,
        setPolicy: (policy) => {
            currentPolicy = policy;
        },
    };
}

export function createGuardedBuiltins(
    cwd: string,
    getPolicy: () => RuntimeToolPolicy,
): ToolDefinition[] {
    const canonicalWorkspace = realpath(cwd);
    const definitions = [
        guardPathTool(createReadToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardPathTool(createGrepToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardPathTool(createFindToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardPathTool(createLsToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardPathTool(createWriteToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardPathTool(createEditToolDefinition(cwd), cwd, canonicalWorkspace, getPolicy),
        guardBashTool(createBashToolDefinition(cwd), getPolicy),
    ];
    return definitions as unknown as ToolDefinition[];
}

function guardPathTool<TParams extends TSchema, TDetails, TState>(
    definition: ToolDefinition<TParams, TDetails, TState>,
    cwd: string,
    canonicalWorkspace: Promise<string>,
    getPolicy: () => RuntimeToolPolicy,
): ToolDefinition<TParams, TDetails, TState> {
    return replaceExecute(definition, async (params) => {
        assertToolPermission(definition.name, getPolicy());
        const inputPath = getStringProperty(params, "path");
        if (!inputPath) return;

        const lexicalTarget = resolve(cwd, inputPath);
        const lexicalReason = getProtectedPathReason(lexicalTarget, cwd);
        if (lexicalReason) {
            throw new Error(`${definition.label} denied for path "${inputPath}": ${lexicalReason}`);
        }

        const canonicalRoot = await canonicalWorkspace;
        const canonicalTarget = await resolveCanonicalTarget(lexicalTarget);
        const reason = getProtectedPathReason(canonicalTarget, canonicalRoot);
        if (reason) {
            throw new Error(`${definition.label} denied for path "${inputPath}": ${reason}`);
        }
    });
}

function guardBashTool<TParams extends TSchema, TDetails, TState>(
    definition: ToolDefinition<TParams, TDetails, TState>,
    getPolicy: () => RuntimeToolPolicy,
): ToolDefinition<TParams, TDetails, TState> {
    return replaceExecute(definition, (params) => {
        const command = getStringProperty(params, "command") ?? "";
        const decision = checkBashCommand(command, getPolicy());
        if (!decision.allowed) {
            throw new Error(`${definition.label} denied: ${decision.reason}`);
        }
    });
}

function replaceExecute<TParams extends TSchema, TDetails, TState>(
    definition: ToolDefinition<TParams, TDetails, TState>,
    beforeExecute: (params: unknown) => void | Promise<void>,
): ToolDefinition<TParams, TDetails, TState> {
    const originalExecute = definition.execute.bind(definition);
    return {
        ...definition,
        execute: async (toolCallId, params, signal, onUpdate, ctx) => {
            await beforeExecute(params);
            return originalExecute(toolCallId, params, signal, onUpdate, ctx);
        },
    };
}

function assertToolPermission(toolName: string, policy: RuntimeToolPolicy): void {
    const category = classifyToolName(toolName);
    if (policy.immutableDeniedTools.has(toolName)) {
        throw new Error(`${toolName} denied: this tool is disabled in ${policy.mode} mode`);
    }
    if (category === "fileRead" && !policy.permissions.fileRead) {
        throw new Error(`${toolName} denied: file read permission is disabled`);
    }
    if (category === "fileWrite" && !policy.permissions.fileWrite) {
        throw new Error(`${toolName} denied: file write permission is disabled`);
    }
}

function getStringProperty(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const property = Reflect.get(value, key);
    return typeof property === "string" ? property : undefined;
}
