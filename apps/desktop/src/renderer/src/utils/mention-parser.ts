// Mention 解析器 (M2 Task M2-2)
// 从输入框文本 + cursor 位置检测 @mention 状态

export interface MentionMatch {
    /** @ 字符在原文中的位置 */
    start: number;
    /** @ 之后到 cursor 的内容 (不含 @) */
    query: string;
}

/** 检测光标前是否在输入 @mention. 返回 match 或 null. */
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

/** 把 @query 替换为 @resolved-path (含 @). */
export function resolveMention(text: string, match: MentionMatch, filePath: string): string {
    return (
        text.slice(0, match.start) +
        "@" + filePath +
        text.slice(match.start + 1 + match.query.length)
    );
}
