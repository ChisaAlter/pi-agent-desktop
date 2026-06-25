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

    constructor(opts: { rootDir: string }) {
        this.database = new LongHorizonDatabase(opts.rootDir);
        this.database.migrateLegacyMemoryJsonl(join(opts.rootDir, "memory.jsonl"));
    }

    put(input: MemoryInput): MemoryRecord {
        return this.database.insertMemory(input);
    }

    putHistory(input: { workspaceId?: string; sessionId?: string; text: string; tags?: string[] }): MemoryRecord {
        return this.put({
            scope: input.sessionId ? "session" : "project",
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            kind: "history",
            text: input.text,
            tags: input.tags,
        });
    }

    indexHistoryMessage(input: HistoryMessageInput): MemoryRecord | null {
        return this.database.upsertHistoryMessage(input);
    }

    search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
        return this.database.searchMemories(query, options).map((record) => ({
            ...record,
            score: record.score ?? 0,
        }));
    }

    listRecent(options: RecentMemoryOptions = {}): MemoryRecord[] {
        return this.database.listRecentMemories(options);
    }

    getTree(rootId: string): MemoryTreeNode | null {
        const tree = this.database.getMemoryTree(rootId) as DatabaseTreeNode | null;
        return tree ? normalizeTree(tree) : null;
    }

    getDatabase(): LongHorizonDatabase {
        return this.database;
    }

    close(): void {
        this.database.close();
    }
}

function normalizeTree(node: DatabaseTreeNode): MemoryTreeNode {
    return {
        record: node.record,
        children: node.children.map(normalizeTree),
    };
}
