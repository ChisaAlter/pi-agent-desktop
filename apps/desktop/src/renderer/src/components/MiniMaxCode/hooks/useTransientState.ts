import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State that auto-clears to `null` after a fixed duration. Each new value
 * resets the pending timer, so rapid successive calls only clear after the
 * most recent write. The timer is cleaned up on unmount.
 */
export function useTransientState<T>(duration: number) {
  const [value, setValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTransient = useCallback(
    (v: T | null) => {
      setValue(v);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (v !== null) {
        timerRef.current = setTimeout(() => setValue(null), duration);
      }
    },
    [duration],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return [value, setTransient] as const;
}
