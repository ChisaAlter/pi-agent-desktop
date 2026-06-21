import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export type MemoryScope = "project" | "session" | "global";
export type MemoryKind = "note" | "checkpoint" | "task-progress" | "summary";

export interface MemoryRecord {
    id: string;
    scope: MemoryScope;
    kind: MemoryKind;
    text: string;
    workspaceId?: string;
    sessionId?: string;
    tags?: string[];
    createdAt: number;
}

export type MemoryInput = Omit<MemoryRecord, "id" | "createdAt">;

export interface MemorySearchOptions {
    workspaceId?: string;
    sessionId?: string;
    limit?: number;
}

export type MemorySearchResult = MemoryRecord & { score: number };

export class MemoryService {
    private readonly records: MemoryRecord[] = [];
    private readonly index = new Map<string, Set<string>>();
    private readonly recordsById = new Map<string, MemoryRecord>();
    private readonly jsonlPath: string;

    constructor(opts: { rootDir: string }) {
        mkdirSync(opts.rootDir, { recursive: true });
        this.jsonlPath = join(opts.rootDir, "memory.jsonl");
        this.load();
    }

    put(input: MemoryInput): MemoryRecord {
        const record: MemoryRecord = {
            ...input,
            id: randomUUID(),
            createdAt: Date.now(),
        };
        this.addToMemory(record);
        appendFileSync(this.jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
        return record;
    }

    search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
        const terms = tokenize(query);
        if (terms.length === 0) return [];
        const scores = new Map<string, number>();
        for (const term of terms) {
            for (const id of this.index.get(term) ?? []) {
                scores.set(id, (scores.get(id) ?? 0) + 1);
            }
        }
        return [...scores.entries()]
            .map(([id, score]) => ({ ...this.recordsById.get(id)!, score }))
            .filter((record) => matchesScope(record, options))
            .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
            .slice(0, options.limit ?? 8);
    }

    private load(): void {
        if (!existsSync(this.jsonlPath)) return;
        const content = readFileSync(this.jsonlPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
                this.addToMemory(JSON.parse(line) as MemoryRecord);
            } catch {
                // Skip corrupted mirror lines; later writes keep appending valid records.
            }
        }
    }

    private addToMemory(record: MemoryRecord): void {
        this.records.push(record);
        this.recordsById.set(record.id, record);
        for (const token of tokenize(`${record.text} ${(record.tags ?? []).join(" ")}`)) {
            const bucket = this.index.get(token) ?? new Set<string>();
            bucket.add(record.id);
            this.index.set(token, bucket);
        }
    }
}

function matchesScope(record: MemoryRecord, options: MemorySearchOptions): boolean {
    if (record.scope === "global") return true;
    if (options.workspaceId && record.workspaceId && record.workspaceId !== options.workspaceId) return false;
    if (options.sessionId && record.sessionId && record.sessionId !== options.sessionId) return false;
    return true;
}

function tokenize(value: string): string[] {
    const normalized = value.toLowerCase();
    const ascii = normalized.match(/[a-z0-9_-]{2,}/g) ?? [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    const cjkBigrams = cjk.flatMap((chunk) => {
        const result: string[] = [chunk];
        for (let i = 0; i < chunk.length - 1; i += 1) result.push(chunk.slice(i, i + 2));
        return result;
    });
    return [...new Set([...ascii, ...cjkBigrams])];
}
