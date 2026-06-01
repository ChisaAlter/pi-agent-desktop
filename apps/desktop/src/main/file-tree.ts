// File tree builder (M6-1 STUB)
// 完整实现推迟到 v1.1+ (递归 + ignore 规则)
//
// v1.0: 返回空 FileTreeNode, 不阻塞上层.

export interface FileTreeNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
    extension?: string;
    size?: number;
}

export function buildFileTree(workspacePath: string, _maxDepth: number): FileTreeNode {
    return {
        name: workspacePath.split(/[\\/]/).pop() ?? "",
        path: workspacePath,
        type: "directory",
        children: [],
    };
}
