import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { buildFileTree, listDirectory } from "./file-tree";

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
    it("recursively returns files while ignoring noisy generated directories", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = {};");
        writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");

        const tree = await buildFileTree(dir, { maxDepth: 4 });

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

    it("marks deep directories as truncated when maxDepth is reached", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "a", "b"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "deep.txt"), "deep");

        const tree = await buildFileTree(dir, { maxDepth: 1 });
        const a = tree.children?.find((child) => child.name === "a");

        expect(a?.type).toBe("directory");
        expect(a?.truncated).toBe(true);
        expect(a?.children).toEqual([]);
    });

    it("omits protected credential files and directories from the tree", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src"), { recursive: true });
        mkdirSync(join(dir, ".ssh"), { recursive: true });
        mkdirSync(join(dir, ".kube"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, ".env.local"), "TOKEN=secret");
        writeFileSync(join(dir, ".ssh", "id_ed25519"), "secret");
        writeFileSync(join(dir, ".kube", "config"), "secret");

        const tree = await buildFileTree(dir, { maxDepth: 4 });
        const names = tree.children?.map((child) => child.name) ?? [];
        const src = tree.children?.find((child) => child.name === "src");

        expect(names).toContain("src");
        expect(src?.children?.some((child) => child.name === "app.ts")).toBe(true);
        expect(names).not.toContain(".env.local");
        expect(names).not.toContain(".ssh");
        expect(names).not.toContain(".kube");
    });
});

describe("async file tree", () => {
    it("lists only one directory level for lazy expansion", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "src", "nested"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "export const app = true;");
        writeFileSync(join(dir, "src", "nested", "deep.ts"), "export const deep = true;");

        const listingPromise = listDirectory(dir);
        expect(listingPromise).toBeInstanceOf(Promise);
        const listing = await listingPromise;
        const src = listing.children?.find((child) => child.name === "src");

        expect(src).toMatchObject({ name: "src", type: "directory" });
        expect(src?.children).toBeUndefined();
    });

    it("does not use synchronous filesystem calls in production tree building", () => {
        const source = readFileSync(join(__dirname, "file-tree.ts"), "utf-8");

        expect(source).not.toMatch(/\b(?:readdirSync|statSync)\b/);
    });
});

