// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMentions } from "./useMentions";

describe("useMentions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(window, "piAPI", {
      configurable: true,
      value: {
        filesList: vi.fn(async () => [
          { path: "src/app.ts", name: "app.ts", size: 1, isDirectory: false },
          { path: "src/utils/fuzzy-match.ts", name: "fuzzy-match.ts", size: 1, isDirectory: false },
          { path: "README.md", name: "README.md", size: 1, isDirectory: false },
        ]),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays inactive without @mention or workspace", async () => {
    const { result, rerender } = renderHook(
      ({ text, cursor, ws }) => useMentions(text, cursor, ws),
      { initialProps: { text: "hello", cursor: 5, ws: "C:/ws" as string | undefined } },
    );
    expect(result.current.activeMention).toBeNull();
    expect(result.current.candidates).toEqual([]);

    rerender({ text: "see @ap", cursor: 7, ws: undefined });
    expect(result.current.activeMention).toBeNull();
  });

  it("activates on @query and loads ranked candidates", async () => {
    const { result } = renderHook(() => useMentions("open @app", 9, "C:/ws"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(result.current.activeMention?.query).toBe("app");
      expect(result.current.candidates.length).toBeGreaterThan(0);
      expect(result.current.candidates[0]?.path).toContain("app");
    });
    expect(window.piAPI.filesList).toHaveBeenCalled();
  });

  it("selectCandidate replaces mention with path + trailing space", async () => {
    const { result } = renderHook(() => useMentions("open @app", 9, "C:/ws"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(result.current.activeMention).not.toBeNull();
    });
    const replaced = result.current.selectCandidate({ path: "src/app.ts", score: 100 });
    expect(replaced).toBe("open @src/app.ts ");
  });

  it("close clears active mention and candidates", async () => {
    const { result } = renderHook(() => useMentions("@re", 3, "C:/ws"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(result.current.activeMention).not.toBeNull();
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.activeMention).toBeNull();
    expect(result.current.candidates).toEqual([]);
    expect(result.current.highlightIndex).toBe(0);
  });

  it("clears candidates when filesList fails", async () => {
    Object.defineProperty(window, "piAPI", {
      configurable: true,
      value: {
        filesList: vi.fn(async () => {
          throw new Error("ipc down");
        }),
      },
    });
    const { result } = renderHook(() => useMentions("@x", 2, "C:/ws"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(result.current.activeMention?.query).toBe("x");
    });
    expect(result.current.candidates).toEqual([]);
  });

  it("ignores an older query response that resolves after the latest query", async () => {
    type Entry = { path: string; name: string; size: number; isDirectory: boolean };
    let resolveOld: ((entries: Entry[]) => void) | null = null;
    let resolveNew: ((entries: Entry[]) => void) | null = null;
    Object.defineProperty(window, "piAPI", {
      configurable: true,
      value: {
        filesList: vi.fn((_workspace: string, query: string) => new Promise<Entry[]>((resolve) => {
          if (query === "old") resolveOld = resolve;
          if (query === "new") resolveNew = resolve;
        })),
      },
    });
    const { result, rerender } = renderHook(
      ({ text, cursor }) => useMentions(text, cursor, "C:/ws"),
      { initialProps: { text: "@old", cursor: 4 } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    rerender({ text: "@new", cursor: 4 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    await act(async () => {
      resolveNew?.([{ path: "src/new.ts", name: "new.ts", size: 1, isDirectory: false }]);
      await Promise.resolve();
    });
    expect(result.current.candidates.map((candidate) => candidate.path)).toEqual(["src/new.ts"]);

    await act(async () => {
      resolveOld?.([{ path: "src/old.ts", name: "old.ts", size: 1, isDirectory: false }]);
      await Promise.resolve();
    });
    expect(result.current.candidates.map((candidate) => candidate.path)).toEqual(["src/new.ts"]);
  });

  it("ignores an older workspace response when the same query moves workspaces", async () => {
    type Entry = { path: string; name: string; size: number; isDirectory: boolean };
    let resolveFirstWorkspace: ((entries: Entry[]) => void) | null = null;
    let resolveSecondWorkspace: ((entries: Entry[]) => void) | null = null;
    Object.defineProperty(window, "piAPI", {
      configurable: true,
      value: {
        filesList: vi.fn((workspace: string) => new Promise<Entry[]>((resolve) => {
          if (workspace === "C:/first") resolveFirstWorkspace = resolve;
          if (workspace === "C:/second") resolveSecondWorkspace = resolve;
        })),
      },
    });
    const { result, rerender } = renderHook(
      ({ workspace }) => useMentions("@app", 4, workspace),
      { initialProps: { workspace: "C:/first" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    rerender({ workspace: "C:/second" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    await act(async () => {
      resolveSecondWorkspace?.([{ path: "second/app.ts", name: "app.ts", size: 1, isDirectory: false }]);
      await Promise.resolve();
    });
    expect(result.current.candidates.map((candidate) => candidate.path)).toEqual(["second/app.ts"]);

    await act(async () => {
      resolveFirstWorkspace?.([{ path: "first/app.ts", name: "app.ts", size: 1, isDirectory: false }]);
      await Promise.resolve();
    });
    expect(result.current.candidates.map((candidate) => candidate.path)).toEqual(["second/app.ts"]);
  });
});
