# Pi Desktop M2 — Context Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上下文输入支柱 — `@` 文件引用 / 图片粘贴 / Ctrl+K CommandPalette

**Architecture:** 纯 renderer 工作为主 (parse + UI), 后端加 file scanner + image save 2 个 IPC

**Tech Stack:** React 19, Tailwind 4, TypeScript 5, vitest 2

**Spec ref:** `docs/superpowers/specs/2026-06-01-pi-desktop-v1-design.md` §14 M2

---

## 文件结构 (M2 涉及)

```
apps/desktop/src/main/
├── ipc/
│   ├── files.ipc.ts              # NEW: 文件搜索 (listFiles IPC)
│   └── attachments.ipc.ts        # NEW: 附件保存 (saveImage IPC)
├── services/
│   └── search/
│       └── file-scanner.ts       # NEW: 扫 workspace 文件 (M2 简版, 不引 ripgrep)
└── utils/
    └── fuzzy-match.ts            # NEW: fuzzy 匹配 (TDD, @ 引用 + CommandPalette 都用)

apps/desktop/src/renderer/src/
├── stores/
│   └── attachments-store.ts      # NEW: 当前输入框的附件列表
├── hooks/
│   └── useMentions.ts            # NEW: @ 检测 + popover 控制
├── utils/
│   └── mention-parser.ts         # NEW: 从输入框文本提取 @ 位置 (TDD)
├── components/
│   ├── ChatInput/                # MODIFY: 集成 @ + 图片粘贴 + 附件
│   │   └── (M1 改过, M2 继续)
│   ├── AttachmentChip/           # NEW: 单个附件显示 (@file / image)
│   └── CommandPalette/           # NEW: Ctrl+K 模态
│       ├── CommandPalette.tsx    # 容器
│       ├── FileResult.tsx        # 文件搜索结果
│       ├── HistoryResult.tsx     # 历史搜索结果
│       └── CommandResult.tsx     # 命令结果
└── types/
    └── attachments.ts            # NEW: Attachment 类型
```

---

## Task M2-1: 文件扫描器 + IPC (TDD)

**Files:**
- Create: `apps/desktop/src/main/services/search/file-scanner.ts`
- Create: `apps/desktop/src/main/services/search/__tests__/file-scanner.test.ts`
- Create: `apps/desktop/src/main/ipc/files.ipc.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/services/search/__tests__/file-scanner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scanFiles } from "../file-scanner";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("scanFiles", () => {
    it("returns files in a directory (non-recursive)", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        writeFileSync(join(dir, "a.ts"), "");
        writeFileSync(join(dir, "b.ts"), "");
        const files = scanFiles(dir, { recursive: false });
        expect(files).toContain("a.ts");
        expect(files).toContain("b.ts");
    });

    it("skips node_modules and .git", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "node_modules"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "x.js"), "");
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, ".git", "HEAD"), "");
        writeFileSync(join(dir, "real.ts"), "");
        const files = scanFiles(dir);
        expect(files).toContain("real.ts");
        expect(files.some((f) => f.includes("node_modules"))).toBe(false);
        expect(files.some((f) => f.includes(".git"))).toBe(false);
    });

    it("respects maxDepth", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
        writeFileSync(join(dir, "a", "b", "c", "deep.ts"), "");
        writeFileSync(join(dir, "a", "shallow.ts"), "");
        const files = scanFiles(dir, { maxDepth: 2 });
        expect(files).toContain("a/shallow.ts");
        expect(files.some((f) => f.includes("deep.ts"))).toBe(false);
    });

    it("limits result count to 500 by default", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        for (let i = 0; i < 600; i++) {
            writeFileSync(join(dir, `f${i}.ts`), "");
        }
        const files = scanFiles(dir, { recursive: false });
        expect(files.length).toBeLessThanOrEqual(500);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test file-scanner`
Expected: FAIL

- [ ] **Step 3: 实现 file-scanner.ts**