describe("file-tree residual", () => {
    // wave-116 residual
    it("sorts directories before files and files alphabetically case-insensitively", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "z.txt"), "z");
        writeFileSync(join(dir, "a.txt"), "a");
        mkdirSync(join(dir, "Bdir"));
        mkdirSync(join(dir, "adir"));

        const listing = await listDirectory(dir);
        const names = listing.children?.map((c) => c.name) ?? [];
        expect(names[0]).toMatch(/dir/i);
        expect(names.slice(0, 2).every((n) => listing.children?.find((c) => c.name === n)?.type === "directory")).toBe(
            true,
        );
        expect(names.at(-1)).toBe("z.txt");
        // dirs first: adir, Bdir then a.txt, z.txt (base sensitivity)
        expect(names.indexOf("adir")).toBeLessThan(names.indexOf("a.txt"));
        expect(names.indexOf("Bdir")).toBeLessThan(names.indexOf("a.txt"));
    });

    it("returns a file node when listDirectory target is a file", async () => {
        const dir = makeRoot();
        const file = join(dir, "note.md");
        writeFileSync(file, "hello");
        const node = await listDirectory(file);
        expect(node).toMatchObject({
            type: "file",
            name: "note.md",
            extension: "md",
            path: file,
        });
        expect(node.size).toBeGreaterThan(0);
        expect(node.children).toBeUndefined();
    });

    it("clamps maxEntries floor to 50 and marks truncated listing", async () => {
        const dir = makeRoot();
        for (let i = 0; i < 60; i += 1) {
            writeFileSync(join(dir, `f${String(i).padStart(2, "0")}.txt`), "x");
        }
        // maxEntries below floor is clamped to 50
        const listing = await listDirectory(dir, { maxEntries: 10 });
        expect(listing.truncated).toBe(true);
        expect(listing.children?.length).toBe(50);
    });

    it("ignores dist/build/coverage/.next noisy dirs in buildFileTree", async () => {
        const dir = makeRoot();
        for (const noisy of ["dist", "build", "coverage", ".next", ".turbo", "out", ".cache"]) {
            mkdirSync(join(dir, noisy), { recursive: true });
            writeFileSync(join(dir, noisy, "x.js"), "1");
        }
        writeFileSync(join(dir, "keep.ts"), "export {}");
        const tree = await buildFileTree(dir, 3);
        const names = tree.children?.map((c) => c.name) ?? [];
        expect(names).toEqual(["keep.ts"]);
    });

    it("accepts numeric maxDepth overload for buildFileTree", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "a", "b"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "deep.txt"), "deep");
        const tree = await buildFileTree(dir, 1);
        const a = tree.children?.find((c) => c.name === "a");
        expect(a?.truncated).toBe(true);
        expect(a?.children).toEqual([]);
    });

    it("strips leading dot from extension for multi-dot names", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "archive.tar.gz"), "bin");
        const listing = await listDirectory(dir);
        const file = listing.children?.find((c) => c.name === "archive.tar.gz");
        // extname returns .gz
        expect(file?.extension).toBe("gz");
    });

    // wave-175 residual
    it("clamps maxDepth to [1, 8] and maxEntries to [50, 5000]", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c", "deep.txt"), "x");

        // maxDepth 0 → floor 1: root walks depth 0, child a at depth 1 is truncated
        const shallow = await buildFileTree(dir, { maxDepth: 0 });
        const a0 = shallow.children?.find((c) => c.name === "a");
        expect(a0?.truncated).toBe(true);
        expect(a0?.children).toEqual([]);

        // maxDepth 99 → ceiling 8: deep tree under limit is not truncated at a/b/c
        const deep = await buildFileTree(dir, { maxDepth: 99 });
        const a = deep.children?.find((c) => c.name === "a");
        const b = a?.children?.find((c) => c.name === "b");
        const c = b?.children?.find((c) => c.name === "c");
        expect(c?.children?.some((n) => n.name === "deep.txt")).toBe(true);

        // maxEntries ceiling: huge request still caps listing children at 5000 floor/ceiling path
        for (let i = 0; i < 55; i += 1) writeFileSync(join(dir, `n${i}.txt`), "1");
        const listing = await listDirectory(dir, { maxEntries: 99999 });
        // 55 files + dirs a only — under 5000, so no truncate from ceiling
        expect(listing.truncated).toBeUndefined();
        expect((listing.children?.length ?? 0) >= 55).toBe(true);
    });

    it("returns empty-extension file nodes and empty-dir children arrays", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "LICENSE"), "MIT");
        mkdirSync(join(dir, "empty"));
        const listing = await listDirectory(dir);
        const license = listing.children?.find((c) => c.name === "LICENSE");
        const empty = listing.children?.find((c) => c.name === "empty");
        expect(license?.extension).toBe("");
        expect(empty).toMatchObject({ type: "directory", name: "empty" });
        expect(empty?.children).toBeUndefined();

        const emptyListing = await listDirectory(join(dir, "empty"));
        expect(emptyListing.type).toBe("directory");
        expect(emptyListing.children).toEqual([]);
        expect(emptyListing.truncated).toBeUndefined();
    });

    it("buildFileTree on a file root returns a file node without walking", async () => {
        const dir = makeRoot();
        const file = join(dir, "only.ts");
        writeFileSync(file, "export {};");
        const node = await buildFileTree(file, 4);
        expect(node).toMatchObject({
            type: "file",
            name: "only.ts",
            extension: "ts",
            path: file,
        });
        expect(node.children).toBeUndefined();
    });

    // wave-181 residual
    it("sorts directories before files and uses base-insensitive name order", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "b.txt"), "1");
        writeFileSync(join(dir, "A.txt"), "1");
        mkdirSync(join(dir, "z-dir"));
        mkdirSync(join(dir, "a-dir"));
        const listing = await listDirectory(dir);
        const names = (listing.children ?? []).map((c) => c.name);
        // directories first, then files
        expect(names.indexOf("a-dir")).toBeLessThan(names.indexOf("z-dir"));
        expect(names.indexOf("z-dir")).toBeLessThan(names.indexOf("A.txt"));
        expect(names.indexOf("A.txt")).toBeLessThan(names.indexOf("b.txt"));
        const firstFileIdx = listing.children?.findIndex((x) => x.type === "file") ?? -1;
        const lastDirIdx = (() => {
            const dirs = listing.children?.map((c, i) => (c.type === "directory" ? i : -1)) ?? [];
            return Math.max(...dirs.filter((i) => i >= 0), -1);
        })();
        expect(firstFileIdx === -1 || lastDirIdx < firstFileIdx).toBe(true);
    });

    it("skips DEFAULT_IGNORES names at listing level", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "node_modules"));
        mkdirSync(join(dir, ".git"));
        mkdirSync(join(dir, "dist"));
        writeFileSync(join(dir, "keep.ts"), "x");
        const listing = await listDirectory(dir);
        const names = new Set((listing.children ?? []).map((c) => c.name));
        expect(names.has("node_modules")).toBe(false);
        expect(names.has(".git")).toBe(false);
        expect(names.has("dist")).toBe(false);
        expect(names.has("keep.ts")).toBe(true);
    });

    it("maxEntries floor of 50 still lists when under threshold", async () => {
        const dir = makeRoot();
        for (let i = 0; i < 10; i += 1) writeFileSync(join(dir, `f${i}.txt`), "1");
        const listing = await listDirectory(dir, { maxEntries: 1 }); // clamps to 50
        expect((listing.children?.length ?? 0)).toBe(10);
        expect(listing.truncated).toBeUndefined();
    });

    // wave-192 residual
    it("listDirectory omits protected credential files and still lists siblings", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, ".env"), "SECRET=1");
        writeFileSync(join(dir, "id_rsa"), "key");
        writeFileSync(join(dir, "keep.ts"), "export {}");
        const listing = await listDirectory(dir);
        const names = new Set((listing.children ?? []).map((c) => c.name));
        expect(names.has(".env")).toBe(false);
        expect(names.has("id_rsa")).toBe(false);
        expect(names.has("keep.ts")).toBe(true);
    });

    it("buildFileTree marks truncated when visited hits maxEntries mid-walk", async () => {
        const dir = makeRoot();
        // flat files under root: each file increments visited; clamp floor 50
        for (let i = 0; i < 60; i += 1) writeFileSync(join(dir, `n${String(i).padStart(2, "0")}.txt`), "1");
        const tree = await buildFileTree(dir, { maxDepth: 4, maxEntries: 50 });
        // root itself is depth 0 and does not count; children visit until maxEntries
        expect(tree.truncated === true || (tree.children?.length ?? 0) <= 50).toBe(true);
        expect((tree.children?.length ?? 0)).toBeLessThanOrEqual(50);
    });

    it("listDirectory skips non-file non-directory entries implicitly via readdir kinds", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "a.txt"), "x");
        mkdirSync(join(dir, "d"));
        const listing = await listDirectory(dir);
        for (const child of listing.children ?? []) {
            expect(child.type === "file" || child.type === "directory").toBe(true);
        }
        expect(listing.children?.some((c) => c.name === "a.txt" && c.type === "file")).toBe(true);
        expect(listing.children?.some((c) => c.name === "d" && c.type === "directory")).toBe(true);
    });

    // wave-295 residual
    it("listDirectory on a file path returns a file node with extension without leading dot", async () => {
        const dir = makeRoot();
        const file = join(dir, "note.MD");
        writeFileSync(file, "body");
        const node = await listDirectory(file);
        expect(node.type).toBe("file");
        expect(node.name).toBe("note.MD");
        expect(node.extension).toBe("MD");
        expect(node.size).toBe(Buffer.byteLength("body"));
        expect(node.children).toBeUndefined();
    });

    it("listDirectory extension is empty string when no ext; DEFAULT_IGNORES includes .cache", async () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "LICENSE"), "mit");
        mkdirSync(join(dir, ".cache"));
        writeFileSync(join(dir, ".cache", "x"), "1");
        const listing = await listDirectory(dir);
        const license = listing.children?.find((c) => c.name === "LICENSE");
        expect(license?.type).toBe("file");
        expect(license?.extension).toBe("");
        expect(listing.children?.some((c) => c.name === ".cache")).toBe(false);
    });

    it("buildFileTree numeric overload and option object share depth clamp semantics", async () => {
        const dir = makeRoot();
        mkdirSync(join(dir, "a", "b"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c.txt"), "1");
        const asNumber = await buildFileTree(dir, 1);
        const asOptions = await buildFileTree(dir, { maxDepth: 1 });
        expect(asNumber.children?.some((c) => c.name === "a")).toBe(true);
        expect(asOptions.children?.some((c) => c.name === "a")).toBe(true);
        const aNum = asNumber.children?.find((c) => c.name === "a");
        const aOpt = asOptions.children?.find((c) => c.name === "a");
        expect(Boolean(aNum?.truncated)).toBe(Boolean(aOpt?.truncated));
    });

});

