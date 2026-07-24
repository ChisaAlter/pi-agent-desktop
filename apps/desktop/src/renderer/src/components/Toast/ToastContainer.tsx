import React, { useEffect } from "react";
import { useMotionPresenceList, type MotionPresenceState } from "../../hooks/useMotionPresence";
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
  const presentToasts = useMotionPresenceList(toasts, (toast) => toast.id, 120);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {presentToasts.map(({ item: toast, state }) => (
        <ToastItem key={toast.id} toast={toast} motionState={state} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  motionState,
  onDismiss,
}: {
  toast: ReturnType<typeof useToastStore.getState>["toasts"][number];
  motionState: MotionPresenceState;
  onDismiss: () => void;
}): React.ReactElement {
  useEffect(() => {
    if (!toast.duration) return;
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-motion-state={motionState}
      className={`pi-motion-toast flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg text-sm ${toneStyles[toast.tone] ?? toneStyles.info}`}
    >
      <span className="flex-shrink-0 text-base leading-none">{toneIcons[toast.tone] ?? toneIcons.info}</span>
      <p className="flex-1 whitespace-pre-wrap break-words">{toast.message}</p>
      <div className="flex items-center gap-1 flex-shrink-0">
        {toast.retryAction && (
          <button
            type="button"
            onClick={() => { void toast.retryAction?.(); onDismiss(); }}
            className="rounded px-2 py-0.5 text-xs font-medium underline hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            重试
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭通知"
          className="rounded px-1 py-0.5 text-xs opacity-60 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
