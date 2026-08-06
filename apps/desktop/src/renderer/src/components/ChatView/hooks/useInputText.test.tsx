// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useInputText } from "./useInputText";

function Probe() {
  const { textareaRef, inputValue, setInputValue } = useInputText();
  return (
    <div>
      <textarea
        ref={textareaRef}
        data-testid="composer"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
      />
      <button type="button" data-testid="seed" onClick={() => setInputValue("line1\nline2\nline3")}>
        seed
      </button>
      <span data-testid="value">{inputValue}</span>
    </div>
  );
}

describe("useInputText", () => {
  it("starts empty and updates from typing", () => {
    render(<Probe />);
    const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
    expect(ta.value).toBe("");
    fireEvent.change(ta, { target: { value: "hello" } });
    expect(screen.getByTestId("value").textContent).toBe("hello");
    expect(ta.value).toBe("hello");
  });

  it("accepts programmatic setInputValue and keeps the ref attached", () => {
    render(<Probe />);
    act(() => {
      fireEvent.click(screen.getByTestId("seed"));
    });
    const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
    expect(ta.value).toBe("line1\nline2\nline3");
    // auto-height layout effect ran; jsdom may leave height as auto or a px value
    expect(ta.style.height === "auto" || /px$/.test(ta.style.height)).toBe(true);
  });

  it("clears the inline height when auto sizing is disabled", () => {
    function FixedProbe() {
      const { textareaRef, inputValue, setInputValue } = useInputText({ autoSize: false });
      return (
        <>
          <textarea ref={textareaRef} data-testid="fixed-composer" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
          <button type="button" data-testid="fixed-seed" onClick={() => setInputValue("long\ntext")}>seed</button>
        </>
      );
    }

    render(<FixedProbe />);
    act(() => {
      fireEvent.click(screen.getByTestId("fixed-seed"));
    });

    expect((screen.getByTestId("fixed-composer") as HTMLTextAreaElement).style.height).toBe("");
  });

  it("re-applies auto height when switching from fixed back to auto sizing", () => {
    function ToggleProbe({ autoSize }: { autoSize: boolean }) {
      const { textareaRef, inputValue, setInputValue } = useInputText({ autoSize });
      return (
        <>
          <textarea
            ref={textareaRef}
            data-testid="toggle-composer"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="button" data-testid="toggle-seed" onClick={() => setInputValue("line1\nline2\nline3\nline4")}>seed</button>
        </>
      );
    }

    const { rerender } = render(<ToggleProbe autoSize />);
    const ta = screen.getByTestId("toggle-composer") as HTMLTextAreaElement;
    act(() => {
      fireEvent.click(screen.getByTestId("toggle-seed"));
    });
    // auto 模式: layout effect 写入高度
    expect(/px$/.test(ta.style.height)).toBe(true);

    rerender(<ToggleProbe autoSize={false} />);
    expect(ta.style.height).toBe("");

    rerender(<ToggleProbe autoSize />);
    expect(/px$/.test(ta.style.height)).toBe(true);
  });

  it("resets the inline height after clearing a long draft in auto mode", () => {
    function ClearProbe() {
      const { textareaRef, inputValue, setInputValue } = useInputText();
      return (
        <>
          <textarea
            ref={textareaRef}
            data-testid="clear-composer"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="button" data-testid="clear-seed" onClick={() => setInputValue("a\n".repeat(30))}>seed</button>
          <button type="button" data-testid="clear-reset" onClick={() => setInputValue("")}>reset</button>
        </>
      );
    }

    render(<ClearProbe />);
    const ta = screen.getByTestId("clear-composer") as HTMLTextAreaElement;
    act(() => {
      fireEvent.click(screen.getByTestId("clear-seed"));
    });
    const tallHeight = ta.style.height;
    expect(tallHeight).not.toBe("");
    act(() => {
      fireEvent.click(screen.getByTestId("clear-reset"));
    });
    // jsdom 无真实布局: scrollHeight 归零 → 高度回落 (可能 "0px" 或 "auto")
    expect(ta.style.height === "auto" || ta.style.height === "0px" || ta.style.height === "").toBe(true);
  });
});
