// Extracted from ChatInput.tsx (SubTask 26.3).
// Centralizes the composer textarea keydown handler: @mention and slash-command
// candidate navigation (Up/Down/Enter/Tab/Esc) and Enter-to-submit.
// Shift+Enter falls through to the textarea's default newline behavior.

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { UseMentionsReturn } from "../../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../../hooks/useSlashCommands";

interface UseInputShortcutsOptions {
  mention: UseMentionsReturn;
  slash: UseSlashCommandsReturn;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setCursorPos: (pos: number) => void;
  submit: () => void;
}

export function useInputShortcuts(
  options: UseInputShortcutsOptions,
): (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void {
  const { mention, slash, setInputValue, textareaRef, setCursorPos, submit } = options;

  return (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention.activeMention && mention.candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mention.setHighlightIndex((i) => Math.min(i + 1, mention.candidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mention.setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = mention.candidates[mention.highlightIndex];
        if (selected) {
          const newText = mention.selectCandidate(selected);
          setInputValue(newText);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = newText.length;
              textareaRef.current.setSelectionRange(pos, pos);
              setCursorPos(pos);
            }
          });
          mention.close();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mention.close();
        return;
      }
    }

    if (!mention.activeMention && slash.activeCommand && slash.candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slash.setHighlightIndex((i) => Math.min(i + 1, slash.candidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slash.setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = slash.candidates[slash.highlightIndex];
        if (selected) {
          const newText = slash.selectCandidate(selected);
          setInputValue(newText);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = newText.length;
              textareaRef.current.setSelectionRange(pos, pos);
              setCursorPos(pos);
            }
          });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        slash.close();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return;
      void submit();
    }
  };
}
