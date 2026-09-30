import { execFile as nodeExecFile } from "node:child_process";
import { delimiter, join } from "node:path";

export type HerdrRuntimeSource = "env" | "path" | "development" | "managed";

export interface HerdrRuntimeCandidate {
    path: string;
    source: HerdrRuntimeSource;
}

export interface HerdrRuntimeInfo extends HerdrRuntimeCandidate {
    version: string;
}

export interface HerdrExecFileResult {
    stdout: string;
    stderr: string;
}

export interface HerdrExecFileOptions {
    timeout: number;
    windowsHide: boolean;
}

export type HerdrExecFile = (
    file: string,
    args: readonly string[],
    options: HerdrExecFileOptions,
) => Promise<HerdrExecFileResult>;

export interface HerdrRuntimeLocatorOptions {
    env?: Readonly<NodeJS.ProcessEnv>;
    managedDir?: string;
    candidates?: readonly HerdrRuntimeCandidate[];
    execFile?: HerdrExecFile;
    verificationTimeoutMs?: number;
    pathDelimiter?: string;
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 5_000;

export class HerdrRuntimeLocator {
    private readonly env: Readonly<NodeJS.ProcessEnv>;
    private readonly managedDir?: string;
    private readonly candidates: readonly HerdrRuntimeCandidate[];
    private readonly execFile: HerdrExecFile;
    private readonly verificationTimeoutMs: number;
    private readonly pathDelimiter: string;

    constructor(options: HerdrRuntimeLocatorOptions = {}) {
        this.env = options.env ?? process.env;
        this.managedDir = options.managedDir;
        this.candidates = options.candidates ?? [];
        this.execFile = options.execFile ?? execHerdr;
        this.verificationTimeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
        this.pathDelimiter = options.pathDelimiter ?? delimiter;
    }

    async locate(): Promise<HerdrRuntimeInfo | null> {
        for (const candidate of this.collectCandidates()) {
            const version = await this.verify(candidate.path);
            if (version) return { ...candidate, version };
        }
        return null;
    }

    private collectCandidates(): HerdrRuntimeCandidate[] {
        const result: HerdrRuntimeCandidate[] = [];
        const seen = new Set<string>();
        const add = (candidate: HerdrRuntimeCandidate): void => {
            const path = unquote(candidate.path.trim());
            if (!path) return;
            const key = process.platform === "win32" ? path.toLowerCase() : path;
            if (seen.has(key)) return;
            seen.add(key);
            result.push({ ...candidate, path });
        };

        const explicit = environmentValue(this.env, "PI_HERDR_EXECUTABLE_PATH");
        if (explicit) add({ path: explicit, source: "env" });

        const pathValue = environmentValue(this.env, "PATH");
        for (const entry of pathValue?.split(this.pathDelimiter) ?? []) {
            const directory = unquote(entry.trim());
            if (directory) add({ path: join(directory, "herdr.exe"), source: "path" });
        }

        for (const candidate of this.candidates) add(candidate);
        if (this.managedDir) {
            add({ path: join(this.managedDir, "herdr.exe"), source: "managed" });
        }
        return result;
    }

    private async verify(path: string): Promise<string | null> {
        try {
            const result = await this.execFile(path, ["--version"], {
                timeout: this.verificationTimeoutMs,
                windowsHide: true,
            });
            return parseHerdrVersion(`${result.stdout}\n${result.stderr}`);
        } catch {
            return null;
        }
    }
}

export function parseHerdrVersion(output: string): string | null {
    const match = output.match(/^\s*herdr\s+([^\s]+)\s*$/im);
    return match?.[1] ?? null;
}

function execHerdr(
    file: string,
    args: readonly string[],
    options: HerdrExecFileOptions,
): Promise<HerdrExecFileResult> {
    return new Promise((resolve, reject) => {
        nodeExecFile(file, [...args], {
            encoding: "utf8",
            timeout: options.timeout,
            windowsHide: options.windowsHide,
        }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        });
    });
}

function environmentValue(env: Readonly<NodeJS.ProcessEnv>, name: string): string | undefined {
    const exact = env[name];
    if (exact !== undefined) return exact;
    const matchingKey = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
    return matchingKey ? env[matchingKey] : undefined;
}

function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    return value;
}