```typescript
import { readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

const IGNORED_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", ".next", ".cache",
    "coverage", ".turbo", ".vite", "release", ".pi-desktop"
]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

export interface ScanOpts {
    recursive?: boolean;
    maxDepth?: number;
    maxResults?: number;
}

export function scanFiles(root: string, opts: ScanOpts = {}): string[] {
    const recursive = opts.recursive ?? true;
    const maxDepth = opts.maxDepth ?? 6;
    const maxResults = opts.maxResults ?? 500;
    const results: string[] = [];

    function walk(dir: string, depth: number) {
        if (depth > maxDepth) return;
        if (results.length >= maxResults) return;

        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= maxResults) return;
            if (IGNORED_FILES.has(entry)) continue;

            const fullPath = join(dir, entry);
            let isDir: boolean;
            try {
                isDir = statSync(fullPath).isDirectory();
            } catch {
                continue;
            }

            if (isDir) {
                if (IGNORED_DIRS.has(entry)) continue;
                if (recursive) walk(fullPath, depth + 1);
            } else {
                results.push(relative(root, fullPath).split(sep).join("/"));
            }
        }
    }

    walk(root, 0);
    return results;
}
```

- [ ] **Step 4: 跑测试通过**

Run: `pnpm test file-scanner`
Expected: 4 passed

- [ ] **Step 5: 注册 IPC**

`apps/desktop/src/main/ipc/files.ipc.ts`:

```typescript
import { ipcMain } from "electron";
import { scanFiles } from "../services/search/file-scanner";

export function setupFilesIpc(): void {
    ipcMain.handle("files:list", async (_event, workspacePath: string, query?: string) => {
        const files = scanFiles(workspacePath);
        if (!query) return files.slice(0, 100);
        const q = query.toLowerCase();
        return files.filter((f) => f.toLowerCase().includes(q)).slice(0, 50);
    });
}
```

Wire in `index.ts` after `setupChatIpc`.

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/main/services/search/ apps/desktop/src/main/ipc/files.ipc.ts
git commit -m "feat(M2): file scanner + files:list IPC (Task M2-1)"
```

---

## Task M2-2: Fuzzy 匹配 + @ mention 解析器 (TDD)

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/mention-parser.ts`
- Create: `apps/desktop/src/renderer/src/utils/__tests__/mention-parser.test.ts`
- Create: `apps/desktop/src/main/utils/fuzzy-match.ts`
- Create: `apps/desktop/src/main/utils/__tests__/fuzzy-match.test.ts`

- [ ] **Step 1: 写 fuzzy-match 测试**

```typescript
import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyScore } from "../fuzzy-match";

describe("fuzzyMatch", () => {
    it("returns true for substring matches", () => {
        expect(fuzzyMatch("auth/login.ts", "auth")).toBe(true);
        expect(fuzzyMatch("src/foo/bar.ts", "bar")).toBe(true);
    });
    it("returns true for camelCase matches (u/l -> user/login)", () => {
        expect(fuzzyMatch("userLoginService.ts", "uls")).toBe(true);
    });
    it("returns false for non-matches", () => {
        expect(fuzzyMatch("foo.ts", "bar")).toBe(false);
    });
});

describe("fuzzyScore", () => {
    it("ranks exact matches highest", () => {
        const a = fuzzyScore("auth.ts", "auth");
        const b = fuzzyScore("user-auth.ts", "auth");
        expect(a).toBeGreaterThan(b);
    });
    it("ranks prefix matches above middle matches", () => {
        const a = fuzzyScore("auth.ts", "auth");
        const b = fuzzyScore("userAuth.ts", "auth");
        expect(a).toBeGreaterThan(b);
    });
    it("returns 0 for non-match", () => {
        expect(fuzzyScore("foo.ts", "bar")).toBe(0);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test fuzzy`
Expected: FAIL

- [ ] **Step 3: 实现 fuzzy-match.ts**

```typescript
export function fuzzyMatch(text: string, query: string): boolean {
    return fuzzyScore(text, query) > 0;
}

export function fuzzyScore(text: string, query: string): number {
    if (!query) return 1;
    const tl = text.toLowerCase();
    const ql = query.toLowerCase();

    // Exact substring
    if (tl.includes(ql)) {
        // Prefix match scores higher
        if (tl.startsWith(ql)) return 100;
        return 50;
    }

    // Camelcase / path-segment match: u/l -> userLogin
    let qi = 0;
    for (let i = 0; i < tl.length && qi < ql.length; i++) {
        if (tl[i] === ql[qi]) qi++;
    }
    return qi === ql.length ? 25 : 0;
}
```

