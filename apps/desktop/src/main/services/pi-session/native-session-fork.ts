import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Message as DesktopMessage } from "@shared";
import { loadPiSdk } from "./sdk-runtime";

export interface NativeSessionForkInput {
    sourcePath: string;
    targetPath: string;
    targetCwd: string;
    messages: DesktopMessage[];
    fromMessageId?: string;
    provider?: string;
    model?: string;
}

export async function forkNativeSession(input: NativeSessionForkInput): Promise<void> {
    const sdk = await loadPiSdk();
    const targetPath = resolve(input.targetPath);
    const targetDir = dirname(targetPath);
    mkdirSync(targetDir, { recursive: true });
    if (existsSync(targetPath)) {
        throw new Error(`目标 Pi 会话文件已存在: ${targetPath}`);
    }

    if (!existsSync(input.sourcePath)) {
        createNativeSessionFromDesktopHistory(sdk.SessionManager, input, targetDir, targetPath);
        return;
    }

    const sourcePath = resolve(input.sourcePath);
    if (input.fromMessageId) {
        const source = sdk.SessionManager.open(sourcePath);
        const leafId = findNativeLeafForDesktopMessage(source.getBranch(), input.messages, input.fromMessageId);
        const branchedPath = source.createBranchedSession(leafId);
        if (!branchedPath) throw new Error("无法创建 Pi 分支会话文件");
        moveGeneratedSession(branchedPath, targetPath);
        return;
    }

    const forked = sdk.SessionManager.forkFrom(sourcePath, input.targetCwd, targetDir);
    moveGeneratedSession(forked.getSessionFile(), targetPath);
}

type SessionManagerConstructor = Awaited<ReturnType<typeof loadPiSdk>>["SessionManager"];

function createNativeSessionFromDesktopHistory(
    SessionManager: SessionManagerConstructor,
    input: NativeSessionForkInput,
    targetDir: string,
    targetPath: string,
): void {
    const manager = SessionManager.create(input.targetCwd, targetDir);
    const selected = selectDesktopMessages(input.messages, input.fromMessageId);
    for (const message of selected) {
        if (message.role === "user") {
            manager.appendMessage({
                role: "user",
                content: message.content,
                timestamp: toTimestamp(message.timestamp),
            });
            continue;
        }
        if (message.role === "assistant") {
            manager.appendMessage({
                role: "assistant",
                content: [{ type: "text", text: message.content }],
                api: "openai-completions",
                provider: input.provider || "pi-desktop-import",
                model: input.model || "imported-history",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: "stop",
                timestamp: toTimestamp(message.timestamp),
            });
        }
    }
    if (selected.length === 0) manager.appendSessionInfo("Pi Desktop continued session");
    moveGeneratedSession(manager.getSessionFile(), targetPath);
}

export function selectDesktopMessages(messages: DesktopMessage[], fromMessageId?: string): DesktopMessage[] {
    if (!fromMessageId) return messages;
    const index = messages.findIndex((message) => message.id === fromMessageId);
    if (index < 0) throw new Error(`找不到分叉消息: ${fromMessageId}`);
    return messages.slice(0, index + 1);
}

function findNativeLeafForDesktopMessage(
    branch: Array<{ id: string; type: string; message?: unknown }>,
    desktopMessages: DesktopMessage[],
    fromMessageId: string,
): string {
    const selected = selectDesktopMessages(desktopMessages, fromMessageId)
        .filter((message) => message.role === "user" || message.role === "assistant");
    let desktopIndex = 0;
    let leafId: string | undefined;

    for (const entry of branch) {
        if (entry.type !== "message" || !entry.message || desktopIndex >= selected.length) continue;
        const native = entry.message as { role?: unknown; content?: unknown };
        const desktop = selected[desktopIndex];
        if (native.role !== desktop.role) continue;
        if (normalizeText(native.content) !== normalizeText(desktop.content)) continue;
        leafId = entry.id;
        desktopIndex += 1;
    }

    if (!leafId || desktopIndex !== selected.length) {
        throw new Error("Desktop 消息与 Pi 原生会话树无法对应，不能安全分叉");
    }
    return leafId;
}

export function normalizeText(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
        .flatMap((part) => {
            if (!part || typeof part !== "object") return [];
            const record = part as { type?: unknown; text?: unknown };
            return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
        })
        .join("")
        .trim();
}

export function toTimestamp(value: DesktopMessage["timestamp"]): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function moveGeneratedSession(generatedPath: string | undefined, targetPath: string): void {
    if (!generatedPath) throw new Error("Pi 没有生成可持久化的会话文件");
    const resolvedGenerated = resolve(generatedPath);
    if (resolvedGenerated === targetPath) return;
    renameSync(resolvedGenerated, targetPath);
}
