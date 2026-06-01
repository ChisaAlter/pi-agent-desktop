# Pi Desktop M3 — Skills Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skills 面板 + SkillHub 集成 — Pi Desktop 的核心差异化

**Architecture:** SkillHub CLI 包装 → IPC → renderer state → UI components (marketplace + my skills)

**Tech Stack:** React 19, Tailwind 4, TypeScript 5, vitest 2, Zustand 5

**Spec ref:** `docs/superpowers/specs/2026-06-01-pi-desktop-v1-design.md` §11, §7.3

**关键发现 (2026-06-01):**
- `skillhub` CLI 已装 (`C:\Users\48818\.local\bin\skillhub`), `search --json` 输出结构化 JSON
- 输出: `{ query, count, results: [{slug, name, description, version, source}], warnings }`
- `install <slug>` 下载到 `./skills/` (默认), `list` 列已装的

---

## 文件结构 (M3 涉及)

```
apps/desktop/src/main/
├── services/skills/
│   ├── skillhub-adapter.ts       # NEW: 包装 skillhub CLI
│   └── __tests__/
│       └── skillhub-adapter.test.ts
├── ipc/
│   └── skills.ipc.ts             # NEW: skills:search/list/install/toggle/uninstall
└── utils/
    └── skill-format.ts           # NEW: SKILL.md frontmatter 解析 (TDD)

apps/desktop/src/renderer/src/
├── stores/
│   └── skills-store.ts           # NEW: marketplace + my skills
├── components/
│   ├── SkillsPanel/              # NEW: 主容器 (市场/我的 tab)
│   │   ├── SkillsPanel.tsx
│   │   ├── SkillsMarketplace.tsx
│   │   ├── MySkills.tsx
│   │   ├── SkillCard.tsx
│   │   └── SkillCreateDropdown.tsx
│   └── SkillEditor/              # M3.1 defer
│       └── (将来)
```

---

## Task M3-1: SkillHub adapter (TDD)

**Files:**
- Create: `apps/desktop/src/main/services/skills/skillhub-adapter.ts`
- Create: `apps/desktop/src/main/services/skills/__tests__/skillhub-adapter.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/desktop/src/main/services/skills/__tests__/skillhub-adapter.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("child_process", () => ({
    execFile: vi.fn(),
}));

import { execFile } from "child_process";
import { searchSkills, listInstalled, installSkill, parseSearchOutput } from "../skillhub-adapter";

describe("parseSearchOutput", () => {
    it("parses valid JSON", () => {
        const json = JSON.stringify({
            query: "hello",
            count: 2,
            results: [
                { slug: "a", name: "A", description: "d", version: "1.0.0", source: "community" },
                { slug: "b", name: "B", description: "d2", version: "1.0.1", source: "official" },
            ],
            warnings: [],
        });
        const r = parseSearchOutput(json);
        expect(r).toHaveLength(2);
        expect(r[0].slug).toBe("a");
        expect(r[0].name).toBe("A");
    });
    it("throws on invalid JSON", () => {
        expect(() => parseSearchOutput("not json")).toThrow();
    });
    it("returns empty on no results", () => {
        const json = JSON.stringify({ query: "x", count: 0, results: [], warnings: [] });
        expect(parseSearchOutput(json)).toHaveLength(0);
    });
});

describe("searchSkills", () => {
    it("calls skillhub with --json and parses", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            expect(cmd).toBe("skillhub");
            expect(args).toContain("search");
            expect(args).toContain("hello");
            expect(args).toContain("--json");
            cb(null, JSON.stringify({
                query: "hello", count: 1,
                results: [{ slug: "x", name: "X", description: "d", version: "1.0.0", source: "community" }],
                warnings: [],
            }), "");
        });
        const r = await searchSkills("hello");
        expect(r).toHaveLength(1);
        expect(r[0].slug).toBe("x");
    });
    it("rejects on exec error", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            cb(new Error("skillhub not found"), "", "stderr");
        });
        await expect(searchSkills("x")).rejects.toThrow("skillhub not found");
    });
});

describe("listInstalled", () => {
    it("parses text output (one slug per line)", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            expect(args).toContain("list");
            cb(null, "skill-one\nskill-two\nskill-three\n", "");
        });
        const r = await listInstalled();
        expect(r).toEqual(["skill-one", "skill-two", "skill-three"]);
    });
    it("returns empty array when no skills", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            cb(null, "No installed skills.\n", "");
        });
        const r = await listInstalled();
        expect(r).toEqual([]);
    });
});

describe("installSkill", () => {
    it("calls skillhub install with slug", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            expect(args).toContain("install");
            expect(args).toContain("hello-world");
            cb(null, "Installing hello-world...\nDone\n", "");
        });
        await installSkill("hello-world");
    });
    it("rejects on install error", async () => {
        (execFile as any).mockImplementation((cmd: string, args: string[], cb: any) => {
            cb(new Error("install failed"), "", "Network error");
        });
        await expect(installSkill("bad-skill")).rejects.toThrow("install failed");
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test skillhub`
Expected: FAIL

