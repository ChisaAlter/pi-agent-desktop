// v1.0.10 (L5 修复): 静态扫描 main/index.ts, 防止 ipcMain.handle 重复注册.
// v1.0.6.1 引入 IpcError 契约时没 clean apply, 18 个 channel 被注册两次,
// app 启动就崩. 此处用最简单的字符串扫描兜住回归, 不需要 mock electron 整套.
//
// 已知限制: 只能扫字面量 channel 名, 模板字符串 / 变量名扫不到.
// 真实项目里所有 ipcMain.handle 都应该用字面量, 违反时再补强即可.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("main/index.ts: ipcMain.handle 重复注册回归", () => {
    it("每个 channel 名只出现一次", () => {
        const indexPath = resolve(__dirname, "../index.ts");
        const content = readFileSync(indexPath, "utf-8");
        // 匹配 ipcMain.handle('X', ...) 或 ipcMain.handle("X", ...)
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
        const indexPath = resolve(__dirname, "../index.ts");
        const content = readFileSync(indexPath, "utf-8");
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
        const indexPath = resolve(__dirname, "../index.ts");
        const content = readFileSync(indexPath, "utf-8");

        expect(content).toContain("['diff', '--staged']");
        expect(content).not.toContain("['diff-staged']");
    });
});
