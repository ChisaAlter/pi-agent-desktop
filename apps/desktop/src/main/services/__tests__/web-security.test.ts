import { beforeEach, describe, expect, it, vi } from "vitest";

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  shell: { openExternal: openExternalMock },
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: false },
}));

vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn() },
}));

import {
  attachWebSecurityHandlers,
  isAllowedExternalUrl,
  isAllowedNavigationUrl,
} from "../web-security";

describe("web security URL policy", () => {
  beforeEach(() => {
    openExternalMock.mockClear();
  });

  it("only delegates HTTP and HTTPS URLs to the external browser", () => {
    expect(isAllowedExternalUrl("https://example.com/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/docs")).toBe(true);
    expect(isAllowedExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hello")).toBe(false);
    expect(isAllowedExternalUrl("custom-protocol://payload")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
  });

  it("allows only the current file document while ignoring query and hash", () => {
    const current = "file:///C:/app/renderer/index.html";
    expect(isAllowedNavigationUrl(`${current}?mode=chat#message-1`, current, false)).toBe(true);
    expect(isAllowedNavigationUrl("file:///C:/app/renderer/settings.html", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("file:///C:/Users/demo/Downloads/attacker.html", current, false)).toBe(false);
  });

  it("allows same-origin web navigation and blocks unsafe or cross-origin schemes", () => {
    const current = "https://app.example.com/index.html";
    expect(isAllowedNavigationUrl("https://app.example.com/settings", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("https://evil.example/settings", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("javascript:alert(1)", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("data:text/html,hello", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("custom-protocol://payload", current, false)).toBe(false);
  });

  it("allows localhost HTTP navigation only when the development exception is enabled", () => {
    expect(isAllowedNavigationUrl("http://localhost:5173/settings.html", "about:blank", true)).toBe(true);
    expect(isAllowedNavigationUrl("https://127.0.0.1:5173/settings.html", "about:blank", true)).toBe(true);
    expect(isAllowedNavigationUrl("http://localhost:5173/settings.html", "about:blank", false)).toBe(false);
  });

  it("denies Electron child windows and never opens blocked schemes externally", async () => {
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    const navigationListeners = new Map<string, (...args: unknown[]) => void>();
    const webContents = {
      getURL: vi.fn(() => "file:///C:/app/renderer/index.html"),
      setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
        openHandler = handler;
      }),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        navigationListeners.set(event, listener);
      }),
    };

    attachWebSecurityHandlers({ webContents } as never);

    expect(openHandler?.({ url: "file:///C:/Users/demo/Downloads/attacker.html" })).toEqual({ action: "deny" });
    expect(openExternalMock).not.toHaveBeenCalled();

    expect(openHandler?.({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
    await vi.waitFor(() => {
      expect(openExternalMock).toHaveBeenCalledWith("https://example.com/docs");
    });

    const preventDefault = vi.fn();
    navigationListeners.get("will-navigate")?.(
      { preventDefault },
      "file:///C:/Users/demo/Downloads/attacker.html",
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);

    const redirectPreventDefault = vi.fn();
    navigationListeners.get("will-redirect")?.(
      { preventDefault: redirectPreventDefault },
      "https://evil.example/redirected",
    );
    expect(redirectPreventDefault).toHaveBeenCalledTimes(1);
  });

  // wave-85 residual edges
  it("rejects mixed file/http navigation pairs", () => {
    expect(isAllowedNavigationUrl("https://example.com", "file:///C:/app/index.html", false)).toBe(false);
    expect(isAllowedNavigationUrl("file:///C:/app/index.html", "https://example.com", false)).toBe(false);
  });

  it("treats file paths case-insensitively on Windows style current documents", () => {
    const current = "file:///C:/App/Renderer/index.html";
    // same path different casing should still match when platform normalizes
    expect(isAllowedNavigationUrl("file:///C:/App/Renderer/index.html", current, false)).toBe(true);
  });

  it("blocks blank and malformed navigation targets", () => {
    expect(isAllowedNavigationUrl("", "https://app.example.com/", false)).toBe(false);
    expect(isAllowedNavigationUrl("not a url", "https://app.example.com/", false)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example.com/", "", false)).toBe(false);
  });

  it("does not treat private network hosts as external allow without http/https", () => {
    expect(isAllowedExternalUrl("ftp://192.168.1.1/file")).toBe(false);
    expect(isAllowedExternalUrl("ws://localhost:8080")).toBe(false);
    expect(isAllowedExternalUrl("wss://example.com/socket")).toBe(false);
  });

  it("allows same-origin path/query changes and blocks different ports as different origin", () => {
    const current = "https://app.example.com:443/index.html";
    expect(isAllowedNavigationUrl("https://app.example.com/settings?x=1", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("https://app.example.com:444/settings", current, false)).toBe(false);
  });

  // wave-94 residual
  it("blocks non-http external schemes including file/about/chrome", () => {
    expect(isAllowedExternalUrl("file:///C:/secret.txt")).toBe(false);
    expect(isAllowedExternalUrl("about:blank")).toBe(false);
    expect(isAllowedExternalUrl("chrome://settings")).toBe(false);
    expect(isAllowedExternalUrl("mailto:user@example.com")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com/ok")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/ok")).toBe(true);
  });

  it("allows 127.0.0.1 and localhost only with dev exception (non-file current)", () => {
    // mixed file↔http is hard-denied before the localhost exception (see isAllowedNavigationUrl)
    expect(isAllowedNavigationUrl("http://127.0.0.1:5173/", "file:///C:/app/index.html", true)).toBe(false);
    expect(isAllowedNavigationUrl("http://127.0.0.1:5173/", "about:blank", true)).toBe(true);
    expect(isAllowedNavigationUrl("http://localhost:5173/", "about:blank", true)).toBe(true);
    expect(isAllowedNavigationUrl("http://127.0.0.1:5173/", "about:blank", false)).toBe(false);
    expect(isAllowedNavigationUrl("http://192.168.0.2:5173/", "about:blank", true)).toBe(false);
  });

  it("allows file navigation when only the fragment/query differs", () => {
    const current = "file:///C:/App/Renderer/index.html";
    expect(isAllowedNavigationUrl("file:///C:/App/Renderer/index.html#section", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("file:///C:/App/Renderer/index.html?x=1", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("file:///C:/App/Renderer/other.html", current, false)).toBe(false);
  });

  // wave-111 residual
  it("treats http and https as different origins even on the same host", () => {
    expect(
      isAllowedNavigationUrl("http://app.example.com/path", "https://app.example.com/index.html", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("https://app.example.com/path", "http://app.example.com/index.html", false),
    ).toBe(false);
  });

  it("does not grant localhost exception to non-loopback hosts in dev", () => {
    expect(isAllowedNavigationUrl("http://0.0.0.0:5173/", "about:blank", true)).toBe(false);
    expect(isAllowedNavigationUrl("http://[::1]:5173/", "about:blank", true)).toBe(false);
    expect(isAllowedNavigationUrl("https://localhost:5173/", "http://127.0.0.1:1/", true)).toBe(true);
  });

  it("blocks external open for empty/malformed urls in handler path semantics", () => {
    expect(isAllowedExternalUrl("https://")).toBe(false);
    expect(isAllowedExternalUrl("http:")).toBe(false);
  });

  // wave-116 residual
  it("allows only http/https for external open and rejects file/data/js", () => {
    expect(isAllowedExternalUrl("https://example.com/a")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/a")).toBe(true);
    expect(isAllowedExternalUrl("file:///C:/x")).toBe(false);
    expect(isAllowedExternalUrl("data:text/plain,hi")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
  });

  it("blocks cross-origin https navigation without localhost exception", () => {
    expect(
      isAllowedNavigationUrl("https://evil.test/", "https://app.example.com/index.html", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("https://app.example.com/next", "https://app.example.com/index.html", false),
    ).toBe(true);
  });

  it("is case-insensitive for win32 file path comparison", () => {
    if (process.platform !== "win32") return;
    expect(
      isAllowedNavigationUrl(
        "file:///C:/App/Index.html",
        "file:///c:/app/index.html",
        false,
      ),
    ).toBe(true);
  });

  it("rejects invalid target or current URLs for navigation", () => {
    expect(isAllowedNavigationUrl("not-a-url", "https://app.example.com/", false)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example.com/", "not-a-url", false)).toBe(false);
  });

  // wave-126 residual
  it("does not call openExternal for blocked schemes and still denies window open", async () => {
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    const webContents = {
      getURL: vi.fn(() => "file:///C:/app/renderer/index.html"),
      setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
        openHandler = handler;
      }),
      on: vi.fn(),
    };
    attachWebSecurityHandlers({ webContents } as never);
    expect(openHandler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(openHandler?.({ url: "file:///C:/secret.txt" })).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("allows same-document will-navigate and blocks redirects off origin", () => {
    const navigationListeners = new Map<string, (...args: unknown[]) => void>();
    const current = "file:///C:/app/renderer/index.html";
    const webContents = {
      getURL: vi.fn(() => current),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        navigationListeners.set(event, listener);
      }),
    };
    attachWebSecurityHandlers({ webContents } as never);

    const allowPrevent = vi.fn();
    navigationListeners.get("will-navigate")?.(
      { preventDefault: allowPrevent },
      `${current}#chat`,
    );
    expect(allowPrevent).not.toHaveBeenCalled();

    const blockPrevent = vi.fn();
    navigationListeners.get("will-redirect")?.(
      { preventDefault: blockPrevent },
      "https://evil.example/",
    );
    expect(blockPrevent).toHaveBeenCalledTimes(1);
  });

  it("blocks dev localhost navigation when current is file even if exception enabled", () => {
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "file:///C:/app/index.html", true),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("https://127.0.0.1:5173/", "http://localhost:1/", true),
    ).toBe(true);
  });

  // wave-132 residual
  it("allows http openExternal and still denies the child window", async () => {
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    const webContents = {
      getURL: vi.fn(() => "file:///C:/app/renderer/index.html"),
      setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
        openHandler = handler;
      }),
      on: vi.fn(),
    };
    attachWebSecurityHandlers({ webContents } as never);
    expect(openHandler?.({ url: "http://example.com/docs" })).toEqual({ action: "deny" });
    await vi.waitFor(() => {
      expect(openExternalMock).toHaveBeenCalledWith("http://example.com/docs");
    });
  });

  it("rejects blob/vbscript external schemes and allows http with query/userinfo", () => {
    expect(isAllowedExternalUrl("blob:https://example.com/uuid")).toBe(false);
    expect(isAllowedExternalUrl("vbscript:MsgBox(1)")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pass@example.com/path?q=1#frag")).toBe(true);
  });

  it("allows same-origin https will-navigate without preventDefault", () => {
    const navigationListeners = new Map<string, (...args: unknown[]) => void>();
    const current = "https://app.example.com/index.html";
    const webContents = {
      getURL: vi.fn(() => current),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        navigationListeners.set(event, listener);
      }),
    };
    attachWebSecurityHandlers({ webContents } as never);
    const preventDefault = vi.fn();
    navigationListeners.get("will-navigate")?.(
      { preventDefault },
      "https://app.example.com/settings?tab=1",
    );
    expect(preventDefault).not.toHaveBeenCalled();
  });

  // wave-155 residual
  it("rejects empty/malformed external urls and non-http schemes", () => {
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl("ftp://example.com/file")).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/tmp/a.txt")).toBe(false);
    expect(isAllowedExternalUrl("mailto:user@example.com")).toBe(false);
  });

  it("blocks cross-origin http navigation even with matching paths", () => {
    expect(
      isAllowedNavigationUrl("https://evil.example/path", "https://app.example/path", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://app.example/path", "https://app.example/path", false),
    ).toBe(false);
  });

  it("does not open shell for blocked schemes and still denies window", async () => {
    openExternalMock.mockClear();
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    const webContents = {
      getURL: vi.fn(() => "file:///C:/app/renderer/index.html"),
      setWindowOpenHandler: vi.fn((handler: typeof openHandler) => {
        openHandler = handler;
      }),
      on: vi.fn(),
    };
    attachWebSecurityHandlers({ webContents } as never);
    expect(openHandler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(openHandler?.({ url: "file:///C:/Windows/System32" })).toEqual({ action: "deny" });
    // blocked schemes must not call shell.openExternal
    await Promise.resolve();
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("allows same file:// path navigation and blocks different file paths", () => {
    const same = "file:///C:/app/renderer/index.html";
    expect(isAllowedNavigationUrl(same, same, false)).toBe(true);
    expect(
      isAllowedNavigationUrl("file:///C:/app/renderer/other.html", same, false),
    ).toBe(false);
  });

  // wave-160 residual
  it("isAllowedExternalUrl only http/https; rejects empty and malformed", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("not-a-url")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hi")).toBe(false);
  });

  it("allowDevLocalhost permits localhost/127.0.0.1 only when neither side is file:", () => {
    // product: if either URL is file:, both must be file: — mixed file/http returns false first
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "file:///C:/app/index.html", true),
    ).toBe(false);
    // both http: + allowDevLocalhost → localhost/127 ok
    expect(
      isAllowedNavigationUrl(
        "http://localhost:5173/main",
        "http://localhost:5173/",
        true,
      ),
    ).toBe(true); // same-origin also true
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://app.example/", true),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://app.example/", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://evil.example/", "https://app.example/", true),
    ).toBe(false);
  });

  it("same-origin navigation allows path/query changes", () => {
    expect(
      isAllowedNavigationUrl(
        "https://app.example/a?x=1",
        "https://app.example/b",
        false,
      ),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("https://app.example:443/a", "https://app.example/b", false),
    ).toBe(true);
  });

  // wave-176 residual
  it("rejects ftp/blob/ws external and navigation targets", () => {
    expect(isAllowedExternalUrl("ftp://files.example/a")).toBe(false);
    expect(isAllowedExternalUrl("blob:https://example.com/uuid")).toBe(false);
    expect(isAllowedExternalUrl("ws://localhost:8080")).toBe(false);
    expect(isAllowedExternalUrl("wss://localhost:8080")).toBe(false);
    expect(
      isAllowedNavigationUrl("ftp://files.example/a", "https://app.example/", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("blob:https://app.example/x", "https://app.example/", false),
    ).toBe(false);
  });

  it("rejects malformed current or target URLs for navigation", () => {
    expect(isAllowedNavigationUrl("https://app.example/", "not a url", false)).toBe(false);
    expect(isAllowedNavigationUrl("not a url", "https://app.example/", false)).toBe(false);
    expect(isAllowedNavigationUrl("", "", false)).toBe(false);
  });

  it("dev localhost does not allow non-loopback hostnames even with flag", () => {
    expect(
      isAllowedNavigationUrl("http://192.168.1.1:5173/", "https://app.example/", true),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://[::1]:5173/", "https://app.example/", true),
    ).toBe(false); // product only checks localhost / 127.0.0.1 strings
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "https://app.example/", true),
    ).toBe(true);
  });

  // wave-181 residual
  it("isAllowedExternalUrl allows http/https with ports and rejects data/mailto", () => {
    expect(isAllowedExternalUrl("http://example.com:8080/path")).toBe(true);
    expect(isAllowedExternalUrl("https://user:pass@example.com/")).toBe(true);
    expect(isAllowedExternalUrl("data:text/plain,hi")).toBe(false);
    expect(isAllowedExternalUrl("mailto:a@b.com")).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Windows")).toBe(false);
  });

  it("same-origin navigation is case-sensitive on hostname and ignores path", () => {
    expect(
      isAllowedNavigationUrl("https://App.Example/x", "https://app.example/y", false),
    ).toBe(true); // URL.origin lowercases host
    expect(
      isAllowedNavigationUrl("https://app.example:443/a", "https://app.example/b", false),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("https://evil.example/", "https://app.example/", false),
    ).toBe(false);
  });

  it("dev localhost allows 127.0.0.1 https and rejects without flag", () => {
    expect(
      isAllowedNavigationUrl("https://127.0.0.1:5173/", "file:///C:/app/index.html", true),
    ).toBe(false); // mixed file↔http is always denied
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://app.example/", true),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://app.example/", false),
    ).toBe(false);
  });

  // wave-191 residual
  it("isAllowedExternalUrl rejects blank/ws and allows query/hash https", () => {
    expect(isAllowedExternalUrl("   ")).toBe(false);
    expect(isAllowedExternalUrl("ws://example.com")).toBe(false);
    expect(isAllowedExternalUrl("wss://example.com")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com/path?x=1#y")).toBe(true);
  });

  it("file navigation only allows identical normalized paths", () => {
    expect(
      isAllowedNavigationUrl("file:///C:/app/index.html", "file:///C:/app/index.html", false),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("file:///C:/app/other.html", "file:///C:/app/index.html", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("file:///C:/app/index.html", "https://app.example/", false),
    ).toBe(false);
  });

  // wave-196 residual
  it("rejects malformed navigation urls and only allows exact localhost hostnames in dev", () => {
    expect(isAllowedNavigationUrl("not a url", "https://app.example/", true)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example/", ":::bad", true)).toBe(false);
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "https://app.example/", true),
    ).toBe(true);
    // product allows only localhost / 127.0.0.1 — not ::1 or 0.0.0.0
    expect(
      isAllowedNavigationUrl("http://0.0.0.0:5173/", "https://app.example/", true),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://[::1]:5173/", "https://app.example/", true),
    ).toBe(false);
  });

  it("isAllowedExternalUrl rejects javascript and custom schemes with host-like text", () => {
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isAllowedExternalUrl("about:blank")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
  });

  // wave-201 residual
  it("same-origin http(s) navigation is allowed even when not localhost", () => {
    expect(
      isAllowedNavigationUrl("https://app.example/chat", "https://app.example/home", false),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("https://app.example/chat", "https://other.example/home", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://app.example/a", "https://app.example/a", false),
    ).toBe(false);
  });

  it("file: navigation only same normalized path; cross protocol denied", () => {
    expect(
      isAllowedNavigationUrl("file:///C:/app/index.html", "file:///C:/app/index.html", true),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("file:///C:/app/other.html", "file:///C:/app/index.html", true),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("https://app.example/", "file:///C:/app/index.html", true),
    ).toBe(false);
  });

  it("isAllowedExternalUrl accepts http/https only; ftp/data denied", () => {
    expect(isAllowedExternalUrl("http://example.com/x")).toBe(true);
    expect(isAllowedExternalUrl("https://example.com/x?q=1")).toBe(true);
    expect(isAllowedExternalUrl("ftp://example.com/x")).toBe(false);
    expect(isAllowedExternalUrl("data:text/plain,hi")).toBe(false);
    expect(isAllowedExternalUrl("not-a-url")).toBe(false);
  });

  // wave-202 residual
  it("allowDevLocalhost false blocks localhost navigation from foreign origins", () => {
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "https://app.example/", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://app.example/", false),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("http://localhost:5173/", "https://app.example/", true),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("http://127.0.0.1:5173/path", "https://app.example/", true),
    ).toBe(true);
  });

  it("malformed urls and empty strings are denied for both helpers", () => {
    expect(isAllowedNavigationUrl("", "https://app.example/", true)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example/", "", true)).toBe(false);
    expect(isAllowedNavigationUrl("not a url", "https://app.example/", true)).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("   ")).toBe(false);
    expect(isAllowedExternalUrl("http://")).toBe(false);
  });

  // wave-206 residual
  it("same-origin navigation allowed even when allowDevLocalhost is false", () => {
    expect(
      isAllowedNavigationUrl(
        "https://app.example/settings",
        "https://app.example/",
        false,
      ),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl(
        "https://app.example:443/path",
        "https://app.example/",
        false,
      ),
    ).toBe(true);
  });

  it("file: and about:blank navigation denied; javascript scheme denied for external", () => {
    expect(
      isAllowedNavigationUrl("file:///C:/x", "https://app.example/", true),
    ).toBe(false);
    expect(
      isAllowedNavigationUrl("about:blank", "https://app.example/", true),
    ).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pass@example.com/x")).toBe(true);
  });


  // wave-216 residual
  it("blocks credential-less custom schemes and allows https with IPv4 host", () => {
    expect(isAllowedExternalUrl("ms-windows-store://pdp/?productid=9N")).toBe(false);
    expect(isAllowedExternalUrl("steam://run/0")).toBe(false);
    expect(isAllowedExternalUrl("https://192.168.1.10/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://10.0.0.1:8080/")).toBe(true);
  });

  it("same-origin allows hash-only changes; port defaulting matches URL origin", () => {
    expect(
      isAllowedNavigationUrl("https://app.example/#section", "https://app.example/", false),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("https://app.example:443/", "https://app.example/", false),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl("http://app.example:80/a", "http://app.example/b", false),
    ).toBe(true);
  });

  it("will-navigate allows same-document file hash and blocks custom-protocol redirects", () => {
    const navigationListeners = new Map<string, (...args: unknown[]) => void>();
    const current = "file:///C:/app/renderer/index.html";
    const webContents = {
      getURL: vi.fn(() => current),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        navigationListeners.set(event, listener);
      }),
    };
    attachWebSecurityHandlers({ webContents } as never);
    const allowPrevent = vi.fn();
    navigationListeners.get("will-navigate")?.(
      { preventDefault: allowPrevent },
      `${current}?tab=1`,
    );
    expect(allowPrevent).not.toHaveBeenCalled();
    const blockPrevent = vi.fn();
    navigationListeners.get("will-redirect")?.(
      { preventDefault: blockPrevent },
      "custom-protocol://payload",
    );
    expect(blockPrevent).toHaveBeenCalledTimes(1);
  });


  // wave-225 residual
  it("open handler always denies; opens only http(s) via shell.openExternal", () => {
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      getURL: () => "file:///C:/app/index.html",
      setWindowOpenHandler,
      on: vi.fn(),
    };
    attachWebSecurityHandlers({ webContents } as never);
    const handler = setWindowOpenHandler.mock.calls[0][0] as (opts: { url: string }) => { action: string };
    expect(handler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
    expect(openExternalMock).toHaveBeenCalledWith("https://example.com/docs");
    openExternalMock.mockClear();
    expect(handler({ url: "file:///C:/secret" })).toEqual({ action: "deny" });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(handler({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("will-navigate and will-redirect both block cross-origin while allowing same-origin http", () => {
    const navigationListeners = new Map<string, (...args: unknown[]) => void>();
    const webContents = {
      getURL: vi.fn(() => "https://app.example.com/index.html"),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        navigationListeners.set(event, listener);
      }),
    };
    attachWebSecurityHandlers({ webContents } as never);
    const prevent = vi.fn();
    navigationListeners.get("will-navigate")?.(
      { preventDefault: prevent },
      "https://evil.example.com/",
    );
    expect(prevent).toHaveBeenCalledTimes(1);
    prevent.mockClear();
    navigationListeners.get("will-redirect")?.(
      { preventDefault: prevent },
      "https://app.example.com/settings",
    );
    expect(prevent).not.toHaveBeenCalled();
  });

  // wave-248 residual
  it("isAllowedExternalUrl rejects ftp/ws/blob; allows http(s) with path/query/hash", () => {
    expect(isAllowedExternalUrl("ftp://example.com/a")).toBe(false);
    expect(isAllowedExternalUrl("ws://example.com/a")).toBe(false);
    expect(isAllowedExternalUrl("blob:https://example.com/uuid")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com/a?q=1#h")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1:8080/x")).toBe(true);
  });

  it("isAllowedNavigationUrl: same file path only for file:; localhost only when allowDevLocalhost", () => {
    const fileCurrent = "file:///C:/app/index.html";
    expect(isAllowedNavigationUrl("file:///C:/app/index.html", fileCurrent, false)).toBe(true);
    expect(isAllowedNavigationUrl("file:///C:/app/other.html", fileCurrent, false)).toBe(false);
    expect(isAllowedNavigationUrl("https://example.com", fileCurrent, false)).toBe(false);
    const httpCurrent = "https://app.example.com/home";
    expect(isAllowedNavigationUrl("http://localhost:5173/", httpCurrent, false)).toBe(false);
    expect(isAllowedNavigationUrl("http://localhost:5173/", httpCurrent, true)).toBe(true);
    expect(isAllowedNavigationUrl("https://127.0.0.1:3000/", httpCurrent, true)).toBe(true);
    expect(isAllowedNavigationUrl("https://evil.example.com/", httpCurrent, true)).toBe(false);
  });

  // wave-259 residual
  it("isAllowedExternalUrl rejects javascript/data/file; allows https/http; garbage false", () => {
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hi")).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/a.html")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });

  it("isAllowedNavigationUrl same origin https stays allowed; protocol mismatch denied", () => {
    const current = "https://app.example.com/home";
    expect(isAllowedNavigationUrl("https://app.example.com/settings", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("http://app.example.com/settings", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example.com:443/x", current, false)).toBe(true);
  });


  // wave-271 residual
  it("isAllowedExternalUrl allows only http/https; rejects empty and relative", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("/relative")).toBe(false);
    expect(isAllowedExternalUrl("mailto:a@b.com")).toBe(false);
  });

  it("isAllowedNavigationUrl denies cross-origin even with allowDevLocalhost; file mixed protocols false", () => {
    const current = "https://app.example.com/home";
    expect(isAllowedNavigationUrl("https://other.example.com/", current, true)).toBe(false);
    expect(isAllowedNavigationUrl("file:///C:/app/index.html", current, true)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.example.com/x", "file:///C:/app/index.html", true)).toBe(false);
    // file same path (win path case-insensitive via normalize lower)
    expect(
      isAllowedNavigationUrl("file:///C:/App/index.html", "file:///C:/app/index.html", false),
    ).toBe(true);
  });


  // wave-277 residual
  it("isAllowedExternalUrl rejects ftp/ws/blob; allows http with port and path", () => {
    expect(isAllowedExternalUrl("ftp://example.com")).toBe(false);
    expect(isAllowedExternalUrl("ws://example.com")).toBe(false);
    expect(isAllowedExternalUrl("blob:https://example.com/uuid")).toBe(false);
    expect(isAllowedExternalUrl("http://example.com:8080/path?q=1#hash")).toBe(true);
  });

  it("isAllowedNavigationUrl allowDevLocalhost only for localhost/127; not LAN IPs", () => {
    const current = "https://app.example.com/";
    expect(isAllowedNavigationUrl("http://localhost:5173/", current, true)).toBe(true);
    expect(isAllowedNavigationUrl("http://127.0.0.1:5173/", current, true)).toBe(true);
    expect(isAllowedNavigationUrl("http://192.168.1.10:5173/", current, true)).toBe(false);
    expect(isAllowedNavigationUrl("http://10.0.0.2/", current, true)).toBe(false);
    expect(isAllowedNavigationUrl("http://localhost:5173/", current, false)).toBe(false);
  });

  // wave-285 residual
  it("isAllowedExternalUrl only http/https; rejects malformed and non-http schemes", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("HTTP://EXAMPLE.COM/path")).toBe(true);
    expect(isAllowedExternalUrl("about:blank")).toBe(false);
    expect(isAllowedExternalUrl("chrome://settings")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });

  it("isAllowedNavigationUrl same-origin https allows path change; invalid current rejects", () => {
    const current = "https://app.example.com/home?x=1";
    expect(isAllowedNavigationUrl("https://app.example.com/other", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("https://app.example.com:443/other", current, false)).toBe(true);
    expect(isAllowedNavigationUrl("https://app.example.com/other", ":::bad", false)).toBe(false);
    expect(isAllowedNavigationUrl(":::bad", current, false)).toBe(false);
    expect(isAllowedNavigationUrl("https://evil.example.com/", current, false)).toBe(false);
  });





  // wave-302 residual
  it("isAllowedExternalUrl allows http/https only; rejects file/javascript/data", () => {
    expect(isAllowedExternalUrl("https://x.example/path")).toBe(true);
    expect(isAllowedExternalUrl("http://x.example")).toBe(true);
    expect(isAllowedExternalUrl("file:///C:/x")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hi")).toBe(false);
    expect(isAllowedExternalUrl("https://")).toBe(false);
  });

  it("isAllowedNavigationUrl same-origin path/query; file requires same path; localhost only when allowed", () => {
    const cur = "https://desk.local/app";
    expect(isAllowedNavigationUrl("https://desk.local/other?q=1", cur, false)).toBe(true);
    expect(isAllowedNavigationUrl("http://desk.local/other", cur, false)).toBe(false);
    expect(isAllowedNavigationUrl("https://other.local/", cur, false)).toBe(false);

    expect(
      isAllowedNavigationUrl(
        "file:///C:/Users/demo/app/index.html",
        "file:///C:/Users/demo/app/index.html",
        false,
      ),
    ).toBe(true);
    expect(
      isAllowedNavigationUrl(
        "file:///C:/Users/demo/app/other.html",
        "file:///C:/Users/demo/app/index.html",
        false,
      ),
    ).toBe(false);

    expect(isAllowedNavigationUrl("http://localhost:5173/", "https://desk.local/", true)).toBe(true);
    expect(isAllowedNavigationUrl("http://127.0.0.1:5173/", "https://desk.local/", true)).toBe(true);
    expect(isAllowedNavigationUrl("http://localhost:5173/", "https://desk.local/", false)).toBe(false);
    expect(isAllowedNavigationUrl("http://[::1]:5173/", "https://desk.local/", true)).toBe(false);
  });



  // wave-312 residual
  it("isAllowedExternalUrl rejects non-URL and non-http(s) schemes; allows query/hash http(s)", () => {
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl("ftp://files.example/x")).toBe(false);
    expect(isAllowedExternalUrl("chrome://settings")).toBe(false);
    expect(isAllowedExternalUrl("https://ex.ample/path?q=1#hash")).toBe(true);
    expect(isAllowedExternalUrl("http://ex.ample")).toBe(true);
  });

  it("isAllowedNavigationUrl rejects file/http mix; same-file path case-insensitive on win32 when lowercased", () => {
    expect(isAllowedNavigationUrl("file:///C:/a.html", "https://app.local/", false)).toBe(false);
    expect(isAllowedNavigationUrl("https://app.local/", "file:///C:/a.html", false)).toBe(false);
    // same path different casing — product lowercases file paths on win32
    if (process.platform === "win32") {
      expect(
        isAllowedNavigationUrl(
          "file:///C:/Users/Demo/App/Index.html",
          "file:///C:/Users/demo/app/index.html",
          false,
        ),
      ).toBe(true);
    }
    expect(isAllowedNavigationUrl("http://evil.local/", "https://app.local/", true)).toBe(false);
    expect(isAllowedNavigationUrl("https://127.0.0.1:3000/", "file:///C:/x", true)).toBe(false);
  });
});
