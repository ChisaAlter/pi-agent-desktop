// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canNotify,
  isNotificationEnabled,
  setNotificationEnabled,
  requestNotificationPermission,
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
});
