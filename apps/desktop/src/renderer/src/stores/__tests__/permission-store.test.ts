import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionUiRequest } from "@shared";
import {
  cleanupPermissionSubscriptions,
  ensurePermissionSubscriptions,
  usePermissionStore,
} from "../permission-store";

function req(id: string): ExtensionUiRequest {
  return {
    requestId: id,
    kind: "confirm",
    source: "permission",
    title: `Approve ${id}`,
    message: "run tool?",
    createdAt: Date.now(),
  };
}

describe("permission-store", () => {
  beforeEach(() => {
    cleanupPermissionSubscriptions();
    usePermissionStore.setState({ mode: "smart", pending: [] });
    vi.unstubAllGlobals();
  });

  it("setMode updates local state and calls piAPI", () => {
    const permissionSetMode = vi.fn(async () => undefined);
    vi.stubGlobal("window", { piAPI: { permissionSetMode } });
    usePermissionStore.getState().setMode("ask");
    expect(usePermissionStore.getState().mode).toBe("ask");
    expect(permissionSetMode).toHaveBeenCalledWith("ask");
  });

  it("enqueue dedupes by requestId", () => {
    usePermissionStore.getState().enqueue(req("r1"));
    usePermissionStore.getState().enqueue(req("r1"));
    usePermissionStore.getState().enqueue(req("r2"));
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["r1", "r2"]);
  });

  it("respond sends decision and dismisses", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("r1"));
    usePermissionStore.getState().respond("r1", "allow_once");
    expect(permissionRespond).toHaveBeenCalledWith("r1", {
      requestId: "r1",
      decision: "allow_once",
    });
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("respondValue sends value and dismisses", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("r9"));
    usePermissionStore.getState().respondValue("r9", "yes");
    expect(permissionRespond).toHaveBeenCalledWith("r9", { requestId: "r9", value: "yes" });
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("respond no-ops for unknown request ids", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().respond("missing", "deny");
    expect(permissionRespond).not.toHaveBeenCalled();
  });

  it("ensurePermissionSubscriptions enqueues pushed requests once", () => {
    const handlers: Array<(request: ExtensionUiRequest) => void> = [];
    const off = vi.fn();
    vi.stubGlobal("window", {
      piAPI: {
        onPermissionRequest: (handler: (request: ExtensionUiRequest) => void) => {
          handlers.push(handler);
          return off;
        },
      },
    });
    ensurePermissionSubscriptions();
    ensurePermissionSubscriptions(); // idempotent
    expect(handlers).toHaveLength(1);
    handlers[0]?.(req("from-event"));
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    cleanupPermissionSubscriptions();
    expect(off).toHaveBeenCalled();
  });

  // wave-95 residual
  it("dismiss removes only the matching pending request", () => {
    usePermissionStore.getState().enqueue(req("a"));
    usePermissionStore.getState().enqueue(req("b"));
    usePermissionStore.getState().dismiss("a");
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["b"]);
  });

  it("respondValue no-ops for unknown request ids", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().respondValue("missing", true);
    expect(permissionRespond).not.toHaveBeenCalled();
  });

  it("setMode still updates local state when piAPI is missing", () => {
    vi.stubGlobal("window", {});
    usePermissionStore.getState().setMode("always");
    expect(usePermissionStore.getState().mode).toBe("always");
  });

  it("respond swallows permissionRespond throw and still dismisses", () => {
    const permissionRespond = vi.fn(() => {
      throw new Error("webContents gone");
    });
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("r-throw"));
    expect(() => usePermissionStore.getState().respond("r-throw", "deny")).not.toThrow();
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("ensurePermissionSubscriptions is a no-op without onPermissionRequest", () => {
    vi.stubGlobal("window", { piAPI: {} });
    expect(() => ensurePermissionSubscriptions()).not.toThrow();
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  // wave-121 residual
  it("enqueue dedupes by requestId without reordering earlier entries", () => {
    usePermissionStore.getState().enqueue(req("first"));
    usePermissionStore.getState().enqueue(req("second"));
    usePermissionStore.getState().enqueue(req("first"));
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("respondValue dismisses after delivering value", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("val-1"));
    usePermissionStore.getState().respondValue("val-1", "yes");
    expect(permissionRespond).toHaveBeenCalledWith("val-1", {
      requestId: "val-1",
      value: "yes",
    });
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("respond allow/deny payload shape includes decision", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("dec-1"));
    usePermissionStore.getState().respond("dec-1", "allow");
    expect(permissionRespond).toHaveBeenCalledWith("dec-1", {
      requestId: "dec-1",
      decision: "allow",
    });
  });

  it("default mode is smart until setMode", () => {
    vi.stubGlobal("window", { piAPI: { permissionSetMode: vi.fn(async () => undefined) } });
    expect(usePermissionStore.getState().mode).toBe("smart");
    usePermissionStore.getState().setMode("ask");
    expect(usePermissionStore.getState().mode).toBe("ask");
  });

  // wave-127 residual
  it("respondValue no-ops for unknown request ids", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().respondValue("missing", "x");
    expect(permissionRespond).not.toHaveBeenCalled();
  });

  it("dismiss removes only the matching pending request", () => {
    usePermissionStore.getState().enqueue(req("a"));
    usePermissionStore.getState().enqueue(req("b"));
    usePermissionStore.getState().dismiss("a");
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["b"]);
  });

  // wave-135 residual
  it("enqueue is idempotent for the same requestId", () => {
    const first = req("same");
    const second = { ...req("same"), toolName: "other" } as ReturnType<typeof req>;
    usePermissionStore.getState().enqueue(first);
    usePermissionStore.getState().enqueue(second);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    expect(usePermissionStore.getState().pending[0]).toBe(first);
  });

  it("respond no-ops for unknown ids and dismisses after successful respond", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().respond("missing", "deny");
    expect(permissionRespond).not.toHaveBeenCalled();
    usePermissionStore.getState().enqueue(req("r1"));
    usePermissionStore.getState().respond("r1", "deny");
    expect(permissionRespond).toHaveBeenCalledWith("r1", {
      requestId: "r1",
      decision: "deny",
    });
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("respond still dismisses when permissionRespond throws", () => {
    const permissionRespond = vi.fn(() => {
      throw new Error("ipc dead");
    });
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("r-throw"));
    expect(() => usePermissionStore.getState().respond("r-throw", "allow")).not.toThrow();
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  // wave-148 residual
  it("respondValue still dismisses when permissionRespond throws", () => {
    const permissionRespond = vi.fn(() => {
      throw new Error("ipc dead");
    });
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("v-throw"));
    expect(() => usePermissionStore.getState().respondValue("v-throw", true)).not.toThrow();
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("setMode still updates local state when piAPI is missing", () => {
    vi.stubGlobal("window", {});
    usePermissionStore.getState().setMode("always");
    expect(usePermissionStore.getState().mode).toBe("always");
  });

  it("respondValue supports boolean values", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().enqueue(req("bool-1"));
    usePermissionStore.getState().respondValue("bool-1", false);
    expect(permissionRespond).toHaveBeenCalledWith("bool-1", {
      requestId: "bool-1",
      value: false,
    });
    expect(usePermissionStore.getState().pending).toEqual([]);
  });

  it("ensurePermissionSubscriptions without unsubscribe return is still cleanup-safe", () => {
    const handlers: Array<(request: ExtensionUiRequest) => void> = [];
    vi.stubGlobal("window", {
      piAPI: {
        onPermissionRequest: (handler: (request: ExtensionUiRequest) => void) => {
          handlers.push(handler);
          return undefined;
        },
      },
    });
    ensurePermissionSubscriptions();
    expect(handlers).toHaveLength(1);
    handlers[0]?.(req("no-off"));
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["no-off"]);
    expect(() => cleanupPermissionSubscriptions()).not.toThrow();
  });

  // wave-245 residual
  it("setMode still updates local state when permissionSetMode rejects", async () => {
    const permissionSetMode = vi.fn(async () => {
      throw new Error("mode ipc down");
    });
    vi.stubGlobal("window", { piAPI: { permissionSetMode } });
    usePermissionStore.getState().setMode("ask");
    expect(usePermissionStore.getState().mode).toBe("ask");
    expect(permissionSetMode).toHaveBeenCalledWith("ask");
    // allow rejection to settle without unhandled rejection
    await Promise.resolve();
  });

  it("respondValue no-ops for unknown ids; dismiss alone removes without IPC", () => {
    const permissionRespond = vi.fn();
    vi.stubGlobal("window", { piAPI: { permissionRespond } });
    usePermissionStore.getState().respondValue("ghost", "x");
    expect(permissionRespond).not.toHaveBeenCalled();
    usePermissionStore.getState().enqueue(req("d1"));
    usePermissionStore.getState().enqueue(req("d2"));
    usePermissionStore.getState().dismiss("d1");
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["d2"]);
    usePermissionStore.getState().dismiss("missing");
    expect(usePermissionStore.getState().pending.map((p) => p.requestId)).toEqual(["d2"]);
    expect(permissionRespond).not.toHaveBeenCalled();
  });

  it("ensurePermissionSubscriptions no-ops without onPermissionRequest; cleanup is safe", () => {
    vi.stubGlobal("window", { piAPI: {} });
    expect(() => ensurePermissionSubscriptions()).not.toThrow();
    expect(() => cleanupPermissionSubscriptions()).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => ensurePermissionSubscriptions()).not.toThrow();
  });
});
