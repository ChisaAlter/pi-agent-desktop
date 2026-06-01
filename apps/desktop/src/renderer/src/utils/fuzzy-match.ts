// Fuzzy 匹配 (M6-3: renderer-side copy, 等 v1.1 抽到 shared package)
// 简单实现: 子串 (前缀分高) + 路径分隔段 + 驼峰首字母
// 与 main/utils/fuzzy-match.ts 保持同步

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
        if (idx === 0) return 100;
        if (idx > 0 && (tl[idx - 1] === "/" || tl[idx - 1] === "\\" || tl[idx - 1] === "-")) return 75;
        return 50;
    }

    // 2. 顺序字符匹配
    let qi = 0;
    for (let i = 0; i < tl.length && qi < ql.length; i++) {
        if (tl[i] === ql[qi]) qi++;
    }
    if (qi === ql.length) return 25;

    return 0;
}
