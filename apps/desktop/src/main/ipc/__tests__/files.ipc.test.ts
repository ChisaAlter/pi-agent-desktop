import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcError } from "@shared";
import { setupFilesIpc } from "../files.ipc";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        },
    },
}));

let root: string | null = null;

function makeWorkspace(): string {
    root = join(tmpdir(), `pi-files-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    return root;
}

afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
});

describe("files IPC", () => {
    beforeEach(() => {
        handlers.clear();
        setupFilesIpc();
    });

    it("writes UTF-8 text files inside the workspace", async () => {
        const workspace = makeWorkspace();
        const file = join(workspace, "note.txt");
        writeFileSync(file, "before", "utf-8");

        const handler = handlers.get("files:writeTextFile")!;
        const result = await handler({}, file, "after", workspace);

        expect(isIpcError(result)).toBe(false);
        expect(readFileSync(file, "utf-8")).toBe("after");
    });

    it("returns file mtimes and rejects stale writes", async () => {
        const workspace = makeWorkspace();
        const file = join(workspace, "note.txt");
        writeFileSync(file, "before", "utf-8");

        const readHandler = handlers.get("files:readTextFile")!;
        const writeHandler = handlers.get("files:writeTextFile")!;
        const readResult = await readHandler({}, file, workspace) as { mtimeMs?: number };

        expect(readResult.mtimeMs).toBeTypeOf("number");
        writeFileSync(file, "changed elsewhere", "utf-8");

        const writeResult = await writeHandler({}, file, "after", workspace, { expectedMtimeMs: Math.max(0, (readResult.mtimeMs ?? 10) - 10) });

        expect(isIpcError(writeResult)).toBe(true);
        if (isIpcError(writeResult)) {
            expect(writeResult.code).toBe("ipcErrors.files.writeConflict");
        }
        expect(readFileSync(file, "utf-8")).toBe("changed elsewhere");
    });

    it("blocks writes outside the workspace", async () => {
        const workspace = makeWorkspace();
        const outside = join(tmpdir(), `pi-outside-${Date.now()}.txt`);

        const handler = handlers.get("files:writeTextFile")!;
        const result = await handler({}, outside, "nope", workspace);

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.files.protectedPath");
        }
        rmSync(outside, { force: true });
    });

    // audit round 3, Task 1.5: workspacePath is now REQUIRED on both file IPC
    // channels. A renderer that omits it must be rejected at the Zod gate before
    // any filesystem access happens (closes the workspace-boundary bypass).
    it("rejects read requests that omit workspacePath", async () => {
        const readHandler = handlers.get("files:readTextFile")!;
        const result = await readHandler({}, "C:/repo/file.txt");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.files.readInvalid");
        }
    });

    it("rejects write requests that omit workspacePath", async () => {
        const writeHandler = handlers.get("files:writeTextFile")!;
        const result = await writeHandler({}, "C:/repo/file.txt", "content");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.files.writeInvalid");
        }
    });

    it("blocks legacy file listing for protected workspaces", async () => {
        const workspace = makeWorkspace();
        writeFileSync(join(workspace, ".env"), "SECRET=value", "utf-8");

        const handler = handlers.get("files:list")!;
        const result = await handler({}, join(workspace, ".env"));

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.files.protectedPath");
        }
    });

    it("returns IPC errors for invalid read and search arguments", async () => {
        const readHandler = handlers.get("files:readTextFile")!;
        const searchHandler = handlers.get("files:search")!;

        const readResult = await readHandler({}, "", "C:/repo");
        const searchResult = await searchHandler({}, "C:/repo", "");

        expect(isIpcError(readResult)).toBe(true);
        if (isIpcError(readResult)) {
            expect(readResult.code).toBe("ipcErrors.files.readInvalid");
        }
        expect(isIpcError(searchResult)).toBe(true);
        if (isIpcError(searchResult)) {
            expect(searchResult.code).toBe("ipcErrors.files.searchInvalid");
        }
    });

    it("returns IPC errors for invalid tree and list arguments", async () => {
        const treeHandler = handlers.get("files:getTree")!;
        const listHandler = handlers.get("files:list")!;

        const treeResult = await treeHandler({}, "C:/repo", { maxDepth: 99 });
        const listResult = await listHandler({}, "");

        expect(isIpcError(treeResult)).toBe(true);
        if (isIpcError(treeResult)) {
            expect(treeResult.code).toBe("ipcErrors.files.treeInvalid");
        }
        expect(isIpcError(listResult)).toBe(true);
        if (isIpcError(listResult)) {
            expect(listResult.code).toBe("ipcErrors.files.listInvalid");
        }
    });

    it("searches critical dotfiles and hidden config directories", async () => {
        const workspace = makeWorkspace();
        mkdirSync(join(workspace, ".github", "workflows"), { recursive: true });
        writeFileSync(join(workspace, ".gitignore"), "node_modules/\n", "utf-8");
        writeFileSync(join(workspace, ".github", "workflows", "ci.yml"), "name: ci\n", "utf-8");

        const searchHandler = handlers.get("files:search")!;
        const result = await searchHandler({}, workspace, ".g", { limit: 20 });

        expect(isIpcError(result)).toBe(false);
        if (!isIpcError(result)) {
            expect(result).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: ".gitignore", name: ".gitignore" }),
                expect.objectContaining({ path: ".github/workflows/ci.yml", name: "ci.yml" }),
            ]));
        }
    });

    it("returns an unloaded one-level tree for lazy directory expansion", async () => {
        const workspace = makeWorkspace();
        mkdirSync(join(workspace, "src", "nested"), { recursive: true });
        writeFileSync(join(workspace, "src", "app.ts"), "export const app = true;", "utf-8");

        const handler = handlers.get("files:getTree")!;
        const result = await handler({}, workspace, { maxDepth: 1, maxEntries: 100 });

        expect(isIpcError(result)).toBe(false);
        if (!isIpcError(result)) {
            const src = (result as { children?: Array<{ name: string; children?: unknown[] }> }).children
                ?.find((child) => child.name === "src");
            expect(src?.children).toBeUndefined();
        }
    });

    // Phase 2.1 回归: 工作区内的 symlink 指向区外文件时, read/write 必须拒绝。
    // 旧实现只用词法 isPathInside, symlink 会被当成工作区内文件放行, 导致
    // renderer 可读/写工作区之外的目标 (与 agent tools 的 realpath 校验不一致)。
    // 若当前环境无权创建 symlink (Windows 非管理员或无开发者模式), 跳过该用例。
    it("blocks reads via a symlink that escapes the workspace", async () => {
        const workspace = makeWorkspace();
        const outsideDir = join(tmpdir(), `pi-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(outsideDir, { recursive: true });
        const outsideFile = join(outsideDir, "secret.txt");
        writeFileSync(outsideFile, "SECRET", "utf-8");

        const linkPath = join(workspace, "escape.link");
        try {
            symlinkSync(outsideFile, linkPath, "file");
        } catch (err) {
            // 无权限建 symlink → 环境限制, 跳过。
            rmSync(outsideDir, { recursive: true, force: true });
            return;
        }

        try {
            const readHandler = handlers.get("files:readTextFile")!;
            const result = await readHandler({}, linkPath, workspace);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.files.protectedPath");
            }
            // 真实区外文件未被读取泄露到 content 字段。
            if (!isIpcError(result)) {
                expect((result as { content?: string }).content).not.toContain("SECRET");
            }
        } finally {
            rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    it("blocks writes via a symlink that escapes the workspace", async () => {
        const workspace = makeWorkspace();
        const outsideDir = join(tmpdir(), `pi-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(outsideDir, { recursive: true });
        const outsideFile = join(outsideDir, "target.txt");
        writeFileSync(outsideFile, "ORIGINAL", "utf-8");

        const linkPath = join(workspace, "escape-write.link");
        try {
            symlinkSync(outsideFile, linkPath, "file");
        } catch (err) {
            rmSync(outsideDir, { recursive: true, force: true });
            return;
        }

        try {
            const writeHandler = handlers.get("files:writeTextFile")!;
            const result = await writeHandler({}, linkPath, "PWNED", workspace);

            expect(isIpcError(result)).toBe(true);
            if (isIpcError(result)) {
                expect(result.code).toBe("ipcErrors.files.protectedPath");
            }
            // 区外文件内容未被覆盖。
            expect(readFileSync(outsideFile, "utf-8")).toBe("ORIGINAL");
        } finally {
            rmSync(outsideDir, { recursive: true, force: true });
        }
    });

    // 正常工作区内文件的写入/读取不应被 canonical 校验误伤。
    it("still writes and reads regular workspace files after canonical guard", async () => {
        const workspace = makeWorkspace();
        const file = join(workspace, "regular.txt");

        const writeHandler = handlers.get("files:writeTextFile")!;
        const readHandler = handlers.get("files:readTextFile")!;

        const writeResult = await writeHandler({}, file, "hello", workspace);
        expect(isIpcError(writeResult)).toBe(false);

        const readResult = await readHandler({}, file, workspace) as { content?: string };
        expect(readResult.content).toBe("hello");
    });

    // 写入一个尚不存在的新文件: canonical 校验会向上回溯到 workspace 祖先
    // 再拼接缺失段, 必须放行 (与 agent tools 行为一致)。
    it("allows writing a new file that does not yet exist", async () => {
        const workspace = makeWorkspace();
        const file = join(workspace, "brand-new.txt");
        expect(existsSync(file)).toBe(false);

        const writeHandler = handlers.get("files:writeTextFile")!;
        const result = await writeHandler({}, file, "fresh", workspace);

        expect(isIpcError(result)).toBe(false);
        expect(readFileSync(file, "utf-8")).toBe("fresh");
    });

    // wave-103 residual
    it("lists and filters workspace files", async () => {
        const workspace = makeWorkspace();
        writeFileSync(join(workspace, "alpha.ts"), "a", "utf-8");
        writeFileSync(join(workspace, "beta.md"), "b", "utf-8");
        mkdirSync(join(workspace, "src"), { recursive: true });
        writeFileSync(join(workspace, "src", "gamma.ts"), "g", "utf-8");

        const listHandler = handlers.get("files:list")!;
        const all = await listHandler({}, workspace);
        expect(isIpcError(all)).toBe(false);
        if (!isIpcError(all)) {
            const names = (all as Array<{ name: string }>).map((f) => f.name);
            expect(names).toEqual(expect.arrayContaining(["alpha.ts", "beta.md", "gamma.ts"]));
        }

        const filtered = await listHandler({}, workspace, "gamma");
        expect(isIpcError(filtered)).toBe(false);
        if (!isIpcError(filtered)) {
            expect(filtered).toEqual([
                expect.objectContaining({ name: "gamma.ts" }),
            ]);
        }
    });

    it("returns empty select results without a main window", async () => {
        const result = await handlers.get("files:select")!({}, { multiSelections: true });
        expect(result).toEqual([]);
    });

    it("returns IPC error when reading a missing file", async () => {
        const workspace = makeWorkspace();
        const missing = join(workspace, "nope.txt");
        const result = await handlers.get("files:readTextFile")!({}, missing, workspace);
        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toMatch(/ipcErrors\.files\./);
        }
    });
});
