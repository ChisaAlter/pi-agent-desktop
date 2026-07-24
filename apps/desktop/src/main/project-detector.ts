import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";

export interface ProjectInfo {
    type: "node" | "python" | "rust" | "go" | "java" | "unknown";
    name: string;
    version?: string;
    rootPath: string;
    configFiles: string[];
    packageManager?: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "cargo" | "go";
    hasGit: boolean;
    scripts?: Record<string, string>;
}

const CONFIG_FILES = [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "bun.lockb",
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
];

function readJsonFile(path: string): Record<string, unknown> | null {
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function readTextFile(path: string): string | null {
    try {
        return readFileSync(path, "utf-8");
    } catch {
        return null;
    }
}

function parsePackageJson(workspacePath: string): Pick<ProjectInfo, "name" | "version" | "scripts"> | null {
    const pkg = readJsonFile(join(workspacePath, "package.json"));
    if (!pkg) return null;
    const scripts = pkg.scripts && typeof pkg.scripts === "object"
        ? Object.fromEntries(
            Object.entries(pkg.scripts as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
        : undefined;
    return {
        name: typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : basename(workspacePath),
        version: typeof pkg.version === "string" ? pkg.version : undefined,
        scripts,
    };
}

function parseCargoToml(workspacePath: string): Pick<ProjectInfo, "name" | "version"> | null {
    const text = readTextFile(join(workspacePath, "Cargo.toml"));
    if (!text) return null;
    // Line-scan the [package] table only. The previous slice/search logic re-matched
    // the same [package] header when it was mid-file (rest.slice(1).search(/^\[/)).
    const lines = text.split(/\r?\n/);
    let inPackage = false;
    let name: string | undefined;
    let version: string | undefined;
    for (const line of lines) {
        if (/^\s*\[/.test(line)) {
            inPackage = /^\s*\[package\]\s*$/.test(line);
            continue;
        }
        if (!inPackage) continue;
        const nameMatch = line.match(/^\s*name\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
        if (nameMatch) name = nameMatch[1];
        const versionMatch = line.match(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
        if (versionMatch) version = versionMatch[1];
    }
    return {
        name: name && name.trim() ? name : basename(workspacePath),
        version,
    };
}

function parseGoMod(workspacePath: string): Pick<ProjectInfo, "name"> | null {
    const text = readTextFile(join(workspacePath, "go.mod"));
    if (!text) return null;
    const moduleName = text.match(/^\s*module\s+(\S+)/m)?.[1];
    return {
        name: moduleName ? basename(moduleName) : basename(workspacePath),
    };
}

function packageManagerFor(configFiles: Set<string>, type: ProjectInfo["type"]): ProjectInfo["packageManager"] | undefined {
    if (type === "node") {
        if (configFiles.has("pnpm-lock.yaml")) return "pnpm";
        if (configFiles.has("yarn.lock")) return "yarn";
        if (configFiles.has("bun.lockb")) return "bun";
        return "npm";
    }
    if (type === "python") return "pip";
    if (type === "rust") return "cargo";
    if (type === "go") return "go";
    return undefined;
}

function detectType(configFiles: Set<string>): ProjectInfo["type"] {
    if (configFiles.has("package.json")) return "node";
    if (configFiles.has("pyproject.toml") || configFiles.has("requirements.txt") || configFiles.has("Pipfile")) return "python";
    if (configFiles.has("Cargo.toml")) return "rust";
    if (configFiles.has("go.mod")) return "go";
    if (configFiles.has("pom.xml") || configFiles.has("build.gradle") || configFiles.has("build.gradle.kts")) return "java";
    return "unknown";
}

export function detectProject(workspacePath: string): ProjectInfo {
    const configFiles = CONFIG_FILES.filter((file) => existsSync(join(workspacePath, file)));
    const configSet = new Set(configFiles);
    const type = detectType(configSet);
    const packageJson = type === "node" ? parsePackageJson(workspacePath) : null;
    const cargo = type === "rust" ? parseCargoToml(workspacePath) : null;
    const go = type === "go" ? parseGoMod(workspacePath) : null;
    const fallbackName = basename(workspacePath) || "unknown";

    return {
        type,
        name: packageJson?.name ?? cargo?.name ?? go?.name ?? fallbackName,
        version: packageJson?.version ?? cargo?.version,
        rootPath: workspacePath,
        configFiles,
        packageManager: packageManagerFor(configSet, type),
        hasGit: existsSync(join(workspacePath, ".git")),
        scripts: packageJson?.scripts,
    };
}
