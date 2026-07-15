import type {
    Message,
    Session,
    SessionListItem,
    SessionSearchInput,
    SessionSearchResult,
    ToolCall,
} from "@shared";

export type SessionMetadataUpdates = Pick<
    Partial<Session>,
    | "summary"
    | "lastOutputPaths"
    | "favorite"
    | "tags"
    | "archived"
    | "readOnly"
    | "lastOpenedAt"
    | "usage"
    | "toolPermissions"
    | "parentSessionId"
    | "forkedFromMessageId"
    | "forkedAt"
>;

export interface SessionRepositoryStats {
    sessionCount: number;
    messageCount: number;
}

export interface SessionRepositoryHealth {
    ok: boolean;
    details: string[];
}

export interface SessionRepository {
    listSessions(): Promise<Session[]>;
    listSessionSummaries(): Promise<SessionListItem[]>;
    getSession(id: string): Promise<Session | undefined>;
    createSession(workspaceId: string, title?: string, id?: string): Promise<Session>;
    renameSession(id: string, title: string): Promise<Session>;
    deleteSession(id: string): Promise<void>;
    archiveSession(id: string, archived: boolean): Promise<Session>;
    updateSessionMetadata(id: string, updates: SessionMetadataUpdates): Promise<Session>;
    appendMessage(sessionId: string, message: Message): Promise<void>;
    updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void>;
    updateToolCall(
        sessionId: string,
        messageId: string,
        toolCallId: string,
        updates: Partial<ToolCall>,
    ): Promise<void>;
    searchSessionMessages(input: SessionSearchInput): Promise<SessionSearchResult[]>;
    getStats(): Promise<SessionRepositoryStats>;
    checkHealth(): SessionRepositoryHealth;
    close(): void;
}
