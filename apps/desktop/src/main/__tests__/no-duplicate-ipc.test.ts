// Static scan of IPC handler files to prevent duplicate ipcMain.handle registrations.
// Originally scanned only index.ts; now that handlers are split into ipc/*.ipc.ts,
// we scan the entire ipc/ directory plus any remaining inline handlers in index.ts.
//
// Known limitation: only scans literal channel names. Template strings / variables won't match.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

function getAllIpcSource(): string {
    const ipcDir = resolve(__dirname, "../ipc");
    const indexPath = resolve(__dirname, "../index.ts");
    const files = readdirSync(ipcDir).filter(f => f.endsWith(".ts") && !f.includes("test") && f !== "schemas.ts");
    let content = readFileSync(indexPath, "utf-8");
    for (const f of files) {
        content += "\n" + readFileSync(resolve(ipcDir, f), "utf-8");
    }
    return content;
}

describe("IPC handlers: duplicate registration regression", () => {
    it("每个 channel 名只出现一次", () => {
        const content = getAllIpcSource();
        const matches = content.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);
        const counts = new Map<string, number>();
        for (const m of matches) {
            const ch = m[1];
            counts.set(ch, (counts.get(ch) ?? 0) + 1);
        }
        const dupes = Array.from(counts.entries())
            .filter(([, n]) => n > 1)
            .map(([ch, n]) => `${ch} (×${n})`);
        expect(dupes, `duplicate ipcMain.handle channels: ${dupes.join(", ")}`).toEqual([]);
    });

    it("每个 channel 名只出现一次 (on 形式, e.g. log:write)", () => {
        const content = getAllIpcSource();
        const matches = content.matchAll(/ipcMain\.on\(\s*['"]([^'"]+)['"]/g);
        const counts = new Map<string, number>();
        for (const m of matches) {
            const ch = m[1];
            counts.set(ch, (counts.get(ch) ?? 0) + 1);
        }
        const dupes = Array.from(counts.entries())
            .filter(([, n]) => n > 1)
            .map(([ch, n]) => `${ch} (×${n})`);
        expect(dupes, `duplicate ipcMain.on channels: ${dupes.join(", ")}`).toEqual([]);
    });

    it("git:diff-staged 使用标准 git diff --staged 参数", () => {
        const gitIpcPath = resolve(__dirname, "../ipc/git.ipc.ts");
        const content = readFileSync(gitIpcPath, "utf-8");

        expect(content).toContain("['diff', '--staged']");
        expect(content).not.toContain("['diff-staged']");
    });

    // wave-108 residual
    it("registers a non-empty set of known handle channels", () => {
        const content = getAllIpcSource();
        const matches = [...content.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
        expect(matches.length).toBeGreaterThan(20);
        for (const required of [
            "diagnostics:export",
            "updater:get-state",
            "updater:check",
            "workspace:list",
            "settings:get",
        ]) {
            expect(matches).toContain(required);
        }
    });
});
