// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canNotify,
  isNotificationEnabled,
  setNotificationEnabled,
  requestNotificationPermission,
  sendNotification,
  notifyError,
  notifyTaskComplete,
  notifyMessageReceived,
} from "./notifications";

describe("notifications utils", () => {
  beforeEach(() => {
    window.localStorage.clear();

    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => NotificationMock.permission);
    };

    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
  });

  it("disables notifications at the app level even after browser permission was granted", async () => {
    expect(isNotificationEnabled()).toBe(true);
    expect(canNotify()).toBe(true);

    setNotificationEnabled(false);

    expect(isNotificationEnabled()).toBe(false);
    expect(canNotify()).toBe(false);

    await requestNotificationPermission();
    expect(canNotify()).toBe(false);
  });

  it("re-enables notifications when app setting is turned back on", async () => {
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);

    setNotificationEnabled(true);

    expect(isNotificationEnabled()).toBe(true);
    expect(canNotify()).toBe(true);
  });

  // wave-105 residual
  it("treats missing Notification API as cannot notify and denied permission request", async () => {
    // @ts-expect-error force missing Notification
    delete window.Notification;
    expect(canNotify()).toBe(false);
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  it("blocks notify when browser permission is denied even if enabled", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "denied";
      static requestPermission = vi.fn(async () => "denied" as NotificationPermission);
      constructor() {
        throw new Error("should not construct");
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(isNotificationEnabled()).toBe(true);
    expect(canNotify()).toBe(false);
  });

  it("sendNotification is a no-op when notifications are disabled", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string) {
        construct(title);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(false);
    sendNotification("t", "b");
    notifyError("e");
    notifyTaskComplete("task");
    notifyMessageReceived("sess");
    expect(construct).not.toHaveBeenCalled();
  });

  // wave-114 residual
  it("defaults to enabled when localStorage throws on read", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        clear: () => undefined,
        removeItem: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    try {
      expect(isNotificationEnabled()).toBe(true);
      expect(() => setNotificationEnabled(false)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("short-circuits requestPermission when already granted", async () => {
    const requestPermission = vi.fn(async () => "denied" as NotificationPermission);
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = requestPermission;
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("constructs Notification with title body and helper copy", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        construct(title, options);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    sendNotification("hello", "world");
    notifyTaskComplete("build");
    notifyError("boom");
    notifyMessageReceived("sess-1");
    expect(construct).toHaveBeenCalledWith("hello", expect.objectContaining({ body: "world", icon: "icon.png" }));
    expect(construct).toHaveBeenCalledWith("任务完成", expect.objectContaining({ body: "build 已完成" }));
    expect(construct).toHaveBeenCalledWith("发生错误", expect.objectContaining({ body: "boom" }));
    expect(construct).toHaveBeenCalledWith("新消息", expect.objectContaining({ body: "来自 sess-1 的回复" }));
  });

  it("swallows Notification constructor failures", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor() {
        throw new Error("restricted");
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(() => sendNotification("x", "y")).not.toThrow();
  });

  // wave-126 residual
  it("persists requestPermission result and treats null preference as enabled", async () => {
    expect(localStorage.getItem("pi-desktop-notifications-enabled")).toBeNull();
    expect(isNotificationEnabled()).toBe(true);

    const requestPermission = vi.fn(async () => "default" as NotificationPermission);
    const NotificationMock = class {
      static permission: NotificationPermission = "default";
      static requestPermission = requestPermission;
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("default");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pi-desktop-notification-permission")).toBe("default");
    expect(canNotify()).toBe(false);
  });

  it("merges custom Notification options over default icon", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        construct(title, options);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    sendNotification("t", "b", { icon: "custom.png", tag: "task-1" });
    expect(construct).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ body: "b", icon: "custom.png", tag: "task-1" }),
    );
  });

  it("treats non-true stored preference as disabled", () => {
    localStorage.setItem("pi-desktop-notifications-enabled", "false");
    expect(isNotificationEnabled()).toBe(false);
    localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });

  // wave-132 residual
  it("persists setNotificationEnabled as string true/false only", () => {
    setNotificationEnabled(true);
    expect(localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
    setNotificationEnabled(false);
    expect(localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
  });

  it("canNotify requires granted permission even when preference is enabled", () => {
    setNotificationEnabled(true);
    const NotificationMock = class {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn(async () => "default" as NotificationPermission);
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    expect(isNotificationEnabled()).toBe(true);
    expect(canNotify()).toBe(false);
  });

  it("sendNotification passes undefined body with default icon when body omitted", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        construct(title, options);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    sendNotification("title-only");
    expect(construct).toHaveBeenCalledWith(
      "title-only",
      expect.objectContaining({ icon: "icon.png", body: undefined }),
    );
  });

  // wave-147 residual
  it("notify helpers use fixed Chinese titles", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        construct(title, options);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    notifyTaskComplete("build");
    notifyError("boom");
    notifyMessageReceived("会话 A");
    expect(construct.mock.calls.map((c) => c[0])).toEqual(["任务完成", "发生错误", "新消息"]);
    expect(construct.mock.calls[0]?.[1]).toMatchObject({ body: "build 已完成" });
    expect(construct.mock.calls[1]?.[1]).toMatchObject({ body: "boom" });
    expect(construct.mock.calls[2]?.[1]).toMatchObject({ body: "来自 会话 A 的回复" });
  });

  it("sendNotification no-ops when preference disabled even if granted", () => {
    const construct = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        construct(title, options);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(false);
    sendNotification("x", "y");
    expect(construct).not.toHaveBeenCalled();
  });

  it("sendNotification swallows constructor failures", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor() {
        throw new Error("blocked");
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(() => sendNotification("t", "b")).not.toThrow();
  });

  // wave-156 residual
  it("canNotify is false when Notification API is missing", () => {
    const original = window.Notification;
    // @ts-expect-error intentional delete for residual
    delete window.Notification;
    try {
      setNotificationEnabled(true);
      expect(canNotify()).toBe(false);
      expect(() => sendNotification("t", "b")).not.toThrow();
    } finally {
      Object.defineProperty(window, "Notification", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it("canNotify is false when permission is denied", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "denied";
      static requestPermission = vi.fn(async () => "denied" as NotificationPermission);
      constructor() {
        throw new Error("should not construct");
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(canNotify()).toBe(false);
    expect(() => sendNotification("t", "b")).not.toThrow();
  });

  it("setNotificationEnabled(true) then false updates preference for canNotify", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor() {}
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(isNotificationEnabled()).toBe(true);
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(isNotificationEnabled()).toBe(false);
    expect(canNotify()).toBe(false);
  });

  // wave-163 residual
  it("defaults enabled to true when storage key is missing or garbage", () => {
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "yes");
    // product: only exact "true" is true; other strings → false
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("requestNotificationPermission returns denied when Notification is undefined", async () => {
    // @ts-expect-error intentional
    delete window.Notification;
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  it("notify helpers no-op when cannot notify", () => {
    setNotificationEnabled(false);
    expect(() => notifyTaskComplete("t")).not.toThrow();
    expect(() => notifyError("e")).not.toThrow();
    expect(() => notifyMessageReceived("s")).not.toThrow();
  });

  // wave-177 residual
  it("canNotify is false when permission is denied or default even if enabled", () => {
    for (const permission of ["denied", "default"] as NotificationPermission[]) {
      const NotificationMock = class {
        static permission: NotificationPermission = permission;
        static requestPermission = vi.fn(async () => permission);
        constructor() {}
      };
      Object.defineProperty(window, "Notification", {
        value: NotificationMock,
        configurable: true,
        writable: true,
      });
      setNotificationEnabled(true);
      expect(canNotify()).toBe(false);
    }
  });

  it("requestNotificationPermission short-circuits when already granted", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = requestPermission;
      constructor() {}
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("setNotificationEnabled stores canonical true/false strings", () => {
    setNotificationEnabled(true);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
    setNotificationEnabled(false);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
  });

  // wave-185 residual
  it("isNotificationEnabled treats only exact 'true' as enabled when key present", () => {
    window.localStorage.setItem("pi-desktop-notifications-enabled", "TRUE");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "false");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("missing enabled key defaults to true preference", () => {
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("sendNotification no-ops when disabled even if permission granted", () => {
    const constructed: Array<{ title: string; options: NotificationOptions | undefined }> = [];
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        constructed.push({ title, options });
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(false);
    sendNotification("t", "b");
    notifyTaskComplete("job");
    expect(constructed).toHaveLength(0);
  });

  // wave-193 residual
  it("canNotify requires both enabled preference and granted permission", () => {
    setNotificationEnabled(true);
    (window.Notification as unknown as { permission: NotificationPermission }).permission = "denied";
    expect(canNotify()).toBe(false);
    (window.Notification as unknown as { permission: NotificationPermission }).permission = "default";
    expect(canNotify()).toBe(false);
    (window.Notification as unknown as { permission: NotificationPermission }).permission = "granted";
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);
  });

  it("helpers use fixed Chinese titles when canNotify is true", () => {
    const constructed: Array<{ title: string; options: NotificationOptions | undefined }> = [];
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
      constructor(title: string, options?: NotificationOptions) {
        constructed.push({ title, options });
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    notifyTaskComplete("build");
    notifyError("boom");
    notifyMessageReceived("Session A");
    expect(constructed).toEqual([
      expect.objectContaining({ title: "任务完成", options: expect.objectContaining({ body: "build 已完成" }) }),
      expect.objectContaining({ title: "发生错误", options: expect.objectContaining({ body: "boom" }) }),
      expect.objectContaining({ title: "新消息", options: expect.objectContaining({ body: "来自 Session A 的回复" }) }),
    ]);
  });

  it("requestNotificationPermission short-circuits when already granted", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      static requestPermission = requestPermission;
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requestNotificationPermission returns denied when Notification is undefined", async () => {
    Object.defineProperty(window, "Notification", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });

  // wave-198 residual
  it("canNotify requires both settings enabled and granted permission", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);
    setNotificationEnabled(true);
    NotificationMock.permission = "denied";
    expect(canNotify()).toBe(false);
    NotificationMock.permission = "default";
    expect(canNotify()).toBe(false);
  });

  it("notify helpers no-op when disabled even if permission granted", () => {
    const ctor = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      constructor(...args: unknown[]) {
        ctor(...args);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(false);
    notifyTaskComplete("job");
    notifyError("e");
    notifyMessageReceived("S");
    expect(ctor).not.toHaveBeenCalled();
  });

  // wave-203 residual
  it("setNotificationEnabled writes String(boolean); only exact 'true' enables", () => {
    setNotificationEnabled(true);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
    setNotificationEnabled(false);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
    window.localStorage.setItem("pi-desktop-notifications-enabled", "TRUE");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("notify helpers fire with Chinese titles when canNotify", () => {
    const ctor = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      constructor(...args: unknown[]) {
        ctor(...args);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    notifyTaskComplete("build");
    notifyError("fail");
    notifyMessageReceived("chat");
    expect(ctor).toHaveBeenCalledTimes(3);
    expect(ctor.mock.calls[0][0]).toBe("任务完成");
    expect(ctor.mock.calls[0][1]).toMatchObject({ body: "build 已完成" });
    expect(ctor.mock.calls[1][0]).toBe("发生错误");
    expect(ctor.mock.calls[1][1]).toMatchObject({ body: "fail" });
    expect(ctor.mock.calls[2][0]).toBe("新消息");
    expect(ctor.mock.calls[2][1]).toMatchObject({ body: "来自 chat 的回复" });
  });

  // wave-209 residual
  it("canNotify is false when enabled but permission denied; true only when both ok", () => {
    const NotificationMock = class {
      static permission: NotificationPermission = "denied";
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(canNotify()).toBe(false);
    NotificationMock.permission = "granted";
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);
  });

  it("sendNotification is no-op when cannot notify; stores exact true/false strings", () => {
    const ctor = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "default";
      constructor(...args: unknown[]) {
        ctor(...args);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    sendNotification("t", "b");
    expect(ctor).not.toHaveBeenCalled();
    setNotificationEnabled(false);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
    setNotificationEnabled(true);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
  });


  // wave-215 residual
  it("isNotificationEnabled defaults true when key missing; non-true strings are disabled", () => {
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "TRUE");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("notify helpers pass fixed titles and bodies through sendNotification when granted", () => {
    const ctor = vi.fn();
    const NotificationMock = class {
      static permission: NotificationPermission = "granted";
      constructor(...args: unknown[]) {
        ctor(...args);
      }
    };
    Object.defineProperty(window, "Notification", {
      value: NotificationMock,
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    notifyTaskComplete("build");
    notifyError("boom");
    notifyMessageReceived("Session A");
    expect(ctor).toHaveBeenCalledTimes(3);
    expect(ctor.mock.calls[0]![0]).toBe("任务完成");
    expect(ctor.mock.calls[0]![1]).toMatchObject({ body: "build 已完成", icon: "icon.png" });
    expect(ctor.mock.calls[1]![0]).toBe("发生错误");
    expect(ctor.mock.calls[1]![1]).toMatchObject({ body: "boom" });
    expect(ctor.mock.calls[2]![0]).toBe("新消息");
    expect(ctor.mock.calls[2]![1]).toMatchObject({ body: "来自 Session A 的回复" });
  });

  it("requestNotificationPermission returns denied when Notification is undefined", async () => {
    Object.defineProperty(window, "Notification", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });


  // wave-220 residual
  it("only exact string true enables; false/1/TRUE keep disabled preference semantics", () => {
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "false");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "TRUE");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("notify helpers use fixed Chinese titles and canNotify gates send", () => {
    setNotificationEnabled(true);
    const ctor = vi.fn();
    Object.defineProperty(window, "Notification", {
      value: Object.assign(ctor, {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    notifyTaskComplete("T1");
    expect(ctor).toHaveBeenCalledWith("任务完成", expect.objectContaining({ body: "T1 已完成" }));
    notifyError("boom");
    expect(ctor).toHaveBeenCalledWith("发生错误", expect.objectContaining({ body: "boom" }));
    notifyMessageReceived("Sess");
    expect(ctor).toHaveBeenCalledWith("新消息", expect.objectContaining({ body: "来自 Sess 的回复" }));
    setNotificationEnabled(false);
    ctor.mockClear();
    sendNotification("x", "y");
    expect(ctor).not.toHaveBeenCalled();
  });

  // wave-257 residual
  it("canNotify requires enabled + Notification.permission granted", () => {
    setNotificationEnabled(true);
    Object.defineProperty(window, "Notification", {
      value: Object.assign(vi.fn(), {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn(async () => "default" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    expect(canNotify()).toBe(false);
    Object.defineProperty(window, "Notification", {
      value: Object.assign(vi.fn(), {
        permission: "denied" as NotificationPermission,
        requestPermission: vi.fn(async () => "denied" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    expect(canNotify()).toBe(false);
    const ctor = vi.fn();
    Object.defineProperty(window, "Notification", {
      value: Object.assign(ctor, {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);
  });

  it("setNotificationEnabled stores literal true/false strings", () => {
    setNotificationEnabled(true);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
    setNotificationEnabled(false);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
  });

  // wave-268 residual
  it("isNotificationEnabled defaults true when key missing; only literal true enables", () => {
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "TRUE");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("sendNotification no-ops when canNotify false; does not throw", () => {
    setNotificationEnabled(false);
    expect(() => sendNotification("t", "b")).not.toThrow();
    expect(() => notifyError("e")).not.toThrow();
    expect(() => notifyTaskComplete("task")).not.toThrow();
    expect(() => notifyMessageReceived("s")).not.toThrow();
  });

  // wave-281 residual
  it("canNotify requires granted permission AND enabled preference", () => {
    const ctor = vi.fn();
    Object.defineProperty(window, "Notification", {
      value: Object.assign(ctor, {
        permission: "default" as NotificationPermission,
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    expect(canNotify()).toBe(false);
    Object.defineProperty(window, "Notification", {
      value: Object.assign(ctor, {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    expect(canNotify()).toBe(true);
    setNotificationEnabled(false);
    expect(canNotify()).toBe(false);
  });

  it("isNotificationEnabled false for '1'/'false'/empty; only 'true' enables when set", () => {
    window.localStorage.setItem("pi-desktop-notifications-enabled", "1");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "false");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "");
    expect(isNotificationEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-notifications-enabled", "true");
    expect(isNotificationEnabled()).toBe(true);
  });



  // wave-291 residual
  it("setNotificationEnabled stores literal String(enabled); missing key defaults true", () => {
    window.localStorage.removeItem("pi-desktop-notifications-enabled");
    expect(isNotificationEnabled()).toBe(true);
    setNotificationEnabled(false);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("false");
    expect(isNotificationEnabled()).toBe(false);
    setNotificationEnabled(true);
    expect(window.localStorage.getItem("pi-desktop-notifications-enabled")).toBe("true");
    expect(isNotificationEnabled()).toBe(true);
  });

  it("notify helpers use product Chinese titles when canNotify; denied is silent", () => {
    const ctor = vi.fn();
    Object.defineProperty(window, "Notification", {
      value: Object.assign(ctor, {
        permission: "granted" as NotificationPermission,
        requestPermission: vi.fn(async () => "granted" as NotificationPermission),
      }),
      configurable: true,
      writable: true,
    });
    setNotificationEnabled(true);
    notifyTaskComplete("Build");
    notifyError("boom");
    notifyMessageReceived("Session A");
    expect(ctor).toHaveBeenCalledWith("任务完成", expect.objectContaining({ body: "Build 已完成" }));
    expect(ctor).toHaveBeenCalledWith("发生错误", expect.objectContaining({ body: "boom" }));
    expect(ctor).toHaveBeenCalledWith("新消息", expect.objectContaining({ body: "来自 Session A 的回复" }));

    ctor.mockClear();
    setNotificationEnabled(false);
    notifyTaskComplete("Build");
    expect(ctor).not.toHaveBeenCalled();
  });

});
