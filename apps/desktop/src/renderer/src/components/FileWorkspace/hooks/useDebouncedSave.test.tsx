// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedSave } from "./useDebouncedSave";

describe("useDebouncedSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save when filePath is null", () => {
    const onSave = vi.fn();
    renderHook(() => useDebouncedSave(null, "draft", onSave, 300));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves after delay when path and draft are set", () => {
    const onSave = vi.fn();
    renderHook(() => useDebouncedSave("a.ts", "hello", onSave, 300));
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("a.ts", "hello");
  });

  it("collapses rapid draft edits into a single save", () => {
    const onSave = vi.fn();
    const { rerender } = renderHook(
      ({ draft }) => useDebouncedSave("a.ts", draft, onSave, 200),
      { initialProps: { draft: "1" } },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ draft: "2" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ draft: "3" });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("a.ts", "3");
  });

  // wave-107 residual
  it("cancels pending save on unmount", () => {
    const onSave = vi.fn();
    const { unmount } = renderHook(() => useDebouncedSave("a.ts", "draft", onSave, 300));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("resets timer when filePath changes and saves latest path", () => {
    const onSave = vi.fn();
    const { rerender } = renderHook(
      ({ path, draft }) => useDebouncedSave(path, draft, onSave, 200),
      { initialProps: { path: "a.ts" as string | null, draft: "1" } },
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ path: "b.ts", draft: "2" });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("b.ts", "2");
  });
});
