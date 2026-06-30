// 附件 store (M2)
// 按 workspace 隔离的附件列表, 用于 ChatInput 的 chip 渲染

import { create } from "zustand";
import type { Attachment } from "../types/attachments";

interface AttachmentsState {
    byWorkspace: Record<string, Attachment[]>;
    add: (workspaceId: string, attachment: Attachment) => void;
    remove: (workspaceId: string, id: string) => void;
    clear: (workspaceId: string) => void;
    list: (workspaceId: string) => Attachment[];
}

export const useAttachmentsStore = create<AttachmentsState>((set, get) => ({
    byWorkspace: {},
    add: (workspaceId, attachment) => {
        set((s) => ({
            byWorkspace: {
                ...s.byWorkspace,
                [workspaceId]: [...(s.byWorkspace[workspaceId] ?? []), attachment],
            },
        }));
    },
    remove: (workspaceId, id) => {
        set((s) => ({
            byWorkspace: {
                ...s.byWorkspace,
                [workspaceId]: (s.byWorkspace[workspaceId] ?? []).filter((a) => a.id !== id),
            },
        }));
    },
    clear: (workspaceId) => {
        set((s) => {
            const next = { ...s.byWorkspace };
            delete next[workspaceId];
            return { byWorkspace: next };
        });
    },
    list: (workspaceId) => get().byWorkspace[workspaceId] ?? [],
}));
