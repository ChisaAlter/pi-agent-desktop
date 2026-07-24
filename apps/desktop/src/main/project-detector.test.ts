import { mkdirSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject } from "./project-detector";

let root: string | null = null;

function makeRoot(): string {
    root = join(tmpdir(), `pi-project-detector-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    return root;
}

afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
});

describe("detectProject", () => {
    it("detects Node projects, package manager, metadata and scripts", () => {
        const dir = makeRoot();
        mkdirSync(join(dir, ".git"));
        writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9.0");
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            name: "pi-workbench",
            version: "1.2.3",
            scripts: {
                test: "vitest",
                build: "tsc",
                ignored: 42,
            },
        }));

        expect(detectProject(dir)).toMatchObject({
            type: "node",
            name: "pi-workbench",
            version: "1.2.3",
            packageManager: "pnpm",
            hasGit: true,
            scripts: {
                test: "vitest",
                build: "tsc",
            },
        });
    });

    it("detects Python projects from pyproject and requirements", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "pyproject.toml"), "[project]\nname = \"demo\"");
        writeFileSync(join(dir, "requirements.txt"), "pytest\n");

        const result = detectProject(dir);

        expect(result.type).toBe("python");
        expect(result.packageManager).toBe("pip");
        expect(result.configFiles).toEqual(expect.arrayContaining(["pyproject.toml", "requirements.txt"]));
    });

    it("detects Rust project metadata from Cargo.toml", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "Cargo.toml"), "[package]\nname = \"pi-core\"\nversion = \"0.4.0\"\n[dependencies]\n");

        expect(detectProject(dir)).toMatchObject({
            type: "rust",
            name: "pi-core",
            version: "0.4.0",
            packageManager: "cargo",
        });
    });

    it("detects Go module names", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "go.mod"), "module github.com/acme/pi-agent\n\ngo 1.22\n");

        expect(detectProject(dir)).toMatchObject({
            type: "go",
            name: "pi-agent",
            packageManager: "go",
        });
    });

    it("detects Java build files and falls back for unknown projects", () => {
        const javaDir = makeRoot();
        writeFileSync(join(javaDir, "pom.xml"), "<project />");

        expect(detectProject(javaDir)).toMatchObject({
            type: "java",
            packageManager: undefined,
        });

        rmSync(javaDir, { recursive: true, force: true });
        root = null;
        const unknownDir = makeRoot();

        expect(detectProject(unknownDir)).toMatchObject({
            type: "unknown",
            configFiles: [],
            hasGit: false,
        });
    });

    // wave-115 residual
    it("prefers pnpm over yarn/npm lockfiles and yarn over npm", () => {
        const yarnDir = makeRoot();
        writeFileSync(join(yarnDir, "package.json"), JSON.stringify({ name: "y" }));
        writeFileSync(join(yarnDir, "yarn.lock"), "");
        writeFileSync(join(yarnDir, "package-lock.json"), "");
        expect(detectProject(yarnDir).packageManager).toBe("yarn");

        rmSync(yarnDir, { recursive: true, force: true });
        root = null;
        const npmDir = makeRoot();
        writeFileSync(join(npmDir, "package.json"), JSON.stringify({ name: "n" }));
        writeFileSync(join(npmDir, "package-lock.json"), "{}");
        expect(detectProject(npmDir).packageManager).toBe("npm");
    });

    it("falls back to directory basename when package name is blank and ignores non-string scripts", () => {
        const dir = makeRoot();
        writeFileSync(
            join(dir, "package.json"),
            JSON.stringify({
                name: "   ",
                version: 1,
                scripts: { ok: "echo", bad: null, num: 3 },
            }),
        );
        const result = detectProject(dir);
        expect(result.name).toBe(basename(dir));
        expect(result.version).toBeUndefined();
        expect(result.scripts).toEqual({ ok: "echo" });
    });

    it("detects bun lockfile and java gradle kotlin build", () => {
        const bunDir = makeRoot();
        writeFileSync(join(bunDir, "package.json"), JSON.stringify({ name: "bun-app" }));
        writeFileSync(join(bunDir, "bun.lockb"), "");
        expect(detectProject(bunDir)).toMatchObject({ type: "node", packageManager: "bun", name: "bun-app" });

        rmSync(bunDir, { recursive: true, force: true });
        root = null;
        const gradleDir = makeRoot();
        writeFileSync(join(gradleDir, "build.gradle.kts"), "plugins {}");
        expect(detectProject(gradleDir).type).toBe("java");
    });

    it("ignores package.json content when project type is not node", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "rs"\nversion = "1.0.0"\n');
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "should-not-win", version: "9.9.9" }));
        // package.json presence forces node type (detectType order)
        expect(detectProject(dir).type).toBe("node");
        expect(detectProject(dir).name).toBe("should-not-win");
    });

    // wave-123 residual
    it("parses Cargo.toml only from the [package] section and falls back on missing name", () => {
        const dir = makeRoot();
        writeFileSync(
            join(dir, "Cargo.toml"),
            [
                "[workspace]",
                'name = "workspace-name"',
                'version = "9.9.9"',
                "",
                "[package]",
                'name = "real-crate"',
                'version = "0.1.2"',
                "",
                "[dependencies]",
                'name = "dep-name"',
                'version = "1.0.0"',
                "",
            ].join("\n"),
        );
        expect(detectProject(dir)).toMatchObject({
            type: "rust",
            name: "real-crate",
            version: "0.1.2",
            packageManager: "cargo",
        });

        rmSync(dir, { recursive: true, force: true });
        root = null;
        const bare = makeRoot();
        writeFileSync(join(bare, "Cargo.toml"), "[dependencies]\nserde = \"1\"\n");
        const bareResult = detectProject(bare);
        expect(bareResult.type).toBe("rust");
        expect(bareResult.name).toBe(basename(bare));
        expect(bareResult.version).toBeUndefined();
    });

    it("detects python via Pipfile alone and go module basename edge", () => {
        const pyDir = makeRoot();
        writeFileSync(join(pyDir, "Pipfile"), "[[source]]\n");
        expect(detectProject(pyDir)).toMatchObject({
            type: "python",
            packageManager: "pip",
            configFiles: ["Pipfile"],
        });

        rmSync(pyDir, { recursive: true, force: true });
        root = null;
        const goDir = makeRoot();
        writeFileSync(join(goDir, "go.mod"), "module example.com/org/tool\n");
        expect(detectProject(goDir)).toMatchObject({
            type: "go",
            name: "tool",
            packageManager: "go",
        });
    });

    it("prefers pnpm when pnpm/yarn/npm lockfiles all exist", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mixed" }));
        writeFileSync(join(dir, "pnpm-lock.yaml"), "");
        writeFileSync(join(dir, "yarn.lock"), "");
        writeFileSync(join(dir, "package-lock.json"), "{}");
        expect(detectProject(dir).packageManager).toBe("pnpm");
    });


    // wave-292 residual
    it("unknown workspace yields basename name, no packageManager, hasGit when .git exists", () => {
        const dir = makeRoot();
        const info = detectProject(dir);
        expect(info.type).toBe("unknown");
        expect(info.name).toBe(basename(dir));
        expect(info.packageManager).toBeUndefined();
        expect(info.scripts).toBeUndefined();
        expect(info.version).toBeUndefined();
        expect(info.configFiles).toEqual([]);
        expect(info.hasGit).toBe(false);

        // git marker
        mkdirSync(join(dir, ".git"));
        expect(detectProject(dir).hasGit).toBe(true);
    });

    it("node scripts filter non-string values; empty name falls back to basename", () => {
        const dir = makeRoot();
        writeFileSync(
            join(dir, "package.json"),
            JSON.stringify({
                name: "  ",
                version: "1.2.3",
                scripts: { test: "vitest", bad: 1, ok: "echo" },
            }),
        );
        writeFileSync(join(dir, "yarn.lock"), "");
        const info = detectProject(dir);
        expect(info.type).toBe("node");
        expect(info.name).toBe(basename(dir));
        expect(info.version).toBe("1.2.3");
        expect(info.packageManager).toBe("yarn");
        expect(info.scripts).toEqual({ test: "vitest", ok: "echo" });
        expect(info.configFiles).toEqual(expect.arrayContaining(["package.json", "yarn.lock"]));
    });


    // wave-295 residual
    it("detects python via requirements/pyproject with pip packageManager", () => {
        const py = makeRoot();
        writeFileSync(join(py, "requirements.txt"), "requests==2");
        const pyInfo = detectProject(py);
        expect(pyInfo.type).toBe("python");
        expect(pyInfo.packageManager).toBe("pip");
        expect(pyInfo.configFiles).toEqual(expect.arrayContaining(["requirements.txt"]));

        const py2 = makeRoot();
        writeFileSync(join(py2, "pyproject.toml"), "[project]\nname='x'\n");
        expect(detectProject(py2).type).toBe("python");
        expect(detectProject(py2).packageManager).toBe("pip");
        expect(detectProject(py2).configFiles).toEqual(expect.arrayContaining(["pyproject.toml"]));
    });

    it("detects rust via Cargo.toml with cargo packageManager; go via go.mod", () => {
        const rs = makeRoot();
        writeFileSync(join(rs, "Cargo.toml"), '[package]\nname = "crate-x"\nversion = "0.1.0"\n');
        const rsInfo = detectProject(rs);
        expect(rsInfo.type).toBe("rust");
        expect(rsInfo.packageManager).toBe("cargo");
        expect(rsInfo.name).toBe("crate-x");
        expect(rsInfo.version).toBe("0.1.0");
        expect(rsInfo.configFiles).toEqual(expect.arrayContaining(["Cargo.toml"]));

        const goDir = makeRoot();
        writeFileSync(join(goDir, "go.mod"), "module example.com/x\n");
        mkdirSync(join(goDir, ".git"));
        const goInfo = detectProject(goDir);
        expect(goInfo.type).toBe("go");
        expect(goInfo.packageManager).toBe("go");
        expect(goInfo.hasGit).toBe(true);
        expect(goInfo.name).toBe("x"); // basename of module path
        expect(goInfo.configFiles).toEqual(expect.arrayContaining(["go.mod"]));
    });

    it("prefers node over other markers when package.json present; bun.lockb selects bun", () => {
        const dir = makeRoot();
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", scripts: { start: "node ." } }));
        writeFileSync(join(dir, "requirements.txt"), "x");
        writeFileSync(join(dir, "bun.lockb"), "");
        const info = detectProject(dir);
        expect(info.type).toBe("node");
        expect(info.packageManager).toBe("bun");
        expect(info.scripts).toEqual({ start: "node ." });
    });

});

// wave-304 residual
describe("detectProject residual (wave-304)", () => {
  it("java via pom.xml/build.gradle; packageManager undefined; unknown empty root", () => {
    const pom = makeRoot();
    writeFileSync(join(pom, "pom.xml"), "<project/>");
    const pomInfo = detectProject(pom);
    expect(pomInfo.type).toBe("java");
    expect(pomInfo.packageManager).toBeUndefined();
    expect(pomInfo.name).toBe(basename(pom));
    expect(pomInfo.configFiles).toEqual(expect.arrayContaining(["pom.xml"]));

    const gradle = makeRoot();
    writeFileSync(join(gradle, "build.gradle.kts"), "plugins {}");
    expect(detectProject(gradle).type).toBe("java");
    expect(detectProject(gradle).packageManager).toBeUndefined();

    const empty = makeRoot();
    const unknown = detectProject(empty);
    expect(unknown.type).toBe("unknown");
    expect(unknown.packageManager).toBeUndefined();
    expect(unknown.hasGit).toBe(false);
    expect(unknown.scripts).toBeUndefined();
    expect(unknown.name).toBe(basename(empty));
  });

  it("package.json empty name falls back to basename; non-string scripts dropped; yarn.lock selects yarn", () => {
    const dir = makeRoot();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "   ",
        version: 1,
        scripts: { ok: "node .", bad: 1, nested: { x: 1 } },
      }),
    );
    writeFileSync(join(dir, "yarn.lock"), "");
    const info = detectProject(dir);
    expect(info.type).toBe("node");
    expect(info.packageManager).toBe("yarn");
    expect(info.name).toBe(basename(dir));
    expect(info.version).toBeUndefined();
    expect(info.scripts).toEqual({ ok: "node ." });
  });

  it("Cargo.toml only first [package] table; later tables ignored; go.mod basename of module path", () => {
    const rs = makeRoot();
    const cargo = [
      "[workspace]",
      'members = ["crates/*"]',
      "[package]",
      'name = "real-crate"',
      'version = "1.2.3" # comment',
      "[dependencies]",
      'name = "not-package"',
      'version = "9.9.9"',
    ].join("\n");
    writeFileSync(join(rs, "Cargo.toml"), cargo);
    const info = detectProject(rs);
    expect(info.type).toBe("rust");
    expect(info.name).toBe("real-crate");
    expect(info.version).toBe("1.2.3");
    expect(info.packageManager).toBe("cargo");

    const goDir = makeRoot();
    writeFileSync(join(goDir, "go.mod"), "module github.com/acme/widget\ngo 1.22\n");
    expect(detectProject(goDir).name).toBe("widget");
  });
});

// wave-319 residual
describe("detectProject residual (wave-319)", () => {
  it("prefers node package.json over rust/python markers; lockfile selects packageManager", () => {
    const dir = makeRoot();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", version: "0.1.0" }));
    writeFileSync(
      join(dir, "Cargo.toml"),
      ["[package]", 'name = "rs"', 'version = "1.0.0"', ""].join(String.fromCharCode(10)),
    );
    writeFileSync(join(dir, "requirements.txt"), "x");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    const info = detectProject(dir);
    expect(info.type).toBe("node");
    expect(info.packageManager).toBe("pnpm");
    expect(info.name).toBe("app");
    expect(info.version).toBe("0.1.0");
  });

  it("python via Pipfile/pyproject; rust cargo; go module basename; java no packageManager", () => {
    const py = makeRoot();
    writeFileSync(join(py, "Pipfile"), "[[source]]" + String.fromCharCode(10));
    expect(detectProject(py)).toMatchObject({ type: "python", packageManager: "pip" });

    const rs = makeRoot();
    writeFileSync(
      join(rs, "Cargo.toml"),
      ["[package]", 'name = "crate"', 'version = "2.0.0"', ""].join(String.fromCharCode(10)),
    );
    expect(detectProject(rs)).toMatchObject({
      type: "rust",
      packageManager: "cargo",
      name: "crate",
      version: "2.0.0",
    });

    const goDir = makeRoot();
    writeFileSync(
      join(goDir, "go.mod"),
      ["module example.com/foo/bar", "go 1.22", ""].join(String.fromCharCode(10)),
    );
    expect(detectProject(goDir)).toMatchObject({ type: "go", packageManager: "go", name: "bar" });

    const java = makeRoot();
    writeFileSync(join(java, "build.gradle"), "plugins {}" + String.fromCharCode(10));
    const j = detectProject(java);
    expect(j.type).toBe("java");
    expect(j.packageManager).toBeUndefined();
  });

  it("unknown empty root uses basename; hasGit when .git exists; non-string scripts dropped", () => {
    const empty = makeRoot();
    const u = detectProject(empty);
    expect(u.type).toBe("unknown");
    expect(u.name).toBe(basename(empty));
    expect(u.hasGit).toBe(false);

    const gitDir = makeRoot();
    mkdirSync(join(gitDir, ".git"));
    expect(detectProject(gitDir).hasGit).toBe(true);

    const node = makeRoot();
    writeFileSync(
      join(node, "package.json"),
      JSON.stringify({ name: "n", scripts: { ok: "node .", bad: 3, nested: { a: 1 } } }),
    );
    writeFileSync(join(node, "package-lock.json"), "{}");
    const info = detectProject(node);
    expect(info.packageManager).toBe("npm");
    expect(info.scripts).toEqual({ ok: "node ." });
  });
});