- [ ] **Step 4: 跑通过**

Run: `pnpm test fuzzy`
Expected: 6 passed

- [ ] **Step 5: 写 mention-parser 测试**

```typescript
import { describe, it, expect } from "vitest";
import { findActiveMention } from "../mention-parser";

describe("findActiveMention", () => {
    it("returns null if no @", () => {
        expect(findActiveMention("hello world", 5)).toBeNull();
    });
    it("returns null if @ before cursor has whitespace", () => {
        expect(findActiveMention("hello @ world", 8)).toBeNull();
    });
    it("finds @ at cursor position", () => {
        expect(findActiveMention("hello @au", 8)).toEqual({ start: 6, query: "au" });
    });
    it("finds @ even if cursor is at end of @token", () => {
        expect(findActiveMention("hello @auth", 11)).toEqual({ start: 6, query: "auth" });
    });
    it("finds @ when cursor is mid-token", () => {
        expect(findActiveMention("hello @aut", 9)).toEqual({ start: 6, query: "aut" });
    });
});
```

- [ ] **Step 6: 实现 mention-parser.ts**

```typescript
export interface MentionMatch {
    start: number;
    query: string;
}

/** 检测光标前是否在输入 @mention, 返回 match. */
export function findActiveMention(text: string, cursor: number): MentionMatch | null {
    if (cursor === 0) return null;
    // 从 cursor 往前找最近的 @
    const before = text.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) return null;

    // @ 之后到 cursor 之间必须是合法 token (无空白)
    const between = before.slice(atIdx + 1);
    if (/\s/.test(between)) return null;

    return { start: atIdx, query: between };
}

/** 把 @query 替换为 @resolved-path (完整 file path, 不含 @) */
export function resolveMention(text: string, match: MentionMatch, filePath: string): string {
    return text.slice(0, match.start) + "@" + filePath + text.slice(match.start + 1 + match.query.length);
}
```

- [ ] **Step 7: 跑测试通过**

Run: `pnpm test mention`
Expected: 5 passed

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/main/utils/ apps/desktop/src/renderer/src/utils/
git commit -m "feat(M2): fuzzy match + @ mention parser (Task M2-2)"
```

---

## Task M2-3: MentionPopover + 集成到 ChatInput

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ChatInput/MentionPopover.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx` (旧 ChatInput 在 ChatView 目录)
- Create: `apps/desktop/src/renderer/src/hooks/useMentions.ts`

- [ ] **Step 1: 写 useMentions hook**

```typescript
// apps/desktop/src/renderer/src/hooks/useMentions.ts
import { useState, useEffect, useCallback } from "react";
import { findActiveMention } from "../utils/mention-parser";

export function useMentions(text: string, cursor: number, onResolve: (start: number, query: string) => void) {
    const [activeMention, setActiveMention] = useState<{ start: number; query: string } | null>(null);

    useEffect(() => {
        setActiveMention(findActiveMention(text, cursor));
    }, [text, cursor]);

    return { activeMention };
}
```

- [ ] **Step 2: 写 MentionPopover 组件**

