import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { buildFileTree, buildFileTreeAsync } from "./file-tree";

let root: string | null = null;

function makeRoot(): string {
    root = join(tmpdir(), `pi-file-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    return root;
}

afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
});

describe("buildFileTree", () => {
    it("recursively returns files while ignoring noisy generated directories", () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = {};");
        writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");

        const tree = buildFileTree(dir, { maxDepth: 4 });

        expect(tree.type).toBe("directory");
        expect(tree.children?.some((child) => child.name === "src")).toBe(true);
        expect(tree.children?.some((child) => child.name === "node_modules")).toBe(false);
        expect(tree.children?.some((child) => child.name === ".git")).toBe(false);
        const src = tree.children?.find((child) => child.name === "src");
        expect(src?.children?.[0]).toMatchObject({
            name: "app.ts",
            type: "file",
            extension: "ts",
        });
    });

    it("marks deep directories as truncated when maxDepth is reached", () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "a", "b"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "deep.txt"), "deep");

        const tree = buildFileTree(dir, { maxDepth: 1 });
        const a = tree.children?.find((child) => child.name === "a");

        expect(a?.type).toBe("directory");
        expect(a?.truncated).toBe(true);
        expect(a?.children).toEqual([]);
    });

    it("omits protected credential files and directories from the tree", () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, ".ssh"), { recursive: true });
        mkdirSync(join(dir, ".kube"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, ".env.local"), "TOKEN=secret");
        writeFileSync(join(dir, ".ssh", "id_ed25519"), "secret");
        writeFileSync(join(dir, ".kube", "config"), "secret");

        const tree = buildFileTree(dir, { maxDepth: 4 });
        const names = tree.children?.map((child) => child.name) ?? [];
        const src = tree.children?.find((child) => child.name === "src");

        expect(names).toContain("src");
        expect(src?.children?.some((child) => child.name === "app.ts")).toBe(true);
        expect(names).not.toContain(".env.local");
        expect(names).not.toContain(".ssh");
        expect(names).not.toContain(".kube");
    });

    it("has an async builder with the same ignore behavior", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");

        const tree = await buildFileTreeAsync(dir, { maxDepth: 4 });

        expect(tree.type).toBe("directory");
        expect(tree.children?.some((child) => child.name === "src")).toBe(true);
        expect(tree.children?.some((child) => child.name === ".git")).toBe(false);
    });
});