- [ ] **Step 3: 实现 skillhub-adapter.ts**

```typescript
// apps/desktop/src/main/services/skills/skillhub-adapter.ts
// 包装 skillhub CLI, 给 Skills 面板用
// 关键发现: `skillhub search <q> --json` 输出结构化 JSON
// `skillhub list` 输出 plain text (一行一个 slug)
// `skillhub install <slug>` 装到 ./skills/

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SkillInfo {
    slug: string;
    name: string;
    description: string;
    version: string;
    source?: string;
}

export interface InstalledSkill {
    slug: string;
    /** 安装路径 (相对 user data dir) */
    path: string;
    /** 是否启用 (M1 已有概念, M3 沿用) */
    enabled: boolean;
    /** 描述 (从 SKILL.md 读) */
    description?: string;
    version?: string;
}

export function parseSearchOutput(stdout: string): SkillInfo[] {
    let parsed: any;
    try {
        parsed = JSON.parse(stdout);
    } catch (err) {
        throw new Error(`skillhub search output is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed.results || !Array.isArray(parsed.results)) {
        return [];
    }
    return parsed.results.map((r: any) => ({
        slug: r.slug,
        name: r.name,
        description: r.description ?? "",
        version: r.version ?? "0.0.0",
        source: r.source,
    }));
}

export async function searchSkills(query: string, limit: number = 20): Promise<SkillInfo[]> {
    const args = ["search", query, "--json", "--search-limit", String(limit)];
    try {
        const { stdout } = await execFileAsync("skillhub", args, { timeout: 30_000 });
        return parseSearchOutput(stdout);
    } catch (err) {
        throw new Error(`skillhub search failed: ${(err as Error).message}`);
    }
}

