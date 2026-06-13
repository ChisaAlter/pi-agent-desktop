import { execFile } from "child_process";
import { isAbsolute, join, relative, resolve } from "path";
import { existsSync } from "fs";
import { rm, mkdir, writeFile, readdir } from "fs/promises";

export interface SkillInfo {
    slug: string;
    name: string;
    description: string;
    version: string;
    source?: string;
}

export interface InstalledSkill {
    slug: string;
    enabled: boolean;
}

const DEFAULT_API_BASE = "https://skillhub.cn/api";

function getApiBase(): string {
    return process.env.SKILLHUB_API ?? DEFAULT_API_BASE;
}

async function fetchJson<T>(url: string, timeout = 15000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

interface SearchResponse {
    results?: Array<{
        slug?: string;
        name?: string;
        description?: string;
        version?: string;
        source?: string;
    }>;
}

export async function searchSkills(query: string, limit = 20): Promise<SkillInfo[]> {
    const url = `${getApiBase()}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const data = await fetchJson<SearchResponse>(url);
    if (!data.results || !Array.isArray(data.results)) return [];
    return data.results.map((r) => ({
        slug: r.slug ?? "",
        name: r.name ?? "",
        description: r.description ?? "",
        version: r.version ?? "0.0.0",
        source: r.source,
    }));
}

export async function listInstalled(workspacePath: string): Promise<string[]> {
    const skillsDir = join(workspacePath, ".agents", "skills");
    if (!existsSync(skillsDir)) return [];
    try {
        const entries = await readdir(skillsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
        return [];
    }
}

interface InstallResponse {
    downloadUrl?: string;
    error?: string;
}

function isPathInside(parent: string, child: string): boolean {
    const root = resolve(parent);
    const target = resolve(child);
    const rel = relative(root, target);
    return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertSafeSkillTarget(skillsDir: string, targetDir: string): void {
    if (!isPathInside(skillsDir, targetDir)) {
        throw new Error("Skill install target escapes skills directory");
    }
}

export function isSafeTarEntry(entry: string): boolean {
    const normalized = entry.replace(/\\/g, "/").trim();
    if (!normalized) return true;
    if (normalized.startsWith("/") || normalized.startsWith("~")) return false;
    if (/^[a-zA-Z]:/.test(normalized)) return false;
    return normalized.split("/").every((part) => part !== "..");
}

async function execTar(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile("tar", args, {
            cwd,
            timeout: 30000,
        }, (err, stdout) => {
            if (err) reject(err);
            else resolve(String(stdout ?? ""));
        });
    });
}

export async function installSkill(slug: string, cwd: string): Promise<void> {
    const skillsDir = join(cwd, ".agents", "skills");
    await mkdir(skillsDir, { recursive: true });

    const targetDir = join(skillsDir, slug);
    assertSafeSkillTarget(skillsDir, targetDir);

    try {
        const url = `${getApiBase()}/install/${encodeURIComponent(slug)}`;
        const data = await fetchJson<InstallResponse>(url);

        if (data.downloadUrl) {
            const res = await fetch(data.downloadUrl);
            if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

            await mkdir(targetDir, { recursive: true });
            const buffer = Buffer.from(await res.arrayBuffer());
            await writeFile(join(targetDir, "skill.tar.gz"), buffer);

            const listing = await execTar(["tf", "skill.tar.gz"], targetDir);
            const unsafeEntry = listing.split(/\r?\n/).find((entry) => !isSafeTarEntry(entry));
            if (unsafeEntry) {
                throw new Error(`Unsafe path in skill archive: ${unsafeEntry}`);
            }

            await execTar(["xzf", "skill.tar.gz", "-C", targetDir], targetDir);

            try {
                const { unlink } = await import("fs/promises");
                await unlink(join(targetDir, "skill.tar.gz"));
            } catch { /* ignore */ }
        } else {
            throw new Error(data.error ?? "No download URL");
        }
    } catch (err) {
        try {
            await rm(targetDir, { recursive: true, force: true });
        } catch { /* ignore */ }
        throw err;
    }
}

export async function uninstallSkill(slug: string, cwd: string): Promise<void> {
    const targetDir = join(cwd, ".agents", "skills", slug);
    await rm(targetDir, { recursive: true, force: true });
}

export async function checkSkillhubApi(): Promise<boolean> {
    try {
        const url = `${getApiBase()}/health`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return res.ok;
    } catch {
        return false;
    }
}

export function parseSearchOutput(stdout: string): SkillInfo[] {
    let parsed: SearchResponse;
    try {
        parsed = JSON.parse(stdout) as SearchResponse;
    } catch (err) {
        throw new Error(`skillhub search output is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed.results || !Array.isArray(parsed.results)) return [];
    return parsed.results.map((r) => ({
        slug: r.slug ?? "",
        name: r.name ?? "",
        description: r.description ?? "",
        version: r.version ?? "0.0.0",
        source: r.source,
    }));
}
