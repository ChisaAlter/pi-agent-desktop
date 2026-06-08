import { createHash } from "crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import type {
    CodexImportReport,
    CodexImportResult,
    CodexImportStatus,
    CodexSessionSummary,
} from "@shared";

interface CodexSessionImporterOpts {
    codexRoot?: string;
    piRoot?: string;
}

interface ParsedCodexSession {
    sourcePath: string;
    sourceMtime: number;
    sourceSize: number;
    meta: Record<string, unknown>;
    entries: CodexJsonlEntry[];
}

interface CodexJsonlEntry {
    type?: string;
    payload?: Record<string, unknown>;
}

export class CodexSessionImporter {
    private readonly codexRoot: string;
    private readonly piRoot: string;

    constructor(opts: CodexSessionImporterOpts = {}) {
        this.codexRoot = opts.codexRoot ?? join(homedir(), ".codex", "sessions");
        this.piRoot = opts.piRoot ?? join(homedir(), ".pi", "agent", "sessions");
    }

    async scan(projectPath: string): Promise<CodexSessionSummary[]> {
        const files = await this.collectJsonl(this.codexRoot).catch(() => []);
        const parsed = await Promise.all(files.map((file) => this.readCodexSession(file).catch(() => null)));
        const normalized = this.normalize(projectPath);
        const summaries = await Promise.all(
            parsed
                .filter((session): session is ParsedCodexSession => Boolean(session))
                .filter((session) => this.normalize(String(session.meta.cwd ?? "")) === normalized)
                .map((session) => this.toSummary(session, projectPath)),
        );
        return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async import(projectPath: string, sourcePaths: string[]): Promise<CodexImportReport> {
        const results: CodexImportResult[] = [];
        for (const sourcePath of sourcePaths) {
            results.push(await this.importOne(projectPath, sourcePath));
        }
        return {
            imported: results.filter((result) => result.success).length,
            failed: results.filter((result) => !result.success).length,
            results,
        };
    }

    private async importOne(projectPath: string, sourcePath: string): Promise<CodexImportResult> {
        try {
            const session = await this.readCodexSession(sourcePath);
            if (this.normalize(String(session.meta.cwd ?? "")) !== this.normalize(projectPath)) {
                throw new Error("Codex 会话 cwd 与当前项目不匹配");
            }
            const converted = this.convertToPiSession(projectPath, session);
            const targetPath = this.getTargetPath(projectPath, session);
            await mkdir(this.getProjectSessionDir(projectPath), { recursive: true });
            await writeFile(targetPath, converted.raw, "utf8");
            return { sourcePath, targetPath, success: true };
        } catch (error) {
            return {
                sourcePath,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async toSummary(session: ParsedCodexSession, projectPath: string): Promise<CodexSessionSummary> {
        const converted = this.convertToPiSession(projectPath, session);
        const targetPath = this.getTargetPath(projectPath, session);
        const importMeta = await this.readImportMeta(targetPath);
        const status: CodexImportStatus = !importMeta
            ? "new"
            : importMeta.sourceMtime === session.sourceMtime && importMeta.sourceSize === session.sourceSize
              ? "current"
              : "outdated";
        return {
            id: String(session.meta.id ?? session.sourcePath),
            sourcePath: session.sourcePath,
            targetPath,
            cwd: String(session.meta.cwd ?? ""),
            title: converted.title,
            createdAt: Date.parse(String(session.meta.timestamp ?? "")) || session.sourceMtime,
            updatedAt: session.sourceMtime,
            messageCount: converted.messageCount,
            sourceSize: session.sourceSize,
            importedSourceMtime: importMeta?.sourceMtime,
            status,
        };
    }

    private convertToPiSession(projectPath: string, session: ParsedCodexSession) {
        const sessionId = String(session.meta.id ?? this.hash(session.sourcePath));
        const timestamp = new Date(Date.parse(String(session.meta.timestamp ?? "")) || session.sourceMtime).toISOString();
        let sequence = 0;
        let messageCount = 0;
        const lines: string[] = [
            JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp, cwd: projectPath }),
            JSON.stringify({ sessionName: this.cleanTitle(basename(session.sourcePath)), cwd: projectPath }),
            JSON.stringify({
                type: "codex_import",
                version: 1,
                codexSessionId: sessionId,
                sourcePath: session.sourcePath,
                sourceMtime: session.sourceMtime,
                sourceSize: session.sourceSize,
                importedAt: new Date().toISOString(),
            }),
        ];

        for (const entry of session.entries) {
            const payload = entry.payload ?? {};
            if (entry.type !== "event_msg") continue;
            const text = this.extractText(payload).trim();
            if (!text) continue;
            const role = this.mapRole(String(payload.type ?? ""));
            if (!role) continue;
            messageCount += 1;
            lines.push(
                JSON.stringify({
                    id: this.makeId(sessionId, sequence++),
                    type: "message",
                    role,
                    content: [{ type: "text", text }],
                    timestamp,
                    ...(role === "assistant" ? { usage: this.zeroUsage() } : {}),
                }),
            );
        }

        return {
            title: this.cleanTitle(basename(session.sourcePath)) || "Codex 会话",
            messageCount,
            raw: lines.join("\n"),
        };
    }

    private async readCodexSession(filePath: string): Promise<ParsedCodexSession> {
        this.assertCodexSourcePath(filePath);
        const [raw, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        const entries = raw
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        const meta = entries.find((entry) => entry.type === "session_meta")?.payload;
        if (!meta?.id || !meta?.cwd) throw new Error("缺少 Codex session metadata");
        return {
            sourcePath: filePath,
            sourceMtime: info.mtimeMs,
            sourceSize: info.size,
            meta,
            entries,
        };
    }

    private async collectJsonl(dir: string): Promise<string[]> {
        const entries = await readdir(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) files.push(...(await this.collectJsonl(path)));
            else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
        }
        return files;
    }

    private async readImportMeta(targetPath: string): Promise<{ sourceMtime: number; sourceSize: number } | undefined> {
        try {
            const raw = await readFile(targetPath, "utf8");
            for (const line of raw.split(/\r?\n/)) {
                if (!line) continue;
                const entry = JSON.parse(line);
                if (entry.type === "codex_import") {
                    return { sourceMtime: entry.sourceMtime, sourceSize: entry.sourceSize };
                }
            }
        } catch {
            return undefined;
        }
        return undefined;
    }

    private assertCodexSourcePath(filePath: string): void {
        const root = this.normalize(resolve(this.codexRoot));
        const target = this.normalize(resolve(filePath));
        if (target !== root && !target.startsWith(`${root}/`)) {
            throw new Error("Codex session path is outside ~/.codex/sessions");
        }
    }

    private getTargetPath(projectPath: string, session: ParsedCodexSession): string {
        const id = String(session.meta.id ?? this.hash(session.sourcePath)).replace(/[^a-zA-Z0-9_-]/g, "-");
        return join(this.getProjectSessionDir(projectPath), `codex_${id}.jsonl`);
    }

    private getProjectSessionDir(projectPath: string): string {
        return join(this.piRoot, this.safePathToken(projectPath));
    }

    private extractText(payload: Record<string, unknown>): string {
        const content = payload.content ?? payload.summary ?? payload.text ?? payload.output;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
            return content
                .map((item) => {
                    if (typeof item === "string") return item;
                    if (item && typeof item === "object") {
                        const record = item as Record<string, unknown>;
                        return typeof record.text === "string"
                            ? record.text
                            : typeof record.content === "string"
                              ? record.content
                              : "";
                    }
                    return "";
                })
                .join("\n");
        }
        return "";
    }

    private mapRole(type: string): "user" | "assistant" | "tool" | undefined {
        if (type === "user_message") return "user";
        if (type === "assistant_message" || type === "reasoning") return "assistant";
        if (type === "tool_call" || type === "tool_result") return "tool";
        return undefined;
    }

    private zeroUsage() {
        return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    }

    private cleanTitle(value: string): string {
        return value.replace(/\.jsonl$/i, "").trim();
    }

    private makeId(sessionId: string, sequence: number): string {
        return this.hash(`${sessionId}:${sequence}`).slice(0, 12);
    }

    private safePathToken(projectPath: string): string {
        return this.hash(this.normalize(projectPath)).slice(0, 16);
    }

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }

    private normalize(value: string): string {
        return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    }
}
