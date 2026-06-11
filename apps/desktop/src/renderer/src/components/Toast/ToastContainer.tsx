import React, { useEffect } from "react";
import { useToastStore } from "../../stores/toast-store";

const toneStyles: Record<string, string> = {
  error: "bg-red-50 border-red-300 text-red-800",
  success: "bg-green-50 border-green-300 text-green-800",
  warning: "bg-yellow-50 border-yellow-300 text-yellow-800",
  info: "bg-blue-50 border-blue-300 text-blue-800",
};

const toneIcons: Record<string, string> = {
  error: "✕",
  success: "✓",
  warning: "⚠",
  info: "ℹ",
};

export function ToastContainer(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ReturnType<typeof useToastStore.getState>["toasts"][number];
  onDismiss: () => void;
}): React.ReactElement {
  useEffect(() => {
    if (!toast.duration) return;
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg text-sm ${toneStyles[toast.tone] ?? toneStyles.info}`}
    >
      <span className="flex-shrink-0 text-base leading-none">{toneIcons[toast.tone] ?? toneIcons.info}</span>
      <p className="flex-1 whitespace-pre-wrap break-words">{toast.message}</p>
      <div className="flex items-center gap-1 flex-shrink-0">
        {toast.retryAction && (
          <button
            onClick={() => { toast.retryAction?.(); onDismiss(); }}
            className="px-2 py-0.5 text-xs font-medium rounded hover:opacity-80 underline"
          >
            重试
          </button>
        )}
        <button
          onClick={onDismiss}
          className="px-1 py-0.5 text-xs rounded hover:opacity-80 opacity-60"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
