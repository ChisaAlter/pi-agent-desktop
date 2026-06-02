// SkillHub adapter (M3 Task M3-1)
// 包装 skillhub CLI, 给 Skills 面板用
// 关键发现: `skillhub search <q> --json` 输出结构化 JSON
// `skillhub list` 输出 plain text (一行一个 slug)
// `skillhub install <slug>` 装到 ./skills/

import { execFile } from "child_process";

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

interface SkillhubSearchPayload {
    results?: Array<{
        slug?: string;
        name?: string;
        description?: string;
        version?: string;
        source?: string;
    }>;
}

export function parseSearchOutput(stdout: string): SkillInfo[] {
    let parsed: SkillhubSearchPayload;
    try {
        parsed = JSON.parse(stdout) as SkillhubSearchPayload;
    } catch (err) {
        throw new Error(`skillhub search output is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed.results || !Array.isArray(parsed.results)) {
        return [];
    }
    return parsed.results.map((r) => ({
        slug: r.slug ?? "",
        name: r.name ?? "",
        description: r.description ?? "",
        version: r.version ?? "0.0.0",
        source: r.source,
    }));
}

export async function searchSkills(query: string, limit = 20): Promise<SkillInfo[]> {
    const args = ["search", query, "--json", "--search-limit", String(limit)];
    try {
        const { stdout } = await execFile("skillhub", args, { timeout: 30_000 });
        return parseSearchOutput(String(stdout ?? ""));
    } catch (err) {
        throw new Error(`skillhub search failed: ${(err as Error).message}`);
    }
}

export async function listInstalled(): Promise<string[]> {
    try {
        const { stdout } = await execFile("skillhub", ["list"], { timeout: 10_000 });
        const trimmed = String(stdout ?? "").trim();
        if (!trimmed || trimmed.startsWith("No installed")) return [];
        return trimmed.split("\n").map((s: string) => s.trim()).filter(Boolean);
    } catch (err) {
        throw new Error(`skillhub list failed: ${(err as Error).message}`);
    }
}

export async function installSkill(slug: string, cwd: string = process.cwd()): Promise<void> {
    try {
        await execFile("skillhub", ["install", slug, "--dir", "skills"], {
            timeout: 60_000,
            cwd,
        });
    } catch (err) {
        throw new Error(`skillhub install failed for "${slug}": ${(err as Error).message}`);
    }
}

export async function uninstallSkill(slug: string, cwd: string = process.cwd()): Promise<void> {
    const { rm } = await import("fs/promises");
    const { join } = await import("path");
    await rm(join(cwd, "skills", slug), { recursive: true, force: true });
}

export async function checkSkillhubInstalled(): Promise<boolean> {
    try {
        await execFile("skillhub", ["--version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
