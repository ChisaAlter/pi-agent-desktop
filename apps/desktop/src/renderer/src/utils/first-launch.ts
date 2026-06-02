// localStorage 包装 — 失败时返回默认值，不抛错
//
// 用例：firstLaunch 标记、用户偏好（下次再做）。
// 失败场景：
//  - 隐私/无痕模式禁用 localStorage
//  - 配额满
//  - 浏览器上下文无效（罕见）
// 全部兜底为"未完成/默认值"，让用户至少能继续使用 app。

const STORAGE_KEY = "pi-desktop:firstLaunchDone";

/** 读 boolean key，解析失败或无 localStorage 时返回 fallback。 */
export function readBoolFlag(key: string, fallback: boolean): boolean {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return fallback;
        if (raw === "true" || raw === "1") return true;
        if (raw === "false" || raw === "0") return false;
        // 任何未知值 → fallback
        return fallback;
    } catch {
        return fallback;
    }
}

/** 写 boolean key；写失败不抛（静默忽略）。 */
export function writeBoolFlag(key: string, value: boolean): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
        window.localStorage.setItem(key, value ? "true" : "false");
    } catch {
        // ignore — quota / privacy mode
    }
}

/** 标记首启已完成（幂等）。 */
export function markFirstLaunchDone(): void {
    writeBoolFlag(STORAGE_KEY, true);
}

/** 是否需要展示首启引导。 */
export function isFirstLaunch(): boolean {
    return !readBoolFlag(STORAGE_KEY, false);
}
