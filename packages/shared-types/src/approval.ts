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
    timestamp: number;
}

/** 工具执行完后的 review 事件 (含 diff) */
export interface FileReview {
    changeId: string;
    toolCallId: string;
    filePath: string;
    /** unified diff */
    diff: string;
    /** 新内容 (供 reviewer 完整查看) */
    newContent: string;
    timestamp: number;
}
