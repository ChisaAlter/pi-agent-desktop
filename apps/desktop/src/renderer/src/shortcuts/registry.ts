// 快捷键中央注册表 (M7+ 可用度-C)
// 单一数据源: 定义 SHORTCUTS, 提供 match / dispatch 工具
// 配合 useShortcuts() 在 App 顶层挂一个全局 keydown 监听, 全部走这里
//
// 设计要点:
// 1. SHORTCUTS 是只读数据, 任何 UI (cheatsheet / tooltip / 状态栏) 都从这里读
// 2. handlers 用 Map 持有, 组件 mount 时 register, unmount 时 unregister
// 3. ? / Shift+/ 视作同一动作, 两条记录 (显示用 ? , 主键 + 备用键)
// 4. 在 <input>/<textarea> 内容区时, 单字符快捷键 (?, Esc) 失效避免误触
//    但修饰键组合 (Ctrl+K 等) 仍生效
// 5. v1.0.4: category / label 用 i18n key, 由消费方 (cheatsheet 等) 调 t() 翻译

export type ShortcutCategoryKey = "nav" | "chat" | "panel" | "edit" | "help";

/** 修饰键 + 单键的匹配规则 (不区分大小写) */
export interface ShortcutCombo {
    /** 需要 Ctrl (Linux/Win) 或 Cmd (macOS) */
    mod?: boolean;
    shift?: boolean;
    alt?: boolean;
    /** 单字符, lowercase; '?' / ',' / '`' / '/' 也合法 */
    key: string;
}

export interface ShortcutDef {
    /** 唯一 id, 用于 dispatch & 注册 handler */
    id: string;
    /** 给人看的键位串, 例如 "Ctrl+K" / "?" / "Shift+/" */
    keys: string;
    /** i18n key (e.g. 'shortcuts.labels.open-command-palette') — 显示时 t() 翻译 */
    labelKey: string;
    category: ShortcutCategoryKey;
    /** 实际匹配 KeyboardEvent 的规则 */
    combo: ShortcutCombo;
    /** true 表示在 input/textarea 内不应触发 (默认 false 即修饰键组合总是生效) */
    ignoreInEditable?: boolean;
}

interface ShortcutOverride {
    id: string;
    keys: string;
}

const SHORTCUT_OVERRIDE_STORAGE_KEY = "pi-desktop-shortcut-overrides";

export const SHORTCUTS: readonly ShortcutDef[] = Object.freeze([
    {
        id: "open-command-palette",
        keys: "Ctrl+K",
        labelKey: "shortcuts.labels.open-command-palette",
        category: "nav",
        combo: { mod: true, key: "k" },
    },
    {
        id: "toggle-terminal",
        keys: "Ctrl+`",
        labelKey: "shortcuts.labels.toggle-terminal",
        category: "panel",
        combo: { mod: true, key: "`" },
    },
    {
        id: "open-settings",
        keys: "Ctrl+,",
        labelKey: "shortcuts.labels.open-settings",
        category: "panel",
        combo: { mod: true, key: "," },
    },
    {
        id: "new-chat",
        keys: "Ctrl+N",
        labelKey: "shortcuts.labels.new-chat",
        category: "chat",
        combo: { mod: true, key: "n" },
    },
    {
        id: "toggle-sidebar",
        keys: "Ctrl+B",
        labelKey: "shortcuts.labels.toggle-sidebar",
        category: "panel",
        combo: { mod: true, key: "b" },
    },
    {
        id: "show-shortcuts-question",
        keys: "?",
        labelKey: "shortcuts.labels.show-shortcuts-question",
        category: "help",
        combo: { shift: true, key: "?" },
        ignoreInEditable: true,
    },
    {
        id: "show-shortcuts-question",
        keys: "Shift+/",
        labelKey: "shortcuts.labels.show-shortcuts-question",
        category: "help",
        combo: { shift: true, key: "/" },
        ignoreInEditable: true,
    },
    {
        id: "close-overlay",
        keys: "Esc",
        labelKey: "shortcuts.labels.close-overlay",
        category: "edit",
        combo: { key: "escape" },
        ignoreInEditable: true,
    },
    {
        id: "search-history",
        keys: "Ctrl+Shift+F",
        labelKey: "shortcuts.labels.search-history",
        category: "nav",
        combo: { mod: true, shift: true, key: "f" },
    },
]);

function readShortcutOverrides(): Map<string, string> {
    const overrides = new Map<string, string>();
    if (typeof window === "undefined") return overrides;
    try {
        const raw = window.localStorage?.getItem(SHORTCUT_OVERRIDE_STORAGE_KEY);
        if (!raw) return overrides;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return overrides;
        for (const item of parsed) {
            if (!item || typeof item !== "object") continue;
            const override = item as Partial<ShortcutOverride>;
            if (typeof override.id === "string" && typeof override.keys === "string") {
                overrides.set(override.id, override.keys);
            }
        }
    } catch {
        return new Map<string, string>();
    }
    return overrides;
}

