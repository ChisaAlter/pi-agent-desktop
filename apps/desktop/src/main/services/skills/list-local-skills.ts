// Lists local workspace skills from <workspacePath>/.agents/skills
// Extracted from settings.ipc.ts (SubTask 8.3) to keep business logic
// out of the IPC layer per project architecture conventions.

import { join } from 'path';
import { readdir, readFile } from 'fs/promises';

export interface LocalSkill {
    name: string;
    description: string;
    path: string;
    enabled: boolean;
}

// SubTask 40.5: 30s TTL cache keyed by workspacePath
const skillsCache = new Map<string, { ts: number; data: LocalSkill[] }>();
const CACHE_TTL = 30_000; // 30 seconds

export async function listLocalSkills(workspacePath: string): Promise<LocalSkill[]> {
    const cached = skillsCache.get(workspacePath);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    const skillsDir = join(workspacePath, '.agents', 'skills');
    let entries;
    try {
        entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
        // directory doesn't exist or unreadable — cache empty result
        const empty: LocalSkill[] = [];
        skillsCache.set(workspacePath, { ts: Date.now(), data: empty });
        return empty;
    }

    const skills: LocalSkill[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const skillPath = join(skillsDir, entry.name);
            let description = '';

            const skillMdPath = join(skillPath, 'SKILL.md');
            try {
                const content = await readFile(skillMdPath, 'utf-8');
                const lines = content.split('\n').filter((l: string) => l.trim());
                for (const line of lines) {
                    if (!line.startsWith('#') && line.trim().length > 0) {
                        description = line.trim().substring(0, 100);
                        break;
                    }
                }
            } catch {
                // ignore read errors (e.g. SKILL.md missing)
            }

            skills.push({
                name: entry.name,
                description,
                path: skillPath,
                enabled: true
            });
        }
    }

    skillsCache.set(workspacePath, { ts: Date.now(), data: skills });
    return skills;
}
