// 附件类型 (M2)

export type AttachmentKind = "file" | "image";

export interface Attachment {
    id: string;
    kind: AttachmentKind;
    /** 显示在 chip 上的名字 */
    name: string;
    /** 完整路径 (file) 或 dataURL (image) */
    value: string;
    /** image only: mime type */
    mimeType?: string;
    /** image only: 字节数 */
    size?: number;
}
