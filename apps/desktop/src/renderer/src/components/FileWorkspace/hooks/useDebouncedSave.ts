import { useEffect, useRef } from "react";

/**
 * Debounced auto-save hook.
 *
 * Fires `onSave(filePath, draft)` after `delay` ms whenever `filePath` or
 * `draft` change. Pass `filePath = null` to disable saving (e.g. when
 * guards like view-mode or save-state prevent auto-save). The timer is
 * reset on every change to either input, so rapid edits collapse into a
 * single save.
 */
export function useDebouncedSave<T>(
  filePath: string | null,
  draft: T,
  onSave: (path: string, content: T) => void,
  delay = 700,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!filePath) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSave(filePath, draft);
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [filePath, draft, onSave, delay]);
}
