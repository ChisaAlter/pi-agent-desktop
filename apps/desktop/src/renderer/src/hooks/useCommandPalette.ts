// useCommandPalette (M2 Task M2-5)
// 全局 Ctrl+K 唤起命令面板的 hook

import { useEffect, useState } from "react";

export function useCommandPalette() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Ctrl+K 或 Cmd+K
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setIsOpen((v) => !v);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return { isOpen, setIsOpen, close: () => setIsOpen(false) };
}
