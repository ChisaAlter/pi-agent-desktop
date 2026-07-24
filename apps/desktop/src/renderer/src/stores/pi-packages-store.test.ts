import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePiPackagesStore } from "./pi-packages-store";

function resetStore(): void {
  usePiPackagesStore.setState({
    query: "",
    results: [],
    installed: [],
    loading: false,
    installedLoading: false,
    actionSource: null,
    error: null,
    retryAction: null,
    lastFailedAction: null,
    lastAction: null,
  });
}

describe("pi-packages-store", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the latest package search results when older network responses finish later", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const packagesSearch = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    (globalThis as { window: unknown }).window = {
      piAPI: { packagesSearch },
    };

    usePiPackagesStore.getState().setQuery("old");
    const first = usePiPackagesStore.getState().search();
    usePiPackagesStore.getState().setQuery("new");
    const second = usePiPackagesStore.getState().search();

    resolveSecond([
      { name: "new-result", source: "npm:new-result", description: "new", url: "https://pi.dev/packages/new-result" },
    ]);
    await second;
    expect(usePiPackagesStore.getState().results.map((item) => item.name)).toEqual(["new-result"]);
    expect(usePiPackagesStore.getState().loading).toBe(false);

    resolveFirst([
      { name: "old-result", source: "npm:old-result", description: "old", url: "https://pi.dev/packages/old-result" },
    ]);
    await first;

    expect(packagesSearch).toHaveBeenNthCalledWith(1, "old");
    expect(packagesSearch).toHaveBeenNthCalledWith(2, "new");
    expect(usePiPackagesStore.getState().results.map((item) => item.name)).toEqual(["new-result"]);
    expect(usePiPackagesStore.getState().loading).toBe(false);
  });

  it("records failed install context so retry UI can name the source", async () => {
    (globalThis as { window: unknown }).window = {
      piAPI: {
        packagesInstall: vi.fn(async () => ({
          code: "ipcErrors.packages.installFailed",
          fallback: "安装失败: network unavailable",
        })),
      },
    };

    await usePiPackagesStore.getState().install("npm:pi-git");

    expect(usePiPackagesStore.getState().error).toBe("安装失败: network unavailable");
    expect(usePiPackagesStore.getState().lastFailedAction).toEqual({
      kind: "install",
      source: "npm:pi-git",
      label: "安装",
    });
    expect(usePiPackagesStore.getState().retryAction).toBeTruthy();
  });

  it("clears stale failed action context when a later search succeeds", async () => {
    usePiPackagesStore.setState({
      error: "old",
      lastFailedAction: { kind: "install", source: "npm:pi-git", label: "安装" },
      retryAction: async () => undefined,
    });
    (globalThis as { window: unknown }).window = {
      piAPI: {
        packagesSearch: vi.fn(async () => [
          { name: "pi-git", source: "npm:pi-git", description: "Git", url: "https://pi.dev/packages/pi-git" },
        ]),
      },
    };

    await usePiPackagesStore.getState().search();

    expect(usePiPackagesStore.getState().error).toBeNull();
    expect(usePiPackagesStore.getState().lastFailedAction).toBeNull();
    expect(usePiPackagesStore.getState().results).toHaveLength(1);
  });

  it("leaves marketplace loading state when package search never resolves", async () => {
    vi.useFakeTimers();
    (globalThis as { window: unknown }).window = {
      piAPI: {
        packagesSearch: vi.fn(() => new Promise(() => undefined)),
      },
      setTimeout,
    };

    const search = usePiPackagesStore.getState().search();
    expect(usePiPackagesStore.getState().loading).toBe(true);

    await vi.advanceTimersByTimeAsync(25_000);
    await search;

    expect(usePiPackagesStore.getState().loading).toBe(false);
    expect(usePiPackagesStore.getState().results).toEqual([]);
    expect(usePiPackagesStore.getState().error).toBeNull();
  });


  // wave-230 residual
  it("setQuery only updates query without searching", () => {
    usePiPackagesStore.getState().setQuery("  pi-git ");
    expect(usePiPackagesStore.getState().query).toBe("  pi-git ");
    expect(usePiPackagesStore.getState().results).toEqual([]);
    expect(usePiPackagesStore.getState().loading).toBe(false);
  });

  it("successful install clears error and refreshes installed list", async () => {
    const packagesInstall = vi.fn(async () => ({ ok: true }));
    const packagesListInstalled = vi.fn(async () => [
      { name: "pi-git", source: "npm:pi-git", version: "1.0.0" },
    ]);
    // install success path also re-runs search() after refreshInstalled
    const packagesSearch = vi.fn(async () => [
      { name: "pi-git", source: "npm:pi-git", description: "Git", url: "https://pi.dev/packages/pi-git" },
    ]);
    (globalThis as { window: unknown }).window = {
      piAPI: { packagesInstall, packagesListInstalled, packagesSearch },
    };
    usePiPackagesStore.setState({
      error: "stale",
      lastFailedAction: { kind: "install", source: "npm:old", label: "安装" },
      query: "pi-git",
    });
    await usePiPackagesStore.getState().install("npm:pi-git");
    expect(packagesInstall).toHaveBeenCalledWith("npm:pi-git");
    expect(packagesListInstalled).toHaveBeenCalled();
    expect(packagesSearch).toHaveBeenCalled();
    expect(usePiPackagesStore.getState().error).toBeNull();
    expect(usePiPackagesStore.getState().lastFailedAction).toBeNull();
    expect(usePiPackagesStore.getState().actionSource).toBeNull();
    expect(usePiPackagesStore.getState().installed.map((p) => p.source)).toEqual(["npm:pi-git"]);
  });

  it("remove failure records lastFailedAction with remove kind", async () => {
    (globalThis as { window: unknown }).window = {
      piAPI: {
        packagesRemove: vi.fn(async () => ({
          code: "ipcErrors.packages.removeFailed",
          fallback: "卸载失败",
        })),
      },
    };
    await usePiPackagesStore.getState().remove("npm:pi-git");
    expect(usePiPackagesStore.getState().error).toBe("卸载失败");
    expect(usePiPackagesStore.getState().lastFailedAction).toEqual({
      kind: "remove",
      source: "npm:pi-git",
      label: "卸载",
    });
    expect(usePiPackagesStore.getState().retryAction).toBeTruthy();
  });
});
