import React, { useState, useCallback } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import {
  exportSessionAsMarkdown,
  exportSessionAsJSON,
  exportSessionAsHTML,
  downloadFile,
} from "../../utils/export";

interface SessionExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
}

type ExportFormat = "markdown" | "json" | "html";

const formats: Array<{ value: ExportFormat; label: string; extension: string; mimeType: string }> = [
  { value: "markdown", label: "Markdown (.md)", extension: ".md", mimeType: "text/markdown" },
  { value: "json", label: "JSON (.json)", extension: ".json", mimeType: "application/json" },
  { value: "html", label: "HTML (.html)", extension: ".html", mimeType: "text/html" },
];

export function SessionExportDialog({ isOpen, onClose, sessionId }: SessionExportDialogProps): React.JSX.Element | null {
  const { sessions, ensureSessionLoaded } = useSessionStore();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("markdown");
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);

  const availableSessions = sessions.filter((s) => !s.archived);

  const handleExport = useCallback(async () => {
    const format = formats.find((f) => f.value === selectedFormat);
    if (!format) return;

    const targetIds = sessionId ? [sessionId] : selectedSessionIds;
    const sessionsToExport = (await Promise.all(targetIds.map((id) => ensureSessionLoaded(id))))
      .filter((item): item is Session => Boolean(item));

    for (const s of sessionsToExport) {
      let content: string;
      switch (selectedFormat) {
        case "markdown":
          content = exportSessionAsMarkdown(s);
          break;
        case "json":
          content = exportSessionAsJSON(s);
          break;
        case "html":
          content = exportSessionAsHTML(s);
          break;
        default:
          continue;
      }

      const filename = `${s.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_")}${format.extension}`;
      downloadFile(content, filename, format.mimeType);
    }

    onClose();
  }, [ensureSessionLoaded, onClose, selectedFormat, selectedSessionIds, sessionId]);

  const toggleSession = useCallback((id: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="导出会话"
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--mm-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--mm-text-primary)]">导出会话</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)]"
            aria-label="关闭"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-[var(--mm-text-secondary)]">导出格式</label>
            <div className="flex gap-2" role="group" aria-label="导出格式">
              {formats.map((format) => (
                <button
                  key={format.value}
                  type="button"
                  aria-pressed={selectedFormat === format.value}
                  onClick={() => setSelectedFormat(format.value)}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-accent-blue)] ${
                    selectedFormat === format.value
                      ? "border-[var(--mm-text-primary)] bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
                      : "border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
                  }`}
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>

          {!sessionId && (
            <div>
              <label className="mb-2 block text-xs font-medium text-[var(--mm-text-secondary)]">
                选择会话 ({selectedSessionIds.length} 已选择)
              </label>
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-[var(--mm-border)]">
                {availableSessions.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 border-b border-[var(--mm-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--mm-bg-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.includes(s.id)}
                      onChange={() => toggleSession(s.id)}
                      className="h-4 w-4 rounded border-[var(--mm-border)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--mm-text-primary)]">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">
                      {s.messageCount ?? s.messages.length} 条
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--mm-border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--mm-border)] px-4 py-2 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!sessionId && selectedSessionIds.length === 0}
            className="rounded-lg bg-[var(--mm-bg-active)] px-4 py-2 text-xs text-[var(--mm-text-on-active)] hover:opacity-90 disabled:opacity-50"
          >
            导出
          </button>
        </div>
      </div>
    </div>
  );
}
