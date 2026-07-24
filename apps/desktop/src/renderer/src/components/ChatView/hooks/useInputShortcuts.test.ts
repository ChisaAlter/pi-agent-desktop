// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { UseMentionsReturn } from "../../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../../hooks/useSlashCommands";
import { useInputShortcuts } from "./useInputShortcuts";

type TestKeyboardEvent = Partial<ReactKeyboardEvent<HTMLTextAreaElement>> & {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: Partial<KeyboardEvent>;
};

function makeEvent(
  partial: TestKeyboardEvent = {},
): ReactKeyboardEvent<HTMLTextAreaElement> {
  return {
    key: "Enter",
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    ...partial,
  } as unknown as ReactKeyboardEvent<HTMLTextAreaElement>;
}

function emptyMention(overrides: Partial<UseMentionsReturn> = {}): UseMentionsReturn {
  return {
    activeMention: null,
    candidates: [],
    highlightIndex: 0,
    setHighlightIndex: vi.fn(),
    selectCandidate: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function emptySlash(overrides: Partial<UseSlashCommandsReturn> = {}): UseSlashCommandsReturn {
  return {
    activeCommand: null,
    candidates: [],
    highlightIndex: 0,
    setHighlightIndex: vi.fn(),
    selectCandidate: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe("useInputShortcuts (D-003)", () => {
  const baseOptions = {
    mention: emptyMention(),
    slash: emptySlash(),
    setInputValue: vi.fn(),
    textareaRef: { current: null as HTMLTextAreaElement | null },
    setCursorPos: vi.fn(),
    submit: vi.fn(),
  };

  it("Enter without Shift submits and prevents default", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({ key: "Enter", shiftKey: false });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter does not submit and does not preventDefault (newline falls through)", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({ key: "Enter", shiftKey: true });
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores key-repeat Enter to avoid accidental double submit", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({ key: "Enter", shiftKey: false, repeat: true });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("navigates mention candidates with ArrowDown/Up and clamps bounds", () => {
    const setHighlightIndex = vi.fn();
    const mention = emptyMention({
      activeMention: { start: 0, query: "ab" },
      candidates: [
        { path: "a.ts", score: 1 },
        { path: "b.ts", score: 0.5 },
        { path: "c.ts", score: 0.2 },
      ],
      highlightIndex: 1,
      setHighlightIndex,
    });
    const handler = useInputShortcuts({ ...baseOptions, mention });

    handler(makeEvent({ key: "ArrowDown" }));
    expect(setHighlightIndex).toHaveBeenCalledTimes(1);
    const downFn = setHighlightIndex.mock.calls[0][0] as (i: number) => number;
    expect(downFn(1)).toBe(2);
    expect(downFn(2)).toBe(2); // clamp at last index

    handler(makeEvent({ key: "ArrowUp" }));
    const upFn = setHighlightIndex.mock.calls[1][0] as (i: number) => number;
    expect(upFn(1)).toBe(0);
    expect(upFn(0)).toBe(0); // clamp at 0
  });

  it("Enter/Tab selects mention candidate and updates input + cursor", () => {
    vi.useFakeTimers();
    const setInputValue = vi.fn();
    const setCursorPos = vi.fn();
    const selectCandidate = vi.fn(() => "@src/app.ts ");
    const close = vi.fn();
    const textarea = {
      setSelectionRange: vi.fn(),
    } as unknown as HTMLTextAreaElement;
    const mention = emptyMention({
      activeMention: { start: 0, query: "" },
      candidates: [{ path: "src/app.ts", score: 1 }],
      highlightIndex: 0,
      selectCandidate,
      close,
    });
    const submit = vi.fn();
    const handler = useInputShortcuts({
      ...baseOptions,
      mention,
      setInputValue,
      setCursorPos,
      textareaRef: { current: textarea },
      submit,
    });

    const event = makeEvent({ key: "Enter" });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(selectCandidate).toHaveBeenCalledWith({ path: "src/app.ts", score: 1 });
    expect(setInputValue).toHaveBeenCalledWith("@src/app.ts ");
    expect(close).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(12, 12);
    expect(setCursorPos).toHaveBeenCalledWith(12);
    vi.useRealTimers();
  });

  it("Escape closes active mention without submitting", () => {
    const close = vi.fn();
    const mention = emptyMention({
      activeMention: { start: 0, query: "x" },
      candidates: [{ path: "x.ts", score: 1 }],
      close,
    });
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, mention, submit });
    const event = makeEvent({ key: "Escape" });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("navigates slash candidates and selects on Tab", () => {
    const setHighlightIndex = vi.fn();
    const selectCandidate = vi.fn(() => "/help ");
    const setInputValue = vi.fn();
    const slash = emptySlash({
      activeCommand: { start: 0, end: 5, query: "hel" },
      candidates: [
        {
          command: {
            name: "help",
            description: "Show help",
            source: "builtin",
          },
          score: 1,
        },
      ],
      highlightIndex: 0,
      setHighlightIndex,
      selectCandidate,
    });
    const handler = useInputShortcuts({
      ...baseOptions,
      mention: emptyMention(),
      slash,
      setInputValue,
    });

    handler(makeEvent({ key: "ArrowDown" }));
    expect(setHighlightIndex).toHaveBeenCalled();

    const tab = makeEvent({ key: "Tab" });
    handler(tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(selectCandidate).toHaveBeenCalled();
    expect(setInputValue).toHaveBeenCalledWith("/help ");
  });

  it("Escape closes slash popup when mention is inactive", () => {
    const close = vi.fn();
    const slash = emptySlash({
      activeCommand: { start: 0, end: 3, query: "h" },
      candidates: [
        {
          command: { name: "help", description: "", source: "builtin" },
          score: 1,
        },
      ],
      close,
    });
    const handler = useInputShortcuts({
      ...baseOptions,
      mention: emptyMention(),
      slash,
    });
    const event = makeEvent({ key: "Escape" });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("mention takes priority over slash when both active", () => {
    const mentionClose = vi.fn();
    const slashClose = vi.fn();
    const mention = emptyMention({
      activeMention: { start: 0, query: "a" },
      candidates: [{ path: "a.ts", score: 1 }],
      close: mentionClose,
    });
    const slash = emptySlash({
      activeCommand: { start: 0, end: 2, query: "a" },
      candidates: [
        {
          command: { name: "ask", description: "", source: "builtin" },
          score: 1,
        },
      ],
      close: slashClose,
    });
    const handler = useInputShortcuts({ ...baseOptions, mention, slash });
    handler(makeEvent({ key: "Escape" }));
    expect(mentionClose).toHaveBeenCalled();
    expect(slashClose).not.toHaveBeenCalled();
  });

  // wave-136 residual — D-003 IME / composition
  it("does not submit or preventDefault while React isComposing is true", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({ key: "Enter", shiftKey: false, isComposing: true });
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit while nativeEvent.isComposing is true", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      nativeEvent: { isComposing: true } as unknown as KeyboardEvent,
    });
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not submit on legacy IME keyCode 229 even without isComposing flag", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      keyCode: 229,
    });
    handler(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits after composition ends (isComposing false, keyCode not 229)", () => {
    const submit = vi.fn();
    const handler = useInputShortcuts({ ...baseOptions, submit });
    const event = makeEvent({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
    });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("mention Enter still selects candidate even if isComposing is true", () => {
    // Active popup takes priority over IME-submit guard so Tab/Enter can confirm @mentions.
    const selectCandidate = vi.fn(() => "@a.ts ");
    const submit = vi.fn();
    const mention = emptyMention({
      activeMention: { start: 0, query: "a" },
      candidates: [{ path: "a.ts", score: 1 }],
      selectCandidate,
      close: vi.fn(),
    });
    const handler = useInputShortcuts({ ...baseOptions, mention, submit });
    const event = makeEvent({ key: "Enter", isComposing: true });
    handler(event);
    expect(selectCandidate).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
