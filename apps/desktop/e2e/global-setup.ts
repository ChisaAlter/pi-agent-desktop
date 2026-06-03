// v1.0.10: 这个 globalSetup 留着作为历史记录, 但实际不起作用 —
// patch node:sqlite 后, undici 又在 new CacheStorage 里 require webidl,
// webidl.util.markAsUncloneable 不存在 (Node 22.5+ 内建, Electron 34 缺失).
// pi-coding-agent 0.75.5 的整条依赖链都假设 Node 22.5+ runtime, 在 Electron 34
// 上无法 work, e2e 真正解要 v1.1 升 Electron.
//
// 见 apps/desktop/electron.vite.config.ts "E2E 阻塞说明" + OPTIMIZATION-ROADMAP.md.

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const OUT_DIR = resolve(__dirname, "..", "out", "main");

function patchFile(p: string): boolean {
    const c = readFileSync(p, "utf-8");
    const next = c.replace(/require\("node:sqlite"\)/g, "{}");
    if (next !== c) {
        writeFileSync(p, next);
        return true;
    }
    return false;
}

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
            out.push(...walk(p));
        } else if (p.endsWith(".js")) {
            out.push(p);
        }
    }
    return out;
}

export default async function globalSetup(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[e2e globalSetup] NOTE: see top-of-file comment. This patch only addresses node:sqlite.`);
    let patched = 0;
    for (const f of walk(OUT_DIR)) {
        if (patchFile(f)) patched++;
    }
    // eslint-disable-next-line no-console
    console.log(`[e2e globalSetup] patched node:sqlite in ${patched} files. undici/webidl still blocks at runtime.`);
}