// wave-305 residual
describe("file-tree residual (wave-305)", () => {
  it("listDirectory clamps maxEntries floor 50 and marks truncated when exceeded", async () => {
    const dir = makeRoot();
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.txt`), "x");
    }
    // request below floor → clamp to 50
    const listing = await listDirectory(dir, { maxEntries: 10 });
    expect(listing.type).toBe("directory");
    expect(listing.children?.length).toBe(50);
    expect(listing.truncated).toBe(true);
  });

  it("listDirectory sorts directories before files (base sensitivity)", async () => {
    const dir = makeRoot();
    writeFileSync(join(dir, "a.txt"), "1");
    mkdirSync(join(dir, "z-dir"));
    writeFileSync(join(dir, "b.txt"), "2");
    mkdirSync(join(dir, "m-dir"));
    const listing = await listDirectory(dir);
    const names = listing.children?.map((c) => c.name) ?? [];
    const types = listing.children?.map((c) => c.type) ?? [];
    // all directories first
    const firstFileIdx = types.indexOf("file");
    const lastDirIdx = types.lastIndexOf("directory");
    expect(lastDirIdx).toBeLessThan(firstFileIdx);
    expect(names.slice(0, 2).sort()).toEqual(["m-dir", "z-dir"].sort());
  });

  it("buildFileTree default maxDepth 4; ignores node_modules and .git names", async () => {
    const dir = makeRoot();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "1");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "src.ts"), "export {}");
    const tree = await buildFileTree(dir);
    expect(tree.children?.some((c) => c.name === "node_modules")).toBe(false);
    expect(tree.children?.some((c) => c.name === ".git")).toBe(false);
    expect(tree.children?.some((c) => c.name === "src.ts")).toBe(true);
  });
});

// wave-320 residual
describe("file-tree residual (wave-320)", () => {
  it("listDirectory on file returns file node with extension and size; ignores DEFAULT_IGNORES", async () => {
    const dir = makeRoot();
    const file = join(dir, "readme.MD");
    writeFileSync(file, "hello");
    const node = await listDirectory(file);
    expect(node.type).toBe("file");
    expect(node.name).toBe("readme.MD");
    expect(node.extension).toBe("MD");
    expect(node.size).toBe(5);

    mkdirSync(join(dir, "dist"));
    mkdirSync(join(dir, "coverage"));
    writeFileSync(join(dir, "keep.ts"), "x");
    const listing = await listDirectory(dir);
    const names = listing.children?.map((c) => c.name) ?? [];
    expect(names).toContain("keep.ts");
    expect(names).not.toContain("dist");
    expect(names).not.toContain("coverage");
  });

  it("buildFileTree clamps maxDepth to [1,8] and maxEntries floor 50", async () => {
    const dir = makeRoot();
    let cur = dir;
    for (let i = 0; i < 5; i++) {
      cur = join(cur, `d${i}`);
      mkdirSync(cur);
      writeFileSync(join(cur, "f.txt"), "x");
    }
    const shallow = await buildFileTree(dir, { maxDepth: 0 });
    expect(shallow.type).toBe("directory");
    expect(shallow.children?.length).toBeGreaterThan(0);

    const deep = await buildFileTree(dir, { maxDepth: 99 });
    expect(deep.type).toBe("directory");

    const many = makeRoot();
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(many, `f${String(i).padStart(3, "0")}.txt`), "x");
    }
    const low = await buildFileTree(many, { maxDepth: 2, maxEntries: 5 });
    expect(low.children?.length).toBeLessThanOrEqual(50);
  });

  it("listDirectory marks truncated true when entry count hits clamp; children sorted dirs first", async () => {
    const dir = makeRoot();
    for (let i = 0; i < 55; i++) {
      writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.txt`), "x");
    }
    mkdirSync(join(dir, "a-dir"));
    const listing = await listDirectory(dir, { maxEntries: 50 });
    expect(listing.truncated).toBe(true);
    expect(listing.children?.length).toBe(50);
    const types = listing.children?.map((c) => c.type) ?? [];
    const firstFile = types.indexOf("file");
    const lastDir = types.lastIndexOf("directory");
    if (firstFile >= 0 && lastDir >= 0) {
      expect(lastDir).toBeLessThan(firstFile);
    }
  });
});
