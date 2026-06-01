// 附件 store (M2)
// 按 workspace 隔离的附件列表, 用于 ChatInput 的 chip 渲染

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
