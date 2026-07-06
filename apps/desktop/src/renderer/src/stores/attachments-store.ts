// 附件 store (M2)
// 按 workspace 隔离的附件列表, 用于 ChatInput 的 chip 渲染

import { create } from "zustand";
import type { Attachment } from "../types/attachments";

/** 单个 workspace 允许的最大附件数. 超限时拒绝添加, 避免无界增长. */
const MAX_ATTACHMENTS_PER_WORKSPACE = 20;

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
        // 上限保护: 单 workspace 不超过 MAX_ATTACHMENTS_PER_WORKSPACE, 避免内存膨胀
        const current = get().byWorkspace[workspaceId]?.length ?? 0;
        if (current >= MAX_ATTACHMENTS_PER_WORKSPACE) return;
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
