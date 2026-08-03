import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChildAgentRunInput, ChildAgentRunResult } from "./types.ts";

type JsonObject = Record<string, unknown>;

const MAX_OUTPUT_CHARS = 256 * 1024;
const SAFE_CHILD_ENV_KEYS = [
    "APPDATA", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "NODE_PATH",
    "OS", "PATH", "Path", "PATHEXT", "PI_CODING_AGENT_DIR", "PROGRAMDATA", "PROGRAMFILES",
    "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
];

function childEnvironment(childAgentDir?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of SAFE_CHILD_ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    if (childAgentDir) env.PI_CODING_AGENT_DIR = childAgentDir;
    return env;
}

function appendBounded(current: string, chunk: string): string {
    if (current.length >= MAX_OUTPUT_CHARS) return current;
    const remaining = MAX_OUTPUT_CHARS - current.length;
    return current + chunk.slice(0, remaining);
}

function piCommand(): string {
    return process.platform === "win32" ? "pi.cmd" : "pi";
}

function windowsNpmBinPath(): string {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm");
}

function findCommandOnPath(commandName: string): string | undefined {
    const pathValue = process.env.PATH ?? process.env.Path ?? "";
    const entries = pathValue.split(";").map((entry) => entry.trim()).filter(Boolean);
    for (const entry of entries) {
        const candidate = join(entry, commandName);
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

function resolveWindowsPiShim(): string | undefined {
    return findCommandOnPath("pi.cmd") ?? (() => {
        const candidate = join(windowsNpmBinPath(), "pi.cmd");
        return existsSync(candidate) ? candidate : undefined;
    })();
}

function resolveWindowsPiCliJs(piShim?: string): string | undefined {
    if (piShim) {
        const localCandidate = join(dirname(piShim), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
        return existsSync(localCandidate) ? localCandidate : undefined;
    }

    const globalCandidate = join(
        windowsNpmBinPath(),
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
    );
    return existsSync(globalCandidate) ? globalCandidate : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): JsonObject | undefined {
    if (!existsSync(path)) return undefined;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return isJsonObject(parsed) ? parsed : undefined;
    } catch (error) {
        if (error instanceof Error) return undefined;
        throw error;
    }
}

function resolveSourceAgentDir(): string {
    const configured = process.env.PI_CODING_AGENT_DIR?.trim();
    return configured || join(homedir(), ".pi", "agent");
}

function readProviderApiKey(auth: JsonObject, provider: string): string | undefined {
    const value = auth[provider];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (!isJsonObject(value)) return undefined;
    const apiKey = value.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
    const key = value.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

function createChildAgentDir(provider?: string): string | undefined {
    const providerId = provider?.trim();
    if (!providerId) return undefined;

    const sourceAgentDir = resolveSourceAgentDir();
    const models = readJsonObject(join(sourceAgentDir, "models.json"));
    const auth = readJsonObject(join(sourceAgentDir, "auth.json"));
    if (!models || !auth) return undefined;

    const providers = models.providers;
    if (!isJsonObject(providers)) return undefined;
    const providerConfig = providers[providerId];
    if (!isJsonObject(providerConfig)) return undefined;
    if (typeof providerConfig.apiKey === "string" && providerConfig.apiKey.trim()) return undefined;

    const apiKey = readProviderApiKey(auth, providerId);
    if (!apiKey) return undefined;

    const childAgentDir = mkdtempSync(join(tmpdir(), "pi-desktop-compose-child-agent-"));
    const childModels: JsonObject = {
        ...models,
        providers: {
            ...providers,
            [providerId]: {
                ...providerConfig,
                apiKey,
            },
        },
    };
    writeFileSync(join(childAgentDir, "models.json"), JSON.stringify(childModels, null, 2), "utf8");
    writeFileSync(join(childAgentDir, "auth.json"), JSON.stringify(auth, null, 2), "utf8");
    const settingsPath = join(sourceAgentDir, "settings.json");
    if (existsSync(settingsPath)) {
        writeFileSync(join(childAgentDir, "settings.json"), readFileSync(settingsPath, "utf8"), "utf8");
    }
    return childAgentDir;
}

function childAgentCommand(input: ChildAgentRunInput): {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
    stdinText: string;
} {
    const baseArgs = ["-p", "--no-session"];
    if (input.provider?.trim()) {
        baseArgs.push("--provider", input.provider.trim());
    }
    if (input.modelId?.trim()) {
        baseArgs.push("--model", input.modelId.trim());
    }

    if (process.platform === "win32") {
        const piShim = resolveWindowsPiShim();
        const cliJs = resolveWindowsPiCliJs(piShim);
        if (cliJs) {
            return {
                command: "node",
                args: [cliJs, ...baseArgs],
                stdinText: input.prompt,
            };
        }

        return {
            command: process.env.ComSpec?.trim() || "cmd.exe",
            args: ["/d", "/s", "/c", piShim ?? piCommand(), ...baseArgs],
            stdinText: input.prompt,
        };
    }

    return {
        command: piCommand(),
        args: baseArgs,
        stdinText: input.prompt,
    };
}

export async function runChildAgent(input: ChildAgentRunInput): Promise<ChildAgentRunResult> {
    const startedAt = Date.now();

    if (input.signal?.aborted) {
        return {
            ok: false,
            label: input.label,
            cwd: input.cwd,
            stdout: "",
            stderr: "aborted before spawn",
            exitCode: -1,
            durationMs: Date.now() - startedAt,
            text: "aborted before spawn",
        };
    }

    const childAgentDir = createChildAgentDir(input.provider);
    const { command, args, windowsVerbatimArguments, stdinText } = childAgentCommand(input);

    return new Promise<ChildAgentRunResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        let timeoutId: NodeJS.Timeout | undefined;
        let child: ReturnType<typeof spawn> | undefined;
        let pendingKill = false;

        const abort = () => {
            pendingKill = true;
            try { child?.kill(); } catch { /* process may already be dead */ }
        };

        if (input.signal) {
            if (input.signal.aborted) {
                pendingKill = true;
            } else {
                input.signal.addEventListener("abort", abort, { once: true });
            }
        }

        const finish = (exitCode: number | null) => {
            if (finished) return;
            finished = true;
            if (input.signal) {
                input.signal.removeEventListener("abort", abort);
            }
            if (timeoutId) clearTimeout(timeoutId);
            if (childAgentDir) {
                rmSync(childAgentDir, { recursive: true, force: true });
            }
            const text = stdout.trim() || stderr.trim();
            resolve({
                ok: exitCode === 0,
                label: input.label,
                cwd: input.cwd,
                stdout,
                stderr,
                exitCode,
                durationMs: Date.now() - startedAt,
                text,
            });
        };

        try {
            child = spawn(command, args, {
                cwd: input.cwd,
                shell: false,
                env: childEnvironment(childAgentDir),
                windowsVerbatimArguments,
            });
        } catch (error) {
            stderr = appendBounded(stderr, `${error instanceof Error ? error.message : String(error)}\n`);
            finish(1);
            return;
        }

        if (pendingKill) {
            try { child.kill(); } catch { /* process may already be dead */ }
        }

        child.stdin?.on("error", (error) => {
            const msg = error instanceof Error ? error.message : String(error);
            stderr += `${msg}\n`;
            console.warn(`child-agent stdin error: ${msg}`);
            try { child.kill(); } catch { /* process may already be dead */ }
            finish(1);
        });
        child.stdout?.on("data", (chunk: Buffer | string) => {
            const text = chunk.toString();
            stdout = appendBounded(stdout, text);
            for (const line of text.split(/\r?\n/).filter(Boolean)) {
                input.onStdoutLine?.(line);
            }
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
            stderr = appendBounded(stderr, chunk.toString());
        });
        child.on("error", (error) => {
            stderr = appendBounded(stderr, `${error instanceof Error ? error.message : String(error)}\n`);
            finish(1);
        });
        child.on("close", (exitCode) => finish(exitCode));
        child.stdin?.end(stdinText);

        if (input.timeoutMs && input.timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                stderr = appendBounded(stderr, `Timed out after ${input.timeoutMs}ms\n`);
                abort();
            }, input.timeoutMs);
        }
    });
}
