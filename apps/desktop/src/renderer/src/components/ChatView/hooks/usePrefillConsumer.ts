// Extracted from ChatInput.tsx (SubTask 26.2).
// Consumes an external prefill draft: appends it to the composer textarea
// without clobbering what the user already typed, focuses the textarea, and
// notifies the caller via onConsumed once the prefill has been applied.
// The onConsumedRef pattern avoids stale-closure issues when the parent
// re-renders between prefill updates. prefillKey drives re-runs even when
// the prefill string is identical to a previous application.

import { useEffect, useRef } from "react";

function mergePrefillDraft(current: string, incoming: string): string {
  const text = incoming.trim();
  if (!text) return current;
  const existing = current.trimEnd();
  if (!existing) return incoming;
  if (existing.includes(text)) return current;
  return `${existing} ${text}${incoming.endsWith(" ") ? " " : ""}`;
}

export function usePrefillConsumer(
  prefill: string | undefined,
  prefillKey: number | undefined,
  onConsumed: (() => void) | undefined,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  setInputValue: React.Dispatch<React.SetStateAction<string>>,
): void {
  const onConsumedRef = useRef(onConsumed);
  onConsumedRef.current = onConsumed;

  useEffect(() => {
    if (typeof prefill === "string" && prefill.length > 0) {
      setInputValue((current) => mergePrefillDraft(current, prefill));
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        const ta = textareaRef.current;
        if (ta) {
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      });
      onConsumedRef.current?.();
    }
    // prefillKey intentionally drives re-runs even when the prefill string is identical.
    // setInputValue / textareaRef / onConsumedRef are all stable identities.
  }, [prefill, prefillKey, setInputValue, textareaRef]);
}
