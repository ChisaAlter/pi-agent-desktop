import { useState, useEffect } from "react";
import { findActiveMention } from "../utils/mention-parser";

/** 跟踪输入框里活跃的 @mention 状态 */
export function useMentions(text: string, cursor: number) {
    const [activeMention, setActiveMention] = useState<{ start: number; query: string } | null>(null);

    useEffect(() => {
        setActiveMention(findActiveMention(text, cursor));
    }, [text, cursor]);

    return { activeMention, hasActive: !!activeMention };
}
