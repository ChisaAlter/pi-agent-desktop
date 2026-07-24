import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const {
  searchPackagesMock,
  fetchPackageCatalogMock,
  listInstalledPackagesMock,
  installPackageMock,
  removePackageMock,
  updatePackageMock,
} = vi.hoisted(() => ({
  searchPackagesMock: vi.fn(),
  fetchPackageCatalogMock: vi.fn(),
  listInstalledPackagesMock: vi.fn(),
  installPackageMock: vi.fn(),
  removePackageMock: vi.fn(),
  updatePackageMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock("electron-log/main", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../services/pi-packages/pi-package-adapter", () => ({
  searchPackages: searchPackagesMock,
  fetchPackageCatalog: fetchPackageCatalogMock,
  listInstalledPackages: listInstalledPackagesMock,
  installPackage: installPackageMock,
  removePackage: removePackageMock,
  updatePackage: updatePackageMock,
}));

import { setupPackagesIpc } from "../packages.ipc";
import { isIpcError } from "@shared";

describe("setupPackagesIpc", () => {
  beforeEach(() => {
    handlers.clear();
    searchPackagesMock.mockReset();
    fetchPackageCatalogMock.mockReset();
    listInstalledPackagesMock.mockReset();
    installPackageMock.mockReset();
    removePackageMock.mockReset();
    updatePackageMock.mockReset();
    setupPackagesIpc();
  });

  it("registers all package channels", () => {
    for (const ch of [
      "packages:search",
      "packages:refresh-catalog",
      "packages:list-installed",
      "packages:install",
      "packages:remove",
      "packages:update",
    ]) {
      expect(handlers.has(ch)).toBe(true);
    }
  });

  it("search success and invalid query length", async () => {
    searchPackagesMock.mockResolvedValueOnce([{ name: "demo", source: "npm:demo" }]);
    await expect(handlers.get("packages:search")!({}, "demo")).resolves.toEqual([
      { name: "demo", source: "npm:demo" },
    ]);
    expect(searchPackagesMock).toHaveBeenCalledWith("demo");

    const tooLong = "x".repeat(257);
    const invalid = await handlers.get("packages:search")!({}, tooLong);
    expect(isIpcError(invalid)).toBe(true);
    if (isIpcError(invalid)) {
      expect(invalid.code).toBe("ipcErrors.packages.searchInvalid");
    }
    expect(searchPackagesMock).toHaveBeenCalledTimes(1);
  });

  it("search maps adapter rejection to searchFailed", async () => {
    searchPackagesMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await handlers.get("packages:search")!({}, "q");
    expect(isIpcError(result)).toBe(true);
    if (isIpcError(result)) {
      expect(result.code).toBe("ipcErrors.packages.searchFailed");
      expect(result.fallback).toContain("ENOTFOUND");
      expect(result.params).toEqual({ query: "q" });
    }
  });

  it("refresh-catalog and list-installed success + failure", async () => {
    fetchPackageCatalogMock.mockResolvedValueOnce([{ name: "a" }]);
    await expect(handlers.get("packages:refresh-catalog")!({})).resolves.toEqual([{ name: "a" }]);

    fetchPackageCatalogMock.mockRejectedValueOnce(new Error("catalog down"));
    const refreshFail = await handlers.get("packages:refresh-catalog")!({});
    expect(isIpcError(refreshFail)).toBe(true);
    if (isIpcError(refreshFail)) {
      expect(refreshFail.code).toBe("ipcErrors.packages.refreshFailed");
    }

    listInstalledPackagesMock.mockResolvedValueOnce([{ source: "npm:x" }]);
    await expect(handlers.get("packages:list-installed")!({})).resolves.toEqual([
      { source: "npm:x" },
    ]);

    listInstalledPackagesMock.mockRejectedValueOnce(new Error("list fail"));
    const listFail = await handlers.get("packages:list-installed")!({});
    expect(isIpcError(listFail)).toBe(true);
    if (isIpcError(listFail)) {
      expect(listFail.code).toBe("ipcErrors.packages.listFailed");
    }
  });

  it("install/remove/update success and invalid empty source", async () => {
    installPackageMock.mockResolvedValueOnce({ success: true, message: "ok", requiresRestart: true });
    await expect(handlers.get("packages:install")!({}, "npm:demo")).resolves.toMatchObject({
      success: true,
    });
    expect(installPackageMock).toHaveBeenCalledWith("npm:demo");

    removePackageMock.mockResolvedValueOnce({ success: true, message: "rm", requiresRestart: true });
    await expect(handlers.get("packages:remove")!({}, "npm:demo")).resolves.toMatchObject({
      success: true,
    });

    updatePackageMock.mockResolvedValueOnce({ success: true, message: "up", requiresRestart: true });
    await expect(handlers.get("packages:update")!({}, "npm:demo")).resolves.toMatchObject({
      success: true,
    });

    for (const ch of ["packages:install", "packages:remove", "packages:update"] as const) {
      const invalid = await handlers.get(ch)!({}, "");
      expect(isIpcError(invalid)).toBe(true);
      if (isIpcError(invalid)) {
        expect(invalid.code).toMatch(/Invalid$/);
      }
    }
  });

  it("install maps adapter rejection to installFailed", async () => {
    installPackageMock.mockRejectedValueOnce(new Error("pi install failed"));
    const result = await handlers.get("packages:install")!({}, "npm:demo");
    expect(isIpcError(result)).toBe(true);
    if (isIpcError(result)) {
      expect(result.code).toBe("ipcErrors.packages.installFailed");
      expect(result.fallback).toContain("pi install failed");
      expect(result.params).toEqual({ source: "npm:demo" });
    }
  });

  // wave-100 residual
  it("remove/update map adapter rejections to removeFailed/updateFailed", async () => {
    removePackageMock.mockRejectedValueOnce(new Error("unlink denied"));
    const removeResult = await handlers.get("packages:remove")!({}, "npm:demo");
    expect(isIpcError(removeResult)).toBe(true);
    if (isIpcError(removeResult)) {
      expect(removeResult.code).toBe("ipcErrors.packages.removeFailed");
      expect(removeResult.fallback).toContain("unlink denied");
      expect(removeResult.params).toEqual({ source: "npm:demo" });
    }

    updatePackageMock.mockRejectedValueOnce(new Error("etag mismatch"));
    const updateResult = await handlers.get("packages:update")!({}, "npm:demo");
    expect(isIpcError(updateResult)).toBe(true);
    if (isIpcError(updateResult)) {
      expect(updateResult.code).toBe("ipcErrors.packages.updateFailed");
      expect(updateResult.fallback).toContain("etag mismatch");
      expect(updateResult.params).toEqual({ source: "npm:demo" });
    }
  });

  it("search allows empty query but rejects non-string", async () => {
    searchPackagesMock.mockResolvedValueOnce([]);
    await expect(handlers.get("packages:search")!({}, "")).resolves.toEqual([]);
    expect(searchPackagesMock).toHaveBeenCalledWith("");

    const invalid = await handlers.get("packages:search")!({}, 42);
    expect(isIpcError(invalid)).toBe(true);
    if (isIpcError(invalid)) {
      expect(invalid.code).toBe("ipcErrors.packages.searchInvalid");
    }
  });
});
