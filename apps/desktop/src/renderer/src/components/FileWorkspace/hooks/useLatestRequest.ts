import { useCallback, useMemo, useRef } from "react";

/**
 * Generic race-condition protection hook for async requests.
 *
 * Tracks the latest in-flight request so stale responses can be ignored.
 * Usage:
 *   const req = useLatestRequest();
 *   const id = req.begin();          // mark a new request as latest
 *   const result = await fetch(...);
 *   if (!req.isLatest(id)) return;   // ignore stale responses
 *   req.cancel();                    // invalidate all in-flight requests
 *
 * Each instantiation has independent state — instantiate once per
 * independent async operation that needs stale-response protection.
 * The returned object is referentially stable so it is safe to use as a
 * dependency of `useCallback` / `useEffect`.
 */
export function useLatestRequest() {
  const seqRef = useRef(0);
  const latestRef = useRef(0);
  const begin = useCallback(() => {
    const id = ++seqRef.current;
    latestRef.current = id;
    return id;
  }, []);
  const isLatest = useCallback((id: number) => id === latestRef.current, []);
  const cancel = useCallback(() => {
    latestRef.current = -1;
  }, []);
  return useMemo(() => ({ begin, isLatest, cancel }), [begin, isLatest, cancel]);
}