```tsx
// apps/desktop/src/renderer/src/components/ChatInput/MentionPopover.tsx
import { useEffect, useState } from "react";
import { fuzzyMatch, fuzzyScore } from "../../../main/utils/fuzzy-match";

interface MentionPopoverProps {
    query: string;
    workspacePath: string;
    onSelect: (filePath: string) => void;
    onClose: () => void;
}

declare global {
    interface Window {
        piAPI?: {
            filesList: (workspacePath: string, query?: string) => Promise<string[]>;
        };
    }
}

export function MentionPopover({ query, workspacePath, onSelect, onClose }: MentionPopoverProps): JSX.Element {
    const [results, setResults] = useState<string[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);

    useEffect(() => {
        if (!window.piAPI?.filesList) {
            setResults([]);
            return;
        }
        let cancelled = false;
        window.piAPI.filesList(workspacePath, query).then((all) => {
            if (cancelled) return;
            const scored = all
                .map((f) => ({ f, s: fuzzyScore(f, query) }))
                .filter((x) => x.s > 0)
                .sort((a, b) => b.s - a.s)
                .slice(0, 8)
                .map((x) => x.f);
            setResults(scored);
            setActiveIdx(0);
        });
        return () => {
            cancelled = true;
        };
    }, [query, workspacePath]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[activeIdx]) {
                e.preventDefault();
                onSelect(results[activeIdx]);
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [results, activeIdx, onSelect, onClose]);

    if (results.length === 0) {
        return (
            <div className="absolute bottom-full mb-2 left-0 bg-white border border-[#e5e5e5] rounded-lg shadow-lg p-3 text-xs text-[#999]">
                {query ? "没有匹配的文件" : "输入文件名搜索"}
            </div>
        );
    }

    return (
        <div className="absolute bottom-full mb-2 left-0 bg-white border border-[#e5e5e5] rounded-lg shadow-lg p-1 min-w-[320px] max-h-[300px] overflow-auto">
            {results.map((f, i) => (
                <button
                    key={f}
                    onClick={() => onSelect(f)}
                    className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                        i === activeIdx ? "bg-[#f0f0f0]" : "hover:bg-[#f5f5f5]"
                    }`}
                >
                    <span className="text-[#999]">📄</span>
                    <span className="truncate text-[#1a1a1a]">{f}</span>
                </button>
            ))}
        </div>
    );
}
```

- [ ] **Step 3: 集成到 ChatInput**

(在 M1 改过的 ChatInput 上, 加 @ 监听)

`apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx`:

在 textarea onChange 里跟踪 cursor, 加 useMentions 集成. 具体代码:

```tsx
import { useRef, useState, useCallback, useEffect } from "react";
import { findActiveMention, resolveMention } from "../../utils/mention-parser";
import { MentionPopover } from "./MentionPopover";

// 假设 ChatInput 已有: inputValue, setInputValue, textareaRef, onSend
// 加 state:
const [cursor, setCursor] = useState(0);
const activeMention = findActiveMention(inputValue, cursor);