export async function listInstalled(): Promise<string[]> {
    try {
        const { stdout } = await execFileAsync("skillhub", ["list"], { timeout: 10_000 });
        const trimmed = stdout.trim();
        if (!trimmed || trimmed.startsWith("No installed")) return [];
        return trimmed.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch (err) {
        throw new Error(`skillhub list failed: ${(err as Error).message}`);
    }
}

export async function installSkill(slug: string, cwd: string = process.cwd()): Promise<void> {
    try {
        await execFileAsync("skillhub", ["install", slug, "--dir", "skills"], {
            timeout: 60_000,
            cwd,
        });
    } catch (err) {
        throw new Error(`skillhub install failed for "${slug}": ${(err as Error).message}`);
    }
}

export async function uninstallSkill(slug: string, cwd: string = process.cwd()): Promise<void> {
    // skillhub 没有 uninstall 命令, 我们直接 rm -rf skills/<slug>
    const { rm } = await import("fs/promises");
    const { join } = await import("path");
    await rm(join(cwd, "skills", slug), { recursive: true, force: true });
}

export async function checkSkillhubInstalled(): Promise<boolean> {
    try {
        await execFileAsync("skillhub", ["--version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `pnpm test skillhub`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/skills/
git commit -m "feat(M3): SkillHub adapter wrapping CLI (Task M3-1)"
```

---

## Task M3-2: Skills IPC

**Files:**
- Create: `apps/desktop/src/main/ipc/skills.ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: 写 skills.ipc.ts**

```typescript
// apps/desktop/src/main/ipc/skills.ipc.ts
import { ipcMain } from "electron";
import {
    searchSkills,
    listInstalled,
    installSkill,
    uninstallSkill,
    checkSkillhubInstalled,
} from "../services/skills/skillhub-adapter";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

interface SkillsIpcDeps {
    /** workspace path (cwd for skillhub install) */
    getWorkspacePath: () => string | undefined;
    /** 启用状态持久化文件路径 */
    getStateFile: () => string;
}

const STATE_FILE_VERSION = 1;
interface SkillsState {
    version: number;
    disabled: string[]; // slugs that are disabled
}

function loadState(file: string): SkillsState {
    if (!existsSync(file)) return { version: STATE_FILE_VERSION, disabled: [] };
    try {
        return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
        return { version: STATE_FILE_VERSION, disabled: [] };
    }
}

function saveState(file: string, state: SkillsState): void {
    writeFileSync(file, JSON.stringify(state, null, 2), "utf-8");
}

export function setupSkillsIpc(deps: SkillsIpcDeps): void {
    ipcMain.handle("skills:check", async () => {
        return await checkSkillhubInstalled();
    });

    ipcMain.handle("skills:search", async (_event, query: string) => {
        return await searchSkills(query);
    });

    ipcMain.handle("skills:installed", async () => {
        const slugs = await listInstalled();
        const state = loadState(deps.getStateFile());
        return slugs.map((slug) => ({
            slug,
            enabled: !state.disabled.includes(slug),
        }));
    });

    ipcMain.handle("skills:install", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) throw new Error("No workspace selected");
        await installSkill(slug, cwd);
        return { success: true };
    });

    ipcMain.handle("skills:uninstall", async (_event, slug: string) => {
        const cwd = deps.getWorkspacePath();
        if (!cwd) throw new Error("No workspace selected");
        await uninstallSkill(slug, cwd);
        return { success: true };
    });

    ipcMain.handle("skills:toggle", async (_event, slug: string, enabled: boolean) => {
        const state = loadState(deps.getStateFile());
        if (enabled) {
            state.disabled = state.disabled.filter((s) => s !== slug);
        } else {
            if (!state.disabled.includes(slug)) state.disabled.push(slug);
        }
        saveState(deps.getStateFile(), state);
        return { success: true };
    });
}
```

- [ ] **Step 2: 在 index.ts 接入**

```typescript
// index.ts
import { setupSkillsIpc } from './ipc/skills.ipc';

// 在 setupIPC() 里:
setupSkillsIpc({
    getWorkspacePath: () => {
        const ws = store.get('workspaces');
        return ws.length > 0 ? ws[0].path : undefined;
    },
    getStateFile: () => join(app.getPath('userData'), 'skills-state.json'),
});
```

- [ ] **Step 3: 加 preload API**

```typescript
// preload
skillsCheck: () => ipcRenderer.invoke('skills:check'),
skillsSearch: (query: string) => ipcRenderer.invoke('skills:search', query),
skillsInstalled: () => ipcRenderer.invoke('skills:installed'),
skillsInstall: (slug: string) => ipcRenderer.invoke('skills:install', slug),
skillsUninstall: (slug: string) => ipcRenderer.invoke('skills:uninstall', slug),
skillsToggle: (slug: string, enabled: boolean) => ipcRenderer.invoke('skills:toggle', slug, enabled),
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/main/ipc/skills.ipc.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts
git commit -m "feat(M3): skills IPC (search/install/list/toggle/uninstall) (Task M3-2)"
```

---

## Task M3-3: SkillsStore (renderer)

**Files:**
- Create: `apps/desktop/src/renderer/src/stores/skills-store.ts`

- [ ] **Step 1: 写 store**

```typescript
// apps/desktop/src/renderer/src/stores/skills-store.ts
import { create } from "zustand";
import type { SkillInfo } from "../../../main/services/skills/skillhub-adapter";

declare global {
    interface Window {
        piAPI?: {
            skillsCheck: () => Promise<boolean>;
            skillsSearch: (query: string) => Promise<SkillInfo[]>;
            skillsInstalled: () => Promise<Array<{ slug: string; enabled: boolean }>>;
            skillsInstall: (slug: string) => Promise<{ success: boolean }>;
            skillsUninstall: (slug: string) => Promise<{ success: boolean }>;
            skillsToggle: (slug: string, enabled: boolean) => Promise<{ success: boolean }>;
        };
    }
}

interface InstalledSkill {
    slug: string;
    enabled: boolean;
}

interface SkillsState {
    /** skillhub CLI 是否安装 */
    skillhubAvailable: boolean | null;
    /** 市场 tab 当前查询 */
    marketQuery: string;
    /** 市场 tab 当前结果 */
    marketResults: SkillInfo[];
    marketLoading: boolean;
    /** 我的 tab 已装列表 */
    installed: InstalledSkill[];
    installedLoading: boolean;
    /** 状态 */
    error: string | null;

    // Actions
    setMarketQuery: (q: string) => void;
    searchMarket: () => Promise<void>;
    refreshInstalled: () => Promise<void>;
    checkAvailability: () => Promise<void>;
    installSkill: (slug: string) => Promise<void>;
    uninstallSkill: (slug: string) => Promise<void>;
    toggleSkill: (slug: string, enabled: boolean) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
    skillhubAvailable: null,
    marketQuery: "",
    marketResults: [],
    marketLoading: false,
    installed: [],
    installedLoading: false,
    error: null,

    setMarketQuery: (q) => set({ marketQuery: q }),

    checkAvailability: async () => {
        const available = await window.piAPI?.skillsCheck();
        set({ skillhubAvailable: available ?? false });
    },

    searchMarket: async () => {
        const q = get().marketQuery;
        if (!q.trim()) {
            set({ marketResults: [] });
            return;
        }
        set({ marketLoading: true, error: null });
        try {
            const results = await window.piAPI?.skillsSearch(q) ?? [];
            set({ marketResults: results, marketLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, marketLoading: false });
        }
    },

    refreshInstalled: async () => {
        set({ installedLoading: true, error: null });
        try {
            const installed = await window.piAPI?.skillsInstalled() ?? [];
            set({ installed, installedLoading: false });
        } catch (err) {
            set({ error: (err as Error).message, installedLoading: false });
        }
    },

    installSkill: async (slug) => {
        set({ error: null });
        try {
            await window.piAPI?.skillsInstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
            throw err;
        }
    },

    uninstallSkill: async (slug) => {
        set({ error: null });
        try {
            await window.piAPI?.skillsUninstall(slug);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },

    toggleSkill: async (slug, enabled) => {
        try {
            await window.piAPI?.skillsToggle(slug, enabled);
            await get().refreshInstalled();
        } catch (err) {
            set({ error: (err as Error).message });
        }
    },
}));
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/renderer/src/stores/skills-store.ts
git commit -m "feat(M3): SkillsStore (Zustand) (Task M3-3)"
```

---

## Task M3-4: SkillsMarketplace UI (匹配 Mavis Code 截图)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SkillsPanel/SkillCard.tsx`
- Create: `apps/desktop/src/renderer/src/components/SkillsPanel/SkillsMarketplace.tsx`
- Create: `apps/desktop/src/renderer/src/components/SkillsPanel/SkillsPanel.tsx`

- [ ] **Step 1: 写 SkillCard**

```tsx
// apps/desktop/src/renderer/src/components/SkillsPanel/SkillCard.tsx
import type { SkillInfo } from "../../../main/services/skills/skillhub-adapter";

interface SkillCardProps {
    skill: SkillInfo;
    installed?: boolean;
    onInstall?: () => void;
    onView?: () => void;
}

export function SkillCard({ skill, installed, onInstall, onView }: SkillCardProps): JSX.Element {
    return (
        <div className="bg-white border border-[#e5e5e5] rounded-xl p-4 flex flex-col gap-2 hover:border-[#999] transition-colors">
            <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#1a1a1a] truncate" title={skill.name}>
                    {skill.name}
                </h3>
                <span className="text-[10px] text-[#999] font-mono whitespace-nowrap">v{skill.version}</span>
            </div>
            <p className="text-xs text-[#666] line-clamp-3 flex-1 min-h-[2.5rem]">
                {skill.description.slice(0, 120)}
                {skill.description.length > 120 ? "..." : ""}
            </p>
            <div className="flex items-center justify-between gap-2 mt-1">
                <div className="flex items-center gap-2 text-[10px] text-[#999]">
                    <span>@{skill.slug}</span>
                    {skill.source && (
                        <span className="px-1.5 py-0.5 bg-[#f0f0f0] rounded text-[#666]">
                            {skill.source}
                        </span>
                    )}
                </div>
                {installed ? (
                    <span className="text-[10px] text-green-600 font-medium">✓ 已装</span>
                ) : onInstall ? (
                    <button
                        onClick={onInstall}
                        className="text-xs px-3 py-1 bg-[#1a1a1a] text-white rounded hover:bg-[#333] transition-colors"
                    >
                        装
                    </button>
                ) : null}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: 写 SkillsMarketplace**

```tsx
// apps/desktop/src/renderer/src/components/SkillsPanel/SkillsMarketplace.tsx
import { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { SkillCard } from "./SkillCard";
import { fuzzyScore } from "../../../main/utils/fuzzy-match";

const FILTERS = [
    { id: "all", label: "全部" },
    { id: "official", label: "官方" },
    { id: "community", label: "贡献" },
] as const;

type FilterId = typeof FILTERS[number]["id"];

export function SkillsMarketplace(): JSX.Element {
    const {
        skillhubAvailable,
        marketQuery, setMarketQuery,
        marketResults, marketLoading,
        installed, searchMarket, installSkill, checkAvailability,
    } = useSkillsStore();
    const [activeFilter, setActiveFilter] = useState<FilterId>("all");
    const [sort, setSort] = useState<"热门" | "最新">("热门");

    useEffect(() => {
        checkAvailability();
    }, [checkAvailability]);

    useEffect(() => {
        if (marketQuery.trim()) {
            const t = setTimeout(() => searchMarket(), 300);
            return () => clearTimeout(t);
        }
    }, [marketQuery, searchMarket]);

    const installedSlugs = new Set(installed.map((i) => i.slug));

    const filtered = marketResults
        .filter((r) => {
            if (activeFilter === "all") return true;
            return r.source === activeFilter;
        })
        .map((r) => ({ r, s: fuzzyScore(r.name + " " + r.description, marketQuery) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r);

    if (skillhubAvailable === false) {
        return (
            <div className="p-8 text-center text-sm text-[#666]">
                <p className="mb-2">SkillHub CLI 未安装</p>
                <code className="block text-xs bg-[#f5f5f5] p-2 rounded">
                    curl -fsSL https://skillhub.cn/install/install.sh | bash
                </code>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* Filter chips */}
            <div className="flex items-center gap-2 mb-4">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setActiveFilter(f.id)}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                            activeFilter === f.id
                                ? "bg-[#1a1a1a] text-white"
                                : "bg-[#f5f5f5] text-[#666] hover:bg-[#e5e5e5]"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
                <div className="flex-1" />
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as any)}
                    className="text-xs px-2 py-1 bg-white border border-[#e5e5e5] rounded text-[#666]"
                >
                    <option value="热门">热门</option>
                    <option value="最新">最新</option>
                </select>
            </div>

            {/* Grid */}
            {marketLoading ? (
                <div className="text-center text-sm text-[#999] py-8">搜索中...</div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-sm text-[#999] py-8">
                    {marketQuery ? "无匹配结果" : "输入关键词搜索 Skills"}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map((s) => (
                        <SkillCard
                            key={s.slug}
                            skill={s}
                            installed={installedSlugs.has(s.slug)}
                            onInstall={() => installSkill(s.slug)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 3: 写 SkillsPanel 容器 (含 tab) **

```tsx
// apps/desktop/src/renderer/src/components/SkillsPanel/SkillsPanel.tsx
import { useState } from "react";
import { SkillsMarketplace } from "./SkillsMarketplace";
import { MySkills } from "./MySkills";
import { SkillCreateDropdown } from "./SkillCreateDropdown";

type Tab = "market" | "mine";

export function SkillsPanel(): JSX.Element {
    const [tab, setTab] = useState<Tab>("market");

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Tabs + Search + Create */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e5e5e5]">
                <div className="flex items-center gap-1">
                    {([["market", "市场"], ["mine", "我的"]] as const).map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                tab === id
                                    ? "bg-[#1a1a1a] text-white"
                                    : "text-[#666] hover:bg-[#f5f5f5]"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                <div className="relative">
                    <input
                        type="text"
                        placeholder="搜索技能..."
                        className="pl-3 pr-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a] w-64"
                    />
                </div>
                <SkillCreateDropdown />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {tab === "market" ? <SkillsMarketplace /> : <MySkills />}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/components/SkillsPanel/
git commit -m "feat(M3): SkillsMarketplace + SkillCard + SkillsPanel (Task M3-4)"
```

---

## Task M3-5: MySkills UI

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SkillsPanel/MySkills.tsx`

- [ ] **Step 1: 写 MySkills**

```tsx
// apps/desktop/src/renderer/src/components/SkillsPanel/MySkills.tsx
import { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { fuzzyScore } from "../../../main/utils/fuzzy-match";

export function MySkills(): JSX.Element {
    const { installed, installedLoading, refreshInstalled, toggleSkill, uninstallSkill, skillhubAvailable } = useSkillsStore();
    const [query, setQuery] = useState("");

    useEffect(() => {
        refreshInstalled();
    }, [refreshInstalled]);

    const filtered = installed
        .map((s) => ({ s, score: fuzzyScore(s.slug, query) }))
        .filter((x) => query === "" || x.score > 0)
        .sort((a, b) => b.score - a.score);

    if (skillhubAvailable === false) {
        return (
            <div className="p-8 text-center text-sm text-[#666]">
                SkillHub CLI 未安装
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* Search */}
            <div className="mb-4">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="过滤已装技能..."
                    className="w-full px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-sm text-[#1a1a1a] placeholder:text-[#999] focus:outline-none focus:border-[#1a1a1a]"
                />
            </div>

            {installedLoading ? (
                <div className="text-center text-sm text-[#999] py-8">加载中...</div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-sm text-[#999] py-8">
                    {query ? "无匹配" : "还没装任何技能, 去市场看看"}
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(({ s }) => (
                        <div
                            key={s.slug}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-[#fafafa] border border-[#e5e5e5] rounded-lg"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.enabled ? "#10b981" : "#999" }} />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-[#1a1a1a] truncate">
                                        {s.slug}
                                    </div>
                                    <div className="text-xs text-[#999]">
                                        {s.enabled ? "已启用" : "已禁用"}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => toggleSkill(s.slug, !s.enabled)}
                                    className="text-xs px-3 py-1 text-[#666] hover:bg-[#e5e5e5] rounded transition-colors"
                                >
                                    {s.enabled ? "禁用" : "启用"}
                                </button>
                                <button
                                    onClick={() => {
                                        if (confirm(`确认卸载技能 ${s.slug}?`)) {
                                            uninstallSkill(s.slug);
                                        }
                                    }}
                                    className="text-xs px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                    卸载
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/renderer/src/components/SkillsPanel/MySkills.tsx
git commit -m "feat(M3): MySkills UI with enable/disable/uninstall (Task M3-5)"
```

---

## Task M3-6: SkillCreateDropdown (3 选项)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/SkillsPanel/SkillCreateDropdown.tsx`

- [ ] **Step 1: 写 dropdown**

```tsx
// apps/desktop/src/renderer/src/components/SkillsPanel/SkillCreateDropdown.tsx
import { useState, useRef, useEffect } from "react";

interface SkillCreateDropdownProps {
    onBuildWithPi?: () => void;
    onWriteDirect?: () => void;
    onImportFromGitHub?: () => void;
}

export function SkillCreateDropdown({
    onBuildWithPi,
    onWriteDirect,
    onImportFromGitHub,
}: SkillCreateDropdownProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] text-white text-sm rounded hover:bg-[#333] transition-colors"
            >
                <span>+ 创建</span>
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-10 py-1">
                    <button
                        onClick={() => {
                            setOpen(false);
                            onBuildWithPi?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg">💬</span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">用 Pi 构建</div>
                            <div className="text-xs text-[#666]">通过对话构建出色的技能</div>
                        </div>
                    </button>
                    <button
                        onClick={() => {
                            setOpen(false);
                            onWriteDirect?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg">✏️</span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">编写技能</div>
                            <div className="text-xs text-[#666]">直接编写你的指令</div>
                        </div>
                    </button>
                    <button
                        onClick={() => {
                            setOpen(false);
                            onImportFromGitHub?.();
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] transition-colors flex items-start gap-2"
                    >
                        <span className="text-lg">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                            </svg>
                        </span>
                        <div>
                            <div className="text-sm font-medium text-[#1a1a1a]">从 Github 导入</div>
                            <div className="text-xs text-[#666]">粘贴仓库链接以开始</div>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/renderer/src/components/SkillsPanel/SkillCreateDropdown.tsx
git commit -m "feat(M3): SkillCreateDropdown with 3 options (Task M3-6)"
```

---

## Task M3-7: GitHub import flow (M3-8)

**Files:**
- Create: `apps/desktop/src/main/ipc/skills.ipc.ts` (add github:import handler)
- Modify: `apps/desktop/src/renderer/src/components/SkillsPanel/SkillsPanel.tsx`

- [ ] **Step 1: 加 github:import IPC**

```typescript
// skills.ipc.ts 加:
ipcMain.handle("skills:github-import", async (_event, repoUrl: string) => {
    const cwd = deps.getWorkspacePath();
    if (!cwd) throw new Error("No workspace selected");
    // 简单实现: 提示用户用 git clone + 复制 SKILL.md
    // 实际产品应该解析 GitHub API 找 SKILL.md
    // M3 简版直接返回 url 让用户在浏览器打开
    return { url: repoUrl, message: "请用 git clone 仓库到 skills/ 目录" };
});
```

- [ ] **Step 2: 加 preload**

```typescript
// preload
skillsGithubImport: (url: string) => ipcRenderer.invoke('skills:github-import', url),
```

- [ ] **Step 3: 在 SkillsPanel 接 3 选项的 callback**

```typescript
// SkillsPanel.tsx 加 import 弹层:
const [githubDialog, setGithubDialog] = useState<{ open: boolean; url: string }>({ open: false, url: "" });

// 在 SkillCreateDropdown 加:
<SkillCreateDropdown
    onBuildWithPi={() => alert("M3 暂未实装, 可在 M3.1 加: 打开 chat 预填 '帮我写一个 skill...'")}
    onWriteDirect={() => alert("M3 暂未实装, 可在 M3.1 加: 打开 Monaco 编辑器")}
    onImportFromGitHub={() => {
        const url = prompt("粘 GitHub 仓库 URL (e.g. https://github.com/user/repo):");
        if (url) setGithubDialog({ open: true, url });
    }}
/>

{githubDialog.open && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-6 max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold mb-2">从 GitHub 导入</h3>
            <p className="text-sm text-[#666] mb-3">{githubDialog.url}</p>
            <p className="text-xs text-[#999]">
                M3 暂未实装自动导入. 请用 git clone 仓库到 skills/ 目录.
            </p>
            <button
                onClick={() => setGithubDialog({ open: false, url: "" })}
                className="mt-4 px-4 py-2 bg-[#1a1a1a] text-white rounded"
            >
                关闭
            </button>
        </div>
    </div>
)}
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/main/ipc/skills.ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/components/SkillsPanel/SkillsPanel.tsx
git commit -m "feat(M3): GitHub import flow stub + dialog (Task M3-8)"
```

---

## Task M3-9: e2e + smoke checklist

- [ ] **Step 1: 写 m3 e2e**

```typescript
// apps/desktop/src/test/e2e/m3.test.ts
import { describe, it, expect } from "vitest";
import { parseSearchOutput } from "../../main/services/skills/skillhub-adapter";

describe("M3 utilities", () => {
    it("parseSearchOutput: handles valid JSON", () => {
        const json = JSON.stringify({
            query: "x", count: 1,
            results: [{ slug: "a", name: "A", description: "d", version: "1.0.0" }],
            warnings: [],
        });
        const r = parseSearchOutput(json);
        expect(r).toHaveLength(1);
    });
    it("parseSearchOutput: empty results", () => {
        expect(parseSearchOutput(JSON.stringify({ query: "x", count: 0, results: [], warnings: [] }))).toHaveLength(0);
    });
    it("parseSearchOutput: invalid JSON throws", () => {
        expect(() => parseSearchOutput("bad json")).toThrow();
    });
});
```

- [ ] **Step 2: 跑全量**

Run: `pnpm -r test`
Expected: 80+ pass

- [ ] **Step 3: 写 m3 smoke 清单**

```bash
# docs/superpowers/plans/2026-06-01-m3-smoke-test.md
```

5 步:
1. 装 skillhub (如果没有): `curl -fsSL https://skillhub.cn/install/install.sh | bash`
2. 在桌面应用点 Skills 图标 → 看到市场 tab, 输入 "hello" 搜到结果
3. 点 "装" 按钮 → 进度 → "我的" tab 出现新装项
4. 在"我的"禁用/启用/卸载某个技能
5. 点 "+ 创建" → 看到 3 个选项, 试 "从 GitHub 导入"

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/test/e2e/m3.test.ts docs/superpowers/plans/2026-06-01-m3-smoke-test.md
git commit -m "test(M3): e2e + manual smoke checklist (Task M3-9)"
```

---

## 完成标准 (M3)

- [ ] SkillHub CLI 检测 (没装时友好提示)
- [ ] 市场 tab 搜 "hello" 出来结果卡片
- [ ] 卡片显示 slug/name/desc/version/source
- [ ] 点 "装" 按钮 → 我的 tab 出现新条目
- [ ] 我的 tab 启/禁/卸载 都生效
- [ ] + 创建 3 选项可见
- [ ] 80+ 测试全过
- [ ] M3 typecheck 干净

## 已知不做 (M3.1+)

- Monaco SkillEditor (M3.7)
- 真 Pi 扩展替换 M1 的 subscribe 拦截 (M3.10)
- SkillHub 装的 OpenClaw 格式 → Pi 格式 adapter (M3.11)
- SkillHub marketplace UI 自动加载 installed badges (M3.12)
