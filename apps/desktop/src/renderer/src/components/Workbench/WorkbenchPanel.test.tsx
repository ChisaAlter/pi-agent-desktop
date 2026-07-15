// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";

const { terminalPanelMounted } = vi.hoisted(() => ({ terminalPanelMounted: vi.fn() }));

vi.mock("../Terminal/TerminalPanel", () => ({
  TerminalPanel: () => {
    terminalPanelMounted();
    return <div>Terminal</div>;
  },
}));

vi.mock("../FileWorkspace/FileWorkspace", () => ({
  FileWorkspace: () => <div>Files</div>,
}));

vi.mock("../GitPanel/GitPanel", () => ({
  GitPanel: () => <div>Git</div>,
}));

import { WorkbenchPanel } from "./WorkbenchPanel";

describe("WorkbenchPanel", () => {
  beforeEach(() => {
    terminalPanelMounted.mockClear();
  });

  it("does not mount the terminal while its main panel layer is hidden", async () => {
    const { rerender } = render(
      <section data-main-panel="workbench" data-active="false">
        <I18nProvider>
          <WorkbenchPanel
            workspacePath="C:/repo"
            workspaceId="w1"
            view="terminal"
            onViewChange={vi.fn()}
          />
        </I18nProvider>
      </section>,
    );

    await Promise.resolve();
    expect(terminalPanelMounted).not.toHaveBeenCalled();

    rerender(
      <section data-main-panel="workbench" data-active="true">
        <I18nProvider>
          <WorkbenchPanel
            workspacePath="C:/repo"
            workspaceId="w1"
            view="terminal"
            onViewChange={vi.fn()}
          />
        </I18nProvider>
      </section>,
    );

    await waitFor(() => expect(terminalPanelMounted).toHaveBeenCalledTimes(1));
  });
});