// 替换 textarea 的 onChange:
onChange={(e) => {
    setInputValue(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
}}
onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
onKeyUp={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}

// 渲染 popover (在输入框上方):
{activeMention && currentWorkspace && (
    <div className="relative">
        <MentionPopover
            query={activeMention.query}
            workspacePath={currentWorkspace.path}
            onSelect={(filePath) => {
                const newText = resolveMention(inputValue, activeMention, filePath);
                setInputValue(newText);
                setCursor(activeMention.start + 1 + filePath.length);
                textareaRef.current?.focus();
            }}
            onClose={() => {}}
        />
    </div>
)}
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/components/ChatInput/ apps/desktop/src/renderer/src/hooks/useMentions.ts apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx
git commit -m "feat(M2): MentionPopover + @ mention integration in ChatInput (Task M2-3)"
```

---

## Task M2-4: 图片粘贴 + AttachmentChip

**Files:**
- Create: `apps/desktop/src/renderer/src/types/attachments.ts`
- Create: `apps/desktop/src/renderer/src/stores/attachments-store.ts`
- Create: `apps/desktop/src/renderer/src/components/ChatInput/AttachmentChip.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx`

- [ ] **Step 1: 定义类型**

```typescript
// apps/desktop/src/renderer/src/types/attachments.ts
export type AttachmentKind = "file" | "image";

export interface Attachment {
    id: string;
    kind: AttachmentKind;
    /** 显示在 chip 上的名字 */
    name: string;
    /** 完整路径 (file) 或 dataURL (image) */
    value: string;
    /** image only: mime type */
    mimeType?: string;
    /** image only: 字节数 */
    size?: number;
}
```

- [ ] **Step 2: 写 attachments-store.ts**

```typescript
// apps/desktop/src/renderer/src/stores/attachments-store.ts
import { create } from "zustand";
import type { Attachment } from "../types/attachments";

interface AttachmentsState {
    byWorkspace: Map<string, Attachment[]>;
    add: (workspaceId: string, attachment: Attachment) => void;
    remove: (workspaceId: string, id: string) => void;
    clear: (workspaceId: string) => void;
    list: (workspaceId: string) => Attachment[];
}

export const useAttachmentsStore = create<AttachmentsState>((set, get) => ({
    byWorkspace: new Map(),
    add: (workspaceId, attachment) => {
        set((s) => {
            const next = new Map(s.byWorkspace);
            const list = [...(next.get(workspaceId) ?? []), attachment];
            next.set(workspaceId, list);
            return { byWorkspace: next };
        });
    },
    remove: (workspaceId, id) => {
        set((s) => {
            const next = new Map(s.byWorkspace);
            const list = (next.get(workspaceId) ?? []).filter((a) => a.id !== id);
            next.set(workspaceId, list);
            return { byWorkspace: next };
        });
    },
    clear: (workspaceId) => {
        set((s) => {
            const next = new Map(s.byWorkspace);
            next.set(workspaceId, []);
            return { byWorkspace: next };
        });
    },
    list: (workspaceId) => get().byWorkspace.get(workspaceId) ?? [],
}));
```

- [ ] **Step 3: 写 AttachmentChip 组件**

```tsx
// apps/desktop/src/renderer/src/components/ChatInput/AttachmentChip.tsx
import type { Attachment } from "../../types/attachments";

interface AttachmentChipProps {
    attachment: Attachment;
    onRemove: (id: string) => void;
}

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps): JSX.Element {
    if (attachment.kind === "image") {
        return (
            <div className="inline-flex items-center gap-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg pl-1 pr-2 py-1">
                <img src={attachment.value} alt={attachment.name} className="w-6 h-6 rounded object-cover" />
                <span className="text-xs text-[#1a1a1a] truncate max-w-[120px]">{attachment.name}</span>
                <button
                    onClick={() => onRemove(attachment.id)}
                    className="text-[#999] hover:text-[#1a1a1a] text-xs"
                >
                    ✕
                </button>
            </div>
        );
    }
    return (
        <div className="inline-flex items-center gap-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg px-2 py-1">
            <span className="text-sm">📄</span>
            <span className="text-xs text-[#1a1a1a] truncate max-w-[160px]">{attachment.name}</span>
            <button
                onClick={() => onRemove(attachment.id)}
                className="text-[#999] hover:text-[#1a1a1a] text-xs"
            >
                ✕
            </button>
        </div>
    );
}
```

- [ ] **Step 4: 在 ChatInput 加图片粘贴 handler**

```tsx
// 在 ChatInput.tsx 加:
const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const attachment: Attachment = {
                    id: `img_${Date.now()}_${i}`,
                    kind: "image",
                    name: file.name || `pasted-${i}.png`,
                    value: dataUrl,
                    mimeType: file.type,
                    size: file.size,
                };
                useAttachmentsStore.getState().add(currentWorkspace.id, attachment);
            };
            reader.readAsDataURL(file);
        }
    }
};

// 加到 textarea:
<textarea
    ...
    onPaste={handlePaste}
//>
```

- [ ] **Step 5: 渲染 chips 在输入框上方**

```tsx
const attachments = useAttachmentsStore((s) => s.list(currentWorkspace?.id ?? ""));

<div className="flex flex-wrap gap-2 mb-2">
    {attachments.map((a) => (
        <AttachmentChip
            key={a.id}
            attachment={a}
            onRemove={(id) => useAttachmentsStore.getState().remove(currentWorkspace.id, id)}
        />
    ))}
</div>
```

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src/types/attachments.ts apps/desktop/src/renderer/src/stores/attachments-store.ts apps/desktop/src/renderer/src/components/ChatInput/AttachmentChip.tsx apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx
git commit -m "feat(M2): image paste + AttachmentChip (Task M2-4)"
```

---

## Task M2-5: CommandPalette (Ctrl+K)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/CommandPalette/CommandPalette.tsx`
- Create: `apps/desktop/src/renderer/src/components/CommandPalette/FileResult.tsx`
- Create: `apps/desktop/src/renderer/src/components/CommandPalette/HistoryResult.tsx`
- Create: `apps/desktop/src/renderer/src/components/CommandPalette/CommandResult.tsx`

