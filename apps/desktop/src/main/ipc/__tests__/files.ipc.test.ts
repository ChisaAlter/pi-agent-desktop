import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

    it("lists critical hidden files and directories through files:list", async () => {
        const workspace = makeWorkspace();
        mkdirSync(join(workspace, ".github", "workflows"), { recursive: true });
        writeFileSync(join(workspace, ".github", "workflows", "ci.yml"), "name: ci", "utf-8");
        writeFileSync(join(workspace, ".gitignore"), "dist", "utf-8");

        const handler = handlers.get("files:list")!;
        const result = await handler({}, workspace) as Array<{ path: string }>;

        expect(isIpcError(result)).toBe(false);
        expect(result.map((item) => item.path)).toContain(".github/workflows/ci.yml");
        expect(result.map((item) => item.path)).toContain(".gitignore");
    });
});
