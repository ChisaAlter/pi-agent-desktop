import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import type { Session, Workspace } from "@shared";
import { redactLogValue } from "./log-redaction";

export interface DatabaseHealth {
    ok: boolean;
    details: string[];
}

export interface DiagnosticReportInput {
    appVersion: string;
    userDataPath: string;
    logPath?: string;
    platform: NodeJS.Platform;
    versions: { electron: string; node: string; chrome: string };
    workspaces: Workspace[];
    sessions: Session[];
    databaseHealth: DatabaseHealth;
}

export interface DiagnosticReport {
    generatedAt: string;
    appVersion: string;
    platform: NodeJS.Platform;
    versions: DiagnosticReportInput["versions"];
    storageRoot: string;
    workspaces: { count: number };
    sessions: { count: number; messageCount: number };
    database: DatabaseHealth;
    recentLogs: string;
}

const MAX_LOG_BYTES = 512 * 1024;

export function buildDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
    return {
        generatedAt: new Date().toISOString(),
        appVersion: input.appVersion,
        platform: input.platform,
        versions: { ...input.versions },
        storageRoot: basename(input.userDataPath),
        workspaces: { count: input.workspaces.length },
        sessions: {
            count: input.sessions.length,
            messageCount: input.sessions.reduce((total, session) => total + session.messages.length, 0),
        },
        database: {
            ok: input.databaseHealth.ok,
            details: [...input.databaseHealth.details],
        },
        recentLogs: readRecentLogs(input.logPath),
    };
}

function readRecentLogs(logPath?: string): string {
    if (!logPath || !existsSync(logPath)) return "";
    try {
        const content = readFileSync(logPath);
        const tail = content.subarray(Math.max(0, content.length - MAX_LOG_BYTES)).toString("utf8");
        return String(redactLogValue(tail));
    } catch (error) {
        return `Unable to read logs: ${String(redactLogValue(error))}`;
    }
}
