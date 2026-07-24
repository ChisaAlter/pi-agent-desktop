// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { usePlanStore } from "../../stores/plan-store";
import { ProgressReminderToast } from "./ProgressReminderToast";

describe("ProgressReminderToast", () => {
  const stop = vi.fn(async () => undefined);

  beforeEach(() => {
    usePlanStore.getState().reset();
    stop.mockClear();
    Object.defineProperty(window, "piAPI", {
      value: {
        stop,
      },
      configurable: true,
    });
  });

  it("appears in the composer lane instead of the viewport bottom-right corner", async () => {
    render(
      <I18nProvider>
        <ProgressReminderToast workspaceId="ws1" />
      </I18nProvider>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("pi:stream-start", {
        detail: { runContext: "task" },
      }));
    });

    const toast = await screen.findByRole("status", { name: "任务运行中提醒" });
    expect(toast.className).toContain("fixed");
    expect((toast as HTMLElement).style.left).toBe("var(--pi-global-composer-left, 0px)");
    expect((toast as HTMLElement).style.right).toBe("var(--pi-global-composer-right, 0px)");
    expect((toast as HTMLElement).style.bottom).toBe("calc(var(--pi-global-composer-height, 103px) + 12px)");
    expect(toast.textContent).toContain("任务运行中");
  });

  it("switches to the plan label and marks the plan paused when pause is clicked", async () => {
    render(
      <I18nProvider>
        <ProgressReminderToast workspaceId="ws1" />
      </I18nProvider>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("pi:stream-start", {
        detail: { runContext: "task" },
      }));
    });

    act(() => {
      usePlanStore.getState().startExecution({
        activePlanId: "plan_1",
        title: "执行计划：overlay",
        filename: "overlay.md",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "任务运行中提醒" }).textContent).toContain("正在执行计划");
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "暂停执行" }));
    });

    await waitFor(() => {
      expect(stop).toHaveBeenCalledWith("ws1");
      expect(usePlanStore.getState().activeExecution?.phase).toBe("paused");
    });
  });

  it("stops the active workspace run and hides after the stream ends", async () => {
    render(
      <I18nProvider>
        <ProgressReminderToast workspaceId="ws1" />
      </I18nProvider>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("pi:stream-start", {
        detail: { runContext: "task" },
      }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "停止生成" }));
    });
    expect(stop).toHaveBeenCalledWith("ws1");

    act(() => {
      window.dispatchEvent(new CustomEvent("pi:stream-end"));
    });
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "任务运行中提醒" })).toBeNull();
    });
  });

  it("exposes stop button focus-visible ring for keyboard a11y", async () => {
    render(
      <I18nProvider>
        <ProgressReminderToast workspaceId="ws1" />
      </I18nProvider>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("pi:stream-start", {
        detail: { runContext: "task" },
      }));
    });

    const stopBtn = await screen.findByRole("button", { name: "停止生成" });
    expect(stopBtn.getAttribute("type")).toBe("button");
    expect(stopBtn.className).toContain("focus-visible:ring-2");
  });
});
