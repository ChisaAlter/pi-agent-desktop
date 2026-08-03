// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GitChangesOverlay } from "./GitChangesOverlay";

const SAMPLE_DIFF = [
  "diff --git a/apps/desktop/src/App.tsx b/apps/desktop/src/App.tsx",
  "--- a/apps/desktop/src/App.tsx",
  "+++ b/apps/desktop/src/App.tsx",
  "@@ -1,2 +1,3 @@",
  " line1",
  "-old",
  "+new",
  "+another",
].join("\n");

describe("GitChangesOverlay", () => {
  it("renders empty state and closes on Escape", () => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    const onClose = vi.fn();
    const anchor = { current: document.createElement("button") };

    render(
      <I18nProvider>
        <GitChangesOverlay open files={[]} anchorRef={anchor} onClose={onClose} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("git-changes-overlay")).toBeTruthy();
    expect(screen.getByText("当前没有变更文件")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows per-file +/- counts and expands inline diff without jumping to workbench", async () => {
    window.localStorage.setItem("pi-desktop.locale", "zh-CN");
    const openFile = vi.fn();
    const openDiff = vi.fn();
    const switchSection = vi.fn();
    const anchor = { current: document.createElement("button") };
    window.addEventListener("workspace:open-file", openFile as EventListener);
    window.addEventListener("workspace:open-git-diff", openDiff as EventListener);
    window.addEventListener("app:switch-section", switchSection as EventListener);

    render(
      <I18nProvider>
        <GitChangesOverlay
          open
          files={[{ path: "apps/desktop/src/App.tsx", mark: "M", className: "text-[var(--color-info)]" }]}
          diffText={SAMPLE_DIFF}
          workspacePath="C:/repo"
          anchorRef={anchor}
          onClose={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /App\.tsx/ }));

    await waitFor(() => {
      expect(screen.getByText("new")).toBeTruthy();
    });
    expect(screen.getByText("old")).toBeTruthy();
    expect(openFile).not.toHaveBeenCalled();
    expect(openDiff).not.toHaveBeenCalled();
    expect(switchSection).not.toHaveBeenCalled();

    window.removeEventListener("workspace:open-file", openFile as EventListener);
    window.removeEventListener("workspace:open-git-diff", openDiff as EventListener);
    window.removeEventListener("app:switch-section", switchSection as EventListener);
  });
});
