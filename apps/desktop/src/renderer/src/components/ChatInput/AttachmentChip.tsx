// AttachmentChip (M2)
// 单个附件的可视化: file 模式显示文件名, image 模式显示缩略图

import type { Attachment } from "../../types/attachments";

interface AttachmentChipProps {
    attachment: Attachment;
    onRemove: (id: string) => void;
}

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps): JSX.Element {
    if (attachment.kind === "image") {
        return (
            <div className="inline-flex items-center gap-2 bg-white border border-[#e5e5e5] rounded-lg pl-1 pr-2 py-1">
                <img
                    src={attachment.value}
                    alt={attachment.name}
                    className="w-7 h-7 rounded object-cover"
                />
                <span className="text-xs text-[#1a1a1a] truncate max-w-[140px]" title={attachment.name}>
                    {attachment.name}
                </span>
                <button
                    onClick={() => onRemove(attachment.id)}
                    className="text-[#999] hover:text-[#ef4444] text-sm leading-none"
                    title="移除"
                >
                    ✕
                </button>
            </div>
        );
    }
    return (
        <div className="inline-flex items-center gap-2 bg-white border border-[#e5e5e5] rounded-lg px-2 py-1">
            <span className="text-sm">📄</span>
            <span className="text-xs text-[#1a1a1a] truncate max-w-[180px]" title={attachment.name}>
                {attachment.name}
            </span>
            <button
                onClick={() => onRemove(attachment.id)}
                className="text-[#999] hover:text-[#ef4444] text-sm leading-none"
                title="移除"
            >
                ✕
            </button>
        </div>
    );
}
