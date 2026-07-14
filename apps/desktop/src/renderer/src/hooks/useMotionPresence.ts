import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MotionPresenceState = "enter" | "exit";

export interface MotionPresence {
  rendered: boolean;
  state: MotionPresenceState;
}

export interface MotionPresenceListItem<T> {
  item: T;
  state: MotionPresenceState;
}

export function useMotionPresence(open: boolean, exitMs: number): MotionPresence {
  const [retained, setRetained] = useState(open);

  useEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    const timer = setTimeout(() => setRetained(false), exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, open, retained]);

  return {
    rendered: open || retained,
    state: open ? "enter" : "exit",
  };
}

export function useMotionPresenceList<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  exitMs: number,
): MotionPresenceListItem<T>[] {
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const [presentItems, setPresentItems] = useState<MotionPresenceListItem<T>[]>(() => (
    items.map((item) => ({ item, state: "enter" }))
  ));

  useLayoutEffect(() => {
    setPresentItems((current) => {
      const nextByKey = new Map(items.map((item) => [getKeyRef.current(item), item]));
      const next: MotionPresenceListItem<T>[] = items.map((item) => ({ item, state: "enter" }));

      for (const entry of current) {
        const key = getKeyRef.current(entry.item);
        if (!nextByKey.has(key)) {
          next.push({ ...entry, state: "exit" });
        }
      }

      return next;
    });
  }, [items]);

  const hasExitingItems = presentItems.some((entry) => entry.state === "exit");
  useEffect(() => {
    if (!hasExitingItems) return;
    const timer = setTimeout(() => {
      setPresentItems((current) => current.filter((entry) => entry.state !== "exit"));
    }, exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, hasExitingItems]);

  return presentItems;
}
