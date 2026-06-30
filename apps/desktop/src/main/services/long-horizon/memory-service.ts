import { join } from "path";
import type { LongHorizonMemoryRecord } from "@shared";
import {
    LongHorizonDatabase,
    type HistoryMessageInput,
    type MemoryInput as DatabaseMemoryInput,
    type MemorySearchOptions,
    type RecentMemoryOptions,
} from "./database";

export type MemoryScope = DatabaseMemoryInput["scope"];
export type MemoryKind = DatabaseMemoryInput["kind"];
export type MemoryRecord = LongHorizonMemoryRecord;
export type MemoryInput = DatabaseMemoryInput;
export type MemorySearchResult = MemoryRecord & { score: number };

export interface MemoryTreeNode {
    record: MemoryRecord;
    children: MemoryTreeNode[];
}

interface DatabaseTreeNode {
    record: MemoryRecord;
    children: DatabaseTreeNode[];
}

export class MemoryService {
    private readonly database: LongHorizonDatabase;
    private readonly migrationPromise: Promise<void>;

    constructor(opts: { rootDir: string }) {
        this.database = new LongHorizonDatabase(opts.rootDir);
        this.migrationPromise = this.database.migrateLegacyMemoryJsonl(join(opts.rootDir, "memory.jsonl"));
    }

    async ready(): Promise<void> {
        await this.migrationPromise;
    }

    async put(input: MemoryInput): Promise<MemoryRecord> {
        return this.database.insertMemory(input);
    }

    async putHistory(input: { workspaceId?: string; sessionId?: string; text: string; tags?: string[] }): Promise<MemoryRecord> {
        return this.put({
            scope: input.sessionId ? "session" : "project",
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            kind: "history",
            text: input.text,
            tags: input.tags,
        });
    }

    async indexHistoryMessage(input: HistoryMessageInput): Promise<MemoryRecord | null> {
        return this.database.upsertHistoryMessage(input);
    }

    async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
        const records = await this.database.searchMemories(query, options);
        return records.map((record) => ({
            ...record,
            score: record.score ?? 0,
        }));
    }

    async listRecent(options: RecentMemoryOptions = {}): Promise<MemoryRecord[]> {
        return this.database.listRecentMemories(options);
    }

    async getTree(rootId: string): Promise<MemoryTreeNode | null> {
        const tree = await this.database.getMemoryTree(rootId) as DatabaseTreeNode | null;
        return tree ? normalizeTree(tree) : null;
    }

    getDatabase(): LongHorizonDatabase {
        return this.database;
    }

    async close(): Promise<void> {
        await this.database.close();
    }
}

function normalizeTree(node: DatabaseTreeNode): MemoryTreeNode {
    return {
        record: node.record,
        children: node.children.map(normalizeTree),
    };
}
