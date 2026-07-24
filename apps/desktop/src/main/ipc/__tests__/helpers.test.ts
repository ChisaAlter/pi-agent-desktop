import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock("electron-log/main", () => ({
  default: {
    error: logError,
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  setupSessionImporterIpc,
  withAction,
  withPiDriver,
  withUpdaterAction,
  withValidation,
} from "../helpers";
import { isIpcError } from "@shared";

describe("ipc helpers", () => {
  beforeEach(() => {
    handlers.clear();
    logError.mockClear();
  });

  describe("withValidation", () => {
    const schema = z.object({ name: z.string() });
    const opts = {
      invalidErrorKey: "err.invalid",
      invalidFallback: "invalid",
      failedErrorKey: "err.failed",
      failedLabel: "failed",
      logTag: "test",
    };

    it("returns invalid ipcError when schema fails", async () => {
      const result = await withValidation(schema, { name: 1 }, opts, async () => "ok");
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("err.invalid");
        expect(result.fallback).toBe("invalid");
      }
    });

    it("returns action result on success", async () => {
      await expect(
        withValidation(schema, { name: "x" }, opts, async (parsed) => parsed.name.toUpperCase()),
      ).resolves.toBe("X");
    });

    it("maps action throw to failed ipcError with context", async () => {
      const result = await withValidation(
        schema,
        { name: "x" },
        { ...opts, context: { id: "1" } },
        async () => {
          throw new Error("boom");
        },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("err.failed");
        expect(result.fallback).toContain("boom");
        expect(result.params).toEqual({ id: "1" });
      }
      expect(logError).toHaveBeenCalled();
    });
  });

  describe("withAction / withUpdaterAction", () => {
    it("returns success and maps failures", async () => {
      await expect(
        withAction(async () => 42, {
          failedErrorKey: "e",
          failedLabel: "L",
          logTag: "t",
        }),
      ).resolves.toBe(42);

      const fail = await withAction(
        async () => {
          throw "nope";
        },
        { failedErrorKey: "e", failedLabel: "L", logTag: "t" },
      );
      expect(isIpcError(fail)).toBe(true);
      if (isIpcError(fail)) {
        expect(fail.fallback).toBe("L: nope");
      }

      const up = await withUpdaterAction(
        async () => {
          throw new Error("net");
        },
        { errorKey: "up", label: "check", logTag: "u" },
      );
      expect(isIpcError(up)).toBe(true);
      if (isIpcError(up)) {
        expect(up.code).toBe("up");
        expect(up.fallback).toContain("net");
      }
    });
  });

  describe("withPiDriver", () => {
    it("returns driverNotInitialized when getter is null", async () => {
      const result = await withPiDriver(
        () => null,
        { failedErrorKey: "f", failedLabel: "L", logTag: "t" },
        async () => "ok",
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("ipcErrors.pi.driverNotInitialized");
      }
    });

    it("runs action with driver and maps throws", async () => {
      const driver = { id: "d" } as never;
      await expect(
        withPiDriver(
          () => driver,
          { failedErrorKey: "f", failedLabel: "L", logTag: "t" },
          async (d) => d,
        ),
      ).resolves.toBe(driver);

      const fail = await withPiDriver(
        () => driver,
        { failedErrorKey: "f", failedLabel: "L", logTag: "t" },
        async () => {
          throw new Error("x");
        },
      );
      expect(isIpcError(fail)).toBe(true);
      if (isIpcError(fail)) {
        expect(fail.fallback).toContain("x");
      }
    });
  });

  describe("setupSessionImporterIpc", () => {
    it("registers scan and import handlers that call the importer", async () => {
      const importer = {
        scan: vi.fn(async (p: string) => ({ p, kind: "scan" })),
        import: vi.fn(async (p: string, sources: string[]) => ({ p, sources })),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("claude-sessions", importer, scanSchema, importSchema);

      expect(handlers.has("claude-sessions:scan")).toBe(true);
      expect(handlers.has("claude-sessions:import")).toBe(true);

      const scan = handlers.get("claude-sessions:scan")!;
      await expect(scan({}, "C:/ws")).resolves.toEqual({ p: "C:/ws", kind: "scan" });

      const imp = handlers.get("claude-sessions:import")!;
      await expect(imp({}, "C:/ws", ["a.jsonl"])).resolves.toEqual({
        p: "C:/ws",
        sources: ["a.jsonl"],
      });
    });

    // wave-93 residual — setupSessionImporterIpc uses schema.parse() and lets throws surface
    it("throws ZodError on scan/import schema failures (parse, not ipcError wrap)", async () => {
      const importer = {
        scan: vi.fn(async () => ({ ok: true })),
        import: vi.fn(async () => ({ ok: true })),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("codex-sessions", importer, scanSchema, importSchema);

      const scan = handlers.get("codex-sessions:scan")!;
      await expect(scan({}, 123)).rejects.toThrow();
      const imp = handlers.get("codex-sessions:import")!;
      await expect(imp({}, "C:/ws", "not-array")).rejects.toThrow();
      expect(importer.scan).not.toHaveBeenCalled();
      expect(importer.import).not.toHaveBeenCalled();
    });

    it("propagates importer throws (no withAction wrap)", async () => {
      const importer = {
        scan: vi.fn(async () => {
          throw new Error("disk full");
        }),
        import: vi.fn(async () => ({ ok: true })),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("claude-sessions", importer, scanSchema, importSchema);
      const scan = handlers.get("claude-sessions:scan")!;
      await expect(scan({}, "C:/ws")).rejects.toThrow(/disk full/i);
    });
  });

  // wave-93 residual
  describe("withValidation residual", () => {
    it("passes through non-Error throws with stringified message", async () => {
      const schema = z.object({ n: z.number() });
      const result = await withValidation(
        schema,
        { n: 1 },
        {
          invalidErrorKey: "i",
          invalidFallback: "bad",
          failedErrorKey: "f",
          failedLabel: "label",
          logTag: "t",
        },
        async () => {
          throw "plain-string-fail";
        },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.fallback).toContain("plain-string-fail");
      }
    });
  });

  // wave-117 residual
  describe("withValidation / withAction residual", () => {
    it("does not invoke action when schema fails", async () => {
      const schema = z.object({ name: z.string() });
      const action = vi.fn(async () => "ok");
      const result = await withValidation(
        schema,
        { name: 1 },
        {
          invalidErrorKey: "err.invalid",
          invalidFallback: "invalid",
          failedErrorKey: "err.failed",
          failedLabel: "failed",
          logTag: "test",
        },
        action,
      );
      expect(isIpcError(result)).toBe(true);
      expect(action).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it("omits params when context is not provided on failure", async () => {
      const schema = z.object({ n: z.number() });
      const result = await withValidation(
        schema,
        { n: 1 },
        {
          invalidErrorKey: "i",
          invalidFallback: "bad",
          failedErrorKey: "f",
          failedLabel: "label",
          logTag: "t",
        },
        async () => {
          throw new Error("x");
        },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.params).toBeUndefined();
      }
    });

    it("withUpdaterAction returns success without logging", async () => {
      await expect(
        withUpdaterAction(async () => ({ ok: true }), {
          errorKey: "up",
          label: "check",
          logTag: "u",
        }),
      ).resolves.toEqual({ ok: true });
      expect(logError).not.toHaveBeenCalled();
    });

    it("withPiDriver does not run action when driver is null", async () => {
      const action = vi.fn(async () => "ok");
      const result = await withPiDriver(
        () => null,
        { failedErrorKey: "f", failedLabel: "L", logTag: "t" },
        action,
      );
      expect(isIpcError(result)).toBe(true);
      expect(action).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("setupSessionImporterIpc residual", () => {
    it("registers independent handlers per prefix without overwriting", async () => {
      const claude = {
        scan: vi.fn(async () => ({ kind: "claude" })),
        import: vi.fn(async () => ({ kind: "claude-import" })),
      };
      const codex = {
        scan: vi.fn(async () => ({ kind: "codex" })),
        import: vi.fn(async () => ({ kind: "codex-import" })),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("claude-sessions", claude, scanSchema, importSchema);
      setupSessionImporterIpc("codex-sessions", codex, scanSchema, importSchema);

      await expect(handlers.get("claude-sessions:scan")!({}, "C:/a")).resolves.toEqual({ kind: "claude" });
      await expect(handlers.get("codex-sessions:scan")!({}, "C:/b")).resolves.toEqual({ kind: "codex" });
      expect(claude.scan).toHaveBeenCalledWith("C:/a");
      expect(codex.scan).toHaveBeenCalledWith("C:/b");
    });

    it("passes full sourcePaths array to import handler", async () => {
      const importer = {
        scan: vi.fn(async () => ({})),
        import: vi.fn(async (_p: string, sources: string[]) => sources),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("codex-sessions", importer, scanSchema, importSchema);
      const imp = handlers.get("codex-sessions:import")!;
      await expect(imp({}, "C:/ws", ["a", "b", "c"])).resolves.toEqual(["a", "b", "c"]);
    });
  });

  // wave-145 residual
  describe("ipc helpers residual (wave-145)", () => {
    it("withValidation passes parsed data and context params on failure", async () => {
      const schema = z.object({ id: z.string(), n: z.number() });
      const result = await withValidation(
        schema,
        { id: "ws-1", n: 3 },
        {
          invalidErrorKey: "i",
          invalidFallback: "bad",
          failedErrorKey: "f",
          failedLabel: "failed",
          logTag: "tag",
          context: { workspaceId: "ws-1", attempt: 2 },
        },
        async (parsed) => {
          expect(parsed).toEqual({ id: "ws-1", n: 3 });
          throw new Error("write failed");
        },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("f");
        expect(result.fallback).toContain("write failed");
        expect(result.params).toEqual({ workspaceId: "ws-1", attempt: 2 });
      }
      expect(logError).toHaveBeenCalled();
    });

    it("withAction stringifies non-Error throws", async () => {
      const result = await withAction(
        async () => {
          throw 404;
        },
        { failedErrorKey: "e", failedLabel: "L", logTag: "t" },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.fallback).toBe("L: 404");
      }
    });

    it("withPiDriver success returns action value and logs nothing", async () => {
      const driver = { id: "pi" } as never;
      await expect(
        withPiDriver(
          () => driver,
          { failedErrorKey: "f", failedLabel: "L", logTag: "t" },
          async (d) => {
            expect(d).toBe(driver);
            return "ready";
          },
        ),
      ).resolves.toBe("ready");
      expect(logError).not.toHaveBeenCalled();
    });

    it("setupSessionImporterIpc throws on invalid scan args via schema.parse", async () => {
      const importer = {
        scan: vi.fn(async () => ({})),
        import: vi.fn(async () => ({})),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("claude-sessions", importer, scanSchema, importSchema);
      const scan = handlers.get("claude-sessions:scan")!;
      await expect(scan({}, 123)).rejects.toThrow();
      expect(importer.scan).not.toHaveBeenCalled();
    });
  });

  // wave-204 residual
  describe("ipc helpers residual (wave-204)", () => {
    it("withValidation does not invoke action when schema fails and omits params", async () => {
      const action = vi.fn(async () => "never");
      const result = await withValidation(
        z.object({ id: z.string() }),
        { id: 1 },
        {
          invalidErrorKey: "bad",
          invalidFallback: "invalid args",
          failedErrorKey: "fail",
          failedLabel: "F",
          logTag: "t",
        },
        action,
      );
      expect(action).not.toHaveBeenCalled();
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("bad");
        expect(result.fallback).toBe("invalid args");
        expect(result.params).toBeUndefined();
      }
      expect(logError).not.toHaveBeenCalled();
    });

    it("withUpdaterAction stringifies non-Error throws with label prefix", async () => {
      const result = await withUpdaterAction(
        async () => {
          throw "offline";
        },
        { errorKey: "up.e", label: "检查更新失败", logTag: "updater" },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("up.e");
        expect(result.fallback).toBe("检查更新失败: offline");
      }
      expect(logError).toHaveBeenCalled();
    });

    it("withPiDriver stringifies non-Error throws when driver present", async () => {
      const result = await withPiDriver(
        () => ({ id: "d" } as never),
        { failedErrorKey: "pi.f", failedLabel: "驱动失败", logTag: "pi" },
        async () => {
          throw { code: 7 };
        },
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("pi.f");
        expect(result.fallback).toBe("驱动失败: [object Object]");
      }
    });

    it("setupSessionImporterIpc import rejects invalid second arg and does not call importer", async () => {
      const importer = {
        scan: vi.fn(async () => ({})),
        import: vi.fn(async () => ({})),
      };
      const scanSchema = z.tuple([z.string()]);
      const importSchema = z.tuple([z.string(), z.array(z.string())]);
      setupSessionImporterIpc("codex-sessions", importer, scanSchema, importSchema);
      const imp = handlers.get("codex-sessions:import")!;
      await expect(imp({}, "C:/ws", "not-array")).rejects.toThrow();
      expect(importer.import).not.toHaveBeenCalled();
      // valid path still works after failed parse
      await expect(imp({}, "C:/ws", ["one"])).resolves.toEqual({});
      expect(importer.import).toHaveBeenCalledWith("C:/ws", ["one"]);
    });
  });

  // wave-320 residual
  describe("ipc helpers residual (wave-320)", () => {
    it("withValidation returns invalid without calling action; success returns action result", async () => {
      const schema = z.object({ n: z.number() });
      const action = vi.fn(async (p: { n: number }) => p.n * 2);
      const bad = await withValidation(
        schema,
        { n: "x" },
        {
          invalidErrorKey: "v.invalid",
          invalidFallback: "bad args",
          failedErrorKey: "v.failed",
          failedLabel: "op failed",
          logTag: "v",
        },
        action,
      );
      expect(isIpcError(bad)).toBe(true);
      if (isIpcError(bad)) {
        expect(bad.code).toBe("v.invalid");
        expect(bad.fallback).toBe("bad args");
      }
      expect(action).not.toHaveBeenCalled();
      await expect(
        withValidation(
          schema,
          { n: 3 },
          {
            invalidErrorKey: "v.invalid",
            invalidFallback: "bad args",
            failedErrorKey: "v.failed",
            failedLabel: "op failed",
            logTag: "v",
          },
          action,
        ),
      ).resolves.toBe(6);
      expect(action).toHaveBeenCalledTimes(1);
    });

    it("withPiDriver returns Chinese driverNotInitialized when null; does not call action", async () => {
      const action = vi.fn(async () => "x");
      const result = await withPiDriver(
        () => null,
        { failedErrorKey: "pi.f", failedLabel: "驱动失败", logTag: "pi" },
        action,
      );
      expect(isIpcError(result)).toBe(true);
      if (isIpcError(result)) {
        expect(result.code).toBe("ipcErrors.pi.driverNotInitialized");
        expect(result.fallback).toBe("PiDriver 尚未初始化");
      }
      expect(action).not.toHaveBeenCalled();
    });

    it("withAction and withUpdaterAction prefix labels on Error throws", async () => {
      const a = await withAction(
        async () => {
          throw new Error("disk full");
        },
        { failedErrorKey: "a.f", failedLabel: "操作失败", logTag: "a" },
      );
      expect(isIpcError(a)).toBe(true);
      if (isIpcError(a)) {
        expect(a.code).toBe("a.f");
        expect(a.fallback).toBe("操作失败: disk full");
      }
      const u = await withUpdaterAction(
        async () => {
          throw new Error("timeout");
        },
        { errorKey: "u.e", label: "检查应用更新失败", logTag: "u" },
      );
      expect(isIpcError(u)).toBe(true);
      if (isIpcError(u)) {
        expect(u.code).toBe("u.e");
        expect(u.fallback).toBe("检查应用更新失败: timeout");
      }
    });
  });

});
