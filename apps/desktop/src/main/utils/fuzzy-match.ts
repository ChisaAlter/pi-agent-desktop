// Fuzzy 匹配 (M2 Task M2-2)
// 简单实现: 子串 (前缀分高) + 路径分隔段 + 驼峰首字母
// 给 @ mention popover 和 CommandPalette 共用

export function fuzzyMatch(text: string, query: string): boolean {
    return fuzzyScore(text, query) > 0;
}

export function fuzzyScore(text: string, query: string): number {
    if (!query) return 1;
    const tl = text.toLowerCase();
    const ql = query.toLowerCase();

    // 1. 子串匹配 (最强)
    const idx = tl.indexOf(ql);
    if (idx !== -1) {
        // 前缀最高分
        if (idx === 0) return 100;
        // 路径分隔符 (/) 后次高
        if (idx > 0 && (tl[idx - 1] === "/" || tl[idx - 1] === "\\" || tl[idx - 1] === "-")) return 75;
        // 其它子串
        return 50;
    }

    // 2. 顺序字符匹配 (支持驼峰首字母)
    let qi = 0;
    for (let i = 0; i < tl.length && qi < ql.length; i++) {
        if (tl[i] === ql[qi]) qi++;
    }
    if (qi === ql.length) {
        // 全字符都匹配
        return 25;
    }

    return 0;
}