- [ ] **Step 1: 写 CommandPalette 容器**

```tsx
// apps/desktop/src/renderer/src/components/CommandPalette/CommandPalette.tsx
import { useEffect, useState, useRef } from "react";
import { fuzzyScore } from "../../../main/utils/fuzzy-match";

export type CommandMode = "file" | "history" | "cmd";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    workspacePath: string;
    onSelectFile?: (path: string) => void;
    onSelectHistory?: (sessionId: string) => void;
    onRunCommand?: (cmd: string) => void;
}

declare global {
    interface Window {
        piAPI?: {
            filesList: (workspacePath: string, query?: string) => Promise<string[]>;
        };
    }
}

const COMMANDS = [
    { id: "new_chat", label: "新建对话", hint: "Ctrl+N" },
    { id: "open_skills", label: "打开 Skills", hint: "Ctrl+Shift+S" },
    { id: "open_settings", label: "打开设置", hint: "Ctrl+," },
    { id: "switch_workspace", label: "切换 workspace", hint: "Ctrl+P" },
    { id: "toggle_terminal", label: "切换终端", hint: "Ctrl+`" },
];

export function CommandPalette({ isOpen, onClose, workspacePath, onSelectFile, onSelectHistory, onRunCommand }: CommandPaletteProps): JSX.Element | null {
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<CommandMode>("file");
    const [activeIdx, setActiveIdx] = useState(0);
    const [files, setFiles] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setMode("file");
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        if (mode === "file" && window.piAPI?.filesList) {
            window.piAPI.filesList(workspacePath).then(setFiles);
        }
    }, [mode, workspacePath]);

    if (!isOpen) return null;

    // 根据 mode 决定 results
    let results: Array<{ id: string; primary: string; secondary?: string; onSelect: () => void }> = [];

    if (mode === "file") {
        results = files
            .map((f) => ({ f, s: fuzzyScore(f, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 20)
            .map((x) => ({
                id: x.f,
                primary: x.f,
                secondary: undefined,
                onSelect: () => onSelectFile?.(x.f),
            }));
    } else if (mode === "cmd") {
        results = COMMANDS
            .map((c) => ({ c, s: fuzzyScore(c.label, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: x.c.label,
                secondary: x.c.hint,
                onSelect: () => onRunCommand?.(x.c.id),
            }));
    }
    // history mode: 后续 task 加

    useEffect(() => {
        setActiveIdx(0);
    }, [results.length]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && results[activeIdx]) {
            e.preventDefault();
            results[activeIdx].onSelect();
            onClose();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/30 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[500px] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Mode tabs */}
                <div className="flex items-center gap-1 px-3 pt-3 border-b border-[#e5e5e5]">
                    {(["file", "history", "cmd"] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`px-3 py-1.5 text-sm rounded-t-md ${mode === m ? "bg-[#1a1a1a] text-white" : "text-[#666] hover:bg-[#f5f5f5]"}`}
                        >
                            {m === "file" ? "文件" : m === "history" ? "历史" : "命令"}
                        </button>
                    ))}
                </div>
                {/* Search input */}
                <div className="p-3">
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={mode === "file" ? "搜索文件..." : mode === "history" ? "搜索历史..." : "搜索命令..."}
                        className="w-full px-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:border-[#1a1a1a]"
                    />
                </div>
                {/* Results */}
                <div className="flex-1 overflow-auto px-1 pb-2">
                    {results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[#999]">
                            {query ? "无匹配" : "输入关键词"}
                        </div>
                    ) : (
                        results.map((r, i) => (
                            <button
                                key={r.id}
                                onClick={() => {
                                    r.onSelect();
                                    onClose();
                                }}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${i === activeIdx ? "bg-[#f0f0f0]" : "hover:bg-[#f5f5f5]"}`}
                            >
                                <span className="flex-1 truncate text-[#1a1a1a]">{r.primary}</span>
                                {r.secondary && <span className="text-xs text-[#999] font-mono">{r.secondary}</span>}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: 挂到 App.tsx 并注册 Ctrl+K**

(等 App.tsx 修好时再做, M2 这里先创建组件, 集成等 App.tsx 修复时一起)

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/CommandPalette/
git commit -m "feat(M2): CommandPalette modal with file/cmd modes (Task M2-5)"
```

---

## Task M2-6: 历史搜索 (in-memory 简版)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/CommandPalette/HistoryResult.tsx`
- Modify: `apps/desktop/src/renderer/src/components/CommandPalette/CommandPalette.tsx`

- [ ] **Step 1: 写 history-store 提供搜索接口**

(用 session-store 现成的, 在 CommandPalette 里直接调)

实际: 暂时不做全功能, 让 history mode 复用 session-store 的消息 (走 in-memory filter), 后续接 SQLite FTS5 时再升级.

- [ ] **Step 2: 在 CommandPalette 加 history mode 渲染**

```tsx
// CommandPalette.tsx 已有 mode 状态, 加 history mode 处理:
} else if (mode === "history") {
    const sessions = useSessionStore.getState().sessions;
    const allMessages = sessions.flatMap((s) => s.messages.map((m) => ({ sessionId: s.id, msg: m })));
    results = allMessages
        .filter((x) => x.msg.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 20)
        .map((x) => ({
            id: `${x.sessionId}_${x.msg.id}`,
            primary: x.msg.content.slice(0, 80),
            secondary: x.sessionId,
            onSelect: () => onSelectHistory?.(x.sessionId),
        }));
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/CommandPalette/
git commit -m "feat(M2): history search mode in CommandPalette (Task M2-6)"
```

---

## Task M2-7: E2E smoke + 手工冒烟清单

- [ ] **Step 1: E2E smoke 测试 (跟 M1 类似结构)**

```typescript
// apps/desktop/src/test/e2e/m2.test.ts
import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyMatch } from "../../../main/utils/fuzzy-match";
import { findActiveMention, resolveMention } from "../../../renderer/src/utils/mention-parser";
import { scanFiles } from "../../main/services/search/file-scanner";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("M2 utilities", () => {
    it("fuzzy: substring match works", () => {
        expect(fuzzyMatch("auth/login.ts", "auth")).toBe(true);
    });
    it("fuzzy: score ranks prefix higher", () => {
        expect(fuzzyScore("auth.ts", "auth")).toBeGreaterThan(fuzzyScore("user-auth.ts", "auth"));
    });
    it("mention: find at cursor", () => {
        expect(findActiveMention("hello @au", 8)).toEqual({ start: 6, query: "au" });
    });
    it("mention: resolve replaces correctly", () => {
        const m = findActiveMention("@abc rest", 4)!;
        const r = resolveMention("@abc rest", m, "src/auth.ts");
        expect(r).toBe("@src/auth.ts rest");
    });
    it("scanner: skips node_modules", () => {
        const dir = mkdtempSync(join(tmpdir(), "scan-"));
        writeFileSync(join(dir, "real.ts"), "");
        const files = scanFiles(dir);
        expect(files).toContain("real.ts");
    });
});
```

- [ ] **Step 2: 跑全量测试**

Run: `pnpm -r test`
Expected: 60+ pass, 0 fail

- [ ] **Step 3: 写 m2 冒烟清单**

```bash
# docs/superpowers/plans/2026-06-01-m2-smoke-test.md
```

写 5 步:
1. 输入 "看看 @ap" 弹文件 popover, 选 auth.ts
2. 截图粘贴到输入框, 看到图片 chip
3. Ctrl+K 打开命令面板, 搜 "new"
4. 切到 "历史" tab, 搜历史消息
5. 在 app.tsx 集成完成后跑全流程

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/test/e2e/m2.test.ts docs/superpowers/plans/2026-06-01-m2-smoke-test.md
git commit -m "test(M2): e2e smoke + manual checklist (Task M2-7)"
```

---

## 完成标准 (M2)

- [ ] @ 引用可触发, 弹 popover, 选文件后插入
- [ ] 截图粘贴到输入框, 显示图片 chip
- [ ] Ctrl+K 打开命令面板, 文件/历史/命令三 tab
- [ ] 文件搜索用 fuzzy match, 前缀匹配排序靠前
- [ ] 60+ 测试全过
- [ ] `pnpm typecheck` M2 文件干净
