// Extracted from ChatInput.tsx (SubTask 26.1).
// Owns the composer textarea ref, the current input value, and the
// auto-height adjustment. useLayoutEffect is used instead of useEffect so
// the textarea resizes before the new value paints, avoiding the visible
// flicker the previous useEffect-based implementation caused.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

const TEXTAREA_MAX_HEIGHT = 200;

export function useInputText(options: { autoSize?: boolean } = {}): {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
} {
  const { autoSize = true } = options;
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    }
  }, []);

  useLayoutEffect(() => {
    if (autoSize) {
      adjustTextareaHeight();
    } else if (textareaRef.current) {
      textareaRef.current.style.height = "";
    }
  }, [autoSize, inputValue, adjustTextareaHeight]);

  return { textareaRef, inputValue, setInputValue };
}
