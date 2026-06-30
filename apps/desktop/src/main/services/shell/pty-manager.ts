// PtyManager
// Real PTY management via node-pty (replaces child_process.spawn)
// Supports resize, TUI apps, and ANSI colors

import type { IPty } from "node-pty";
import { homedir, platform } from "os";
import log from "electron-log/main";

export interface PtyOptions {
    id: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
}

export interface PtyEntry {
    id: string;
    pty: IPty;
    cwd: string;
    createdAt: number;
    title: string;
}

export type PtyOutputListener = (id: string, data: string) => void;
export type PtyExitListener = (id: string, code: number | null) => void;

let _ipc: {
    emit: (channel: string, payload: unknown) => void;
} | null = null;

/** 设 IPC 发射器 (避免直接依赖 electron 在 main module 里, 方便测试) */
export function setIpcEmitter(emitter: typeof _ipc): void {
    _ipc = emitter;
}

function defaultShell(): { name: string; args: string[] } {
    if (platform() === "win32") {
        return { name: "powershell.exe", args: [] };
    }
    return { name: process.env.SHELL || "/bin/bash", args: [] };
}

/** PTY 管理器 (单例, 全局共享) */
export class PtyManager {
    private map = new Map<string, PtyEntry>();
    private outputListeners = new Set<PtyOutputListener>();
    private exitListeners = new Set<PtyExitListener>();
    private counter = 0;

    list(): PtyEntry[] {
        return [...this.map.values()].sort((a, b) => a.createdAt - b.createdAt);
    }

    get(id: string): PtyEntry | undefined {
        return this.map.get(id);
    }

    has(id: string): boolean {
        return this.map.has(id);
    }

    size(): number {
        return this.map.size;
    }

    generateId(): string {
        this.counter += 1;
        return `pty_${Date.now()}_${this.counter}`;
    }

    async create(opts: PtyOptions): Promise<PtyEntry> {
        if (this.map.has(opts.id)) {
            throw new Error(`Pty with id "${opts.id}" already exists`);
        }
        // 动态 import node-pty (它是 native module, 在测试环境可能没编译)
        const ptyModule = await import("node-pty");
        const { name, args } = defaultShell();
        const cwd = opts.cwd ?? homedir();
        const cols = opts.cols ?? 80;
        const rows = opts.rows ?? 24;

        // 过滤敏感环境变量，防止泄露到子进程
        const { ELECTRON_RUN_AS_NODE, ELECTRON_NO_ASAR, NODE_OPTIONS, ...safeEnv } = process.env;
        const pty = ptyModule.spawn(name, args, {
            name: "xterm-256color",
            cols,
            rows,
            cwd,
            env: { ...safeEnv, ...(opts.env ?? {}) } as Record<string, string>,
        });

        const entry: PtyEntry = {
            id: opts.id,
            pty,
            cwd,
            createdAt: Date.now(),
            title: opts.id,
        };

        this.map.set(opts.id, entry);

        pty.onData((data) => {
            this.outputListeners.forEach((l) => l(opts.id, data));
        });

        pty.onExit(({ exitCode }) => {
            this.map.delete(opts.id);
            this.exitListeners.forEach((l) => l(opts.id, exitCode));
        });

        return entry;
    }

    write(id: string, data: string): void {
        const entry = this.map.get(id);
        if (!entry) {
            throw new Error(`Pty "${id}" does not exist`);
        }
        try {
            entry.pty.write(data);
        } catch (err) {
            log.error(`[PtyManager] write error for ${id}:`, err);
            throw err;
        }
    }

    resize(id: string, cols: number, rows: number): void {
        const entry = this.map.get(id);
        if (!entry) {
            throw new Error(`Pty "${id}" does not exist`);
        }
        try {
            entry.pty.resize(cols, rows);
        } catch (err) {
            log.error(`[PtyManager] resize error for ${id}:`, err);
            throw err;
        }
    }

    close(id: string): void {
        const entry = this.map.get(id);
        if (entry) {
            try {
                entry.pty.kill();
            } catch (err) {
                log.error(`[PtyManager] close error for ${id}:`, err);
            }
            this.map.delete(id);
        }
    }

    closeAll(): void {
        for (const id of [...this.map.keys()]) {
            this.close(id);
        }
    }

    onOutput(listener: PtyOutputListener): () => void {
        this.outputListeners.add(listener);
        return () => this.outputListeners.delete(listener);
    }

    onExit(listener: PtyExitListener): () => void {
        this.exitListeners.add(listener);
        return () => this.exitListeners.delete(listener);
    }
}

export const ptyManager = new PtyManager();