function normalizeDisplayKey(key: string): string {
    const trimmed = key.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "esc") return "escape";
    if (lower === "space") return " ";
    return trimmed.length === 1 ? trimmed.toLowerCase() : lower;
}

function parseShortcutKeys(keys: string): ShortcutCombo | null {
    const parts = keys.split("+").map((part) => part.trim()).filter(Boolean);
    const combo: ShortcutCombo = { key: "" };
    const keyParts: string[] = [];

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "meta" || lower === "mod") {
            combo.mod = true;
        } else if (lower === "shift") {
            combo.shift = true;
        } else if (lower === "alt" || lower === "option") {
            combo.alt = true;
        } else {
            keyParts.push(part);
        }
    }

    if (keyParts.length !== 1) return null;
    const key = normalizeDisplayKey(keyParts[0]);
    if (!key) return null;
    combo.key = key;
    if (key === "?" && combo.shift !== true) {
        combo.shift = true;
    }
    return combo;
}

/** Returns shortcuts with persisted key overrides applied for runtime matching/display. */
export function getEffectiveShortcuts(
    shortcuts: readonly ShortcutDef[] = SHORTCUTS,
): ShortcutDef[] {
    const overrides = readShortcutOverrides();
    if (overrides.size === 0) return [...shortcuts];
    return shortcuts.map((shortcut) => {
        const overrideKeys = overrides.get(shortcut.id);
        if (!overrideKeys) return shortcut;
        const combo = parseShortcutKeys(overrideKeys);
        if (!combo) return shortcut;
        return {
            ...shortcut,
            keys: overrideKeys,
            combo,
        };
    });
}

/** 按 category 分组, 顺序按固定枚举顺序稳定 */
export function groupByCategory(
    shortcuts: readonly ShortcutDef[],
): Array<{ category: ShortcutCategoryKey; items: ShortcutDef[] }> {
    const order: ShortcutCategoryKey[] = ["nav", "chat", "panel", "edit", "help"];
    const buckets = new Map<ShortcutCategoryKey, ShortcutDef[]>();
    for (const s of shortcuts) {
        if (!buckets.has(s.category)) buckets.set(s.category, []);
        buckets.get(s.category)!.push(s);
    }
    return order
        .filter((c) => buckets.has(c))
        .map((c) => ({ category: c, items: buckets.get(c)! }));
}

/** 单一 KeyboardEvent 是否命中 combo */
export function matchesCombo(e: KeyboardEvent, combo: ShortcutCombo): boolean {
    if (combo.mod) {
        if (!(e.ctrlKey || e.metaKey)) return false;
    } else {
        if (e.ctrlKey || e.metaKey) return false;
    }
    if (combo.shift) {
        if (!e.shiftKey) return false;
    } else {
        if (e.shiftKey) return false;
    }
    if (combo.alt) {
        if (!e.altKey) return false;
    } else {
        if (e.altKey) return false;
    }
    const want = combo.key.toLowerCase();
    const got = (e.key || "").toLowerCase();
    // Escape: 浏览器实际是 "Escape" (旧) 或 "Esc" (新), 都 normalize 到 "escape"
    const normalized = got === "esc" ? "escape" : got;
    return normalized === want;
}

/** target 是否在可编辑元素内 (input/textarea/contenteditable) */
function isEditableTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return false;
}

/** 在 SHORTCUTS 里找第一个命中当前事件的 shortcut (若有 ignoreInEditable 限制则跳过) */
export function findMatchingShortcut(e: KeyboardEvent): ShortcutDef | null {
    const editable = isEditableTarget(e.target);
    for (const s of getEffectiveShortcuts()) {
        if (s.ignoreInEditable && editable) continue;
        if (matchesCombo(e, s.combo)) return s;
    }
    return null;
}

/** 按 id 查 shortcut (用于 UI 显示) */
export function getShortcutById(id: string): ShortcutDef | undefined {
    return getEffectiveShortcuts().find((s) => s.id === id);
}

// ---- handler 注册 (模块级单例) -------------------------------------------

type Handler = () => void;
const handlers = new Map<string, Handler>();

/** 注册一个 handler, 返回 unregister 函数 */
export function registerShortcutHandler(id: string, handler: Handler): () => void {
    handlers.set(id, handler);
    return () => {
        // 仅当未被覆盖时才删, 避免后注册的 cleanup 把别人的 handler 拆掉
        if (handlers.get(id) === handler) handlers.delete(id);
    };
}

/** 模块级: 给一个 KeyboardEvent, 找到匹配 shortcut 并调用 handler. 返回是否触发了 */
export function dispatchShortcut(e: KeyboardEvent): boolean {
    const s = findMatchingShortcut(e);
    if (!s) return false;
    const h = handlers.get(s.id);
    if (!h) return false;
    e.preventDefault();
    h();
    return true;
}

/** 测试用: 清空所有 handler, 防止测试间串扰 */
export function __resetShortcutHandlersForTest(): void {
    handlers.clear();
}
