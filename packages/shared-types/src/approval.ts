// 审批相关的类型 (Task 2)
// 用于 main process ↔ renderer 通信

/** 风险分层 */
export type RiskLevel = "high" | "edit" | "read";

/** 高危工具的预审批请求 (M1 通过 IPC 推 renderer) */
export interface ApprovalRequest {
    /** 唯一 id, 用于关联响应 */
    requestId: string;
    method: "confirm" | "select";
    title: string;
    message?: string;
}

/** Renderer 对审批的响应 */
export interface ApprovalResponse {
    requestId: string;
    approved: boolean;
}

/** file_edit 类工具的延迟审批 (工具已执行, 事后给用户看 diff) */
export interface DeferredEdit {
    changeId: string;
    toolCallId: string;
    filePath: string;
    op: "write" | "edit";
    /** 所属 workspace, 撤销时用于解析绝对路径 */
    workspaceId: string;
    timestamp: number;
}

/** 工具执行完后的 review 事件 (含 diff) */
export interface FileReview {
    changeId: string;
    toolCallId: string;
    filePath: string;
    /** 所属 workspace, 撤销时用于解析绝对路径 */
    workspaceId: string;
    /** unified diff */
    diff: string;
    /** 新内容 (供 reviewer 完整查看) */
    newContent: string;
    /**
     * 变更前文件内容快照 (工具调用开始前读取):
     * string = 原文件内容; null = 原文件不存在 (撤销 = 删除新建文件);
     * undefined = 未记录 (无法撤销)
     */
    oldContent?: string | null;
    timestamp: number;
}

/** Renderer 请求撤销一笔 deferred edit 变更 */
export interface ApprovalUndoRequest {
    workspaceId: string;
    changeId: string;
}

/** Renderer 请求保留一笔 deferred edit 变更 */
export interface ApprovalKeepRequest {
    workspaceId: string;
    changeId: string;
}

/** 撤销完成通知 */
export interface ApprovalUndone {
    workspaceId: string;
    changeId: string;
    filePath: string;
}
