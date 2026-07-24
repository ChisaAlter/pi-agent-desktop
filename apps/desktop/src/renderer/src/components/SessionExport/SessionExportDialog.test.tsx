// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExportDialog } from "./SessionExportDialog";
import type { Session } from "../../stores/session-store";

const now = new Date("2026-07-21T00:00:00Z");
const session = {
  id: "s1",
  title: "My Session",
  workspaceId: "w1",
  messages: [{ id: "m1", role: "user", content: "hi", timestamp: now } as never],
  createdAt: now,
  updatedAt: now,
  archived: false,
} as Session;

const {
  ensureSessionLoaded,
  downloadFile,
  exportSessionAsMarkdown,
  exportSessionAsJSON,
  exportSessionAsHTML,
  useSessionStore,
} = vi.hoisted(() => {
  const ensureSessionLoaded = vi.fn(async (id: string) => (id === "s1" ? session : null));
  const downloadFile = vi.fn();
  const exportSessionAsMarkdown = vi.fn(() => "# md");
  const exportSessionAsJSON = vi.fn(() => "{}");
  const exportSessionAsHTML = vi.fn(() => "<html></html>");
  const useSessionStore = vi.fn(() => ({
    sessions: [session, { ...session, id: "s2", title: "Archived", archived: true }],
    ensureSessionLoaded,
  }));
  return {
    ensureSessionLoaded,
    downloadFile,
    exportSessionAsMarkdown,
    exportSessionAsJSON,
    exportSessionAsHTML,
    useSessionStore,
  };
});

vi.mock("../../stores/session-store", () => ({ useSessionStore }));
vi.mock("../../utils/export", () => ({
  exportSessionAsMarkdown,
  exportSessionAsJSON,
  exportSessionAsHTML,
  downloadFile,
}));

describe("SessionExportDialog", () => {
  beforeEach(() => {
    ensureSessionLoaded.mockClear();
    downloadFile.mockClear();
    exportSessionAsMarkdown.mockClear();
    exportSessionAsJSON.mockClear();
    exportSessionAsHTML.mockClear();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <SessionExportDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("lists non-archived sessions and exports markdown for single sessionId", async () => {
    const onClose = vi.fn();
    render(<SessionExportDialog isOpen onClose={onClose} sessionId="s1" />);

    expect(screen.getByRole("dialog", { name: "导出会话" })).toBeTruthy();
    expect(screen.queryByText("My Session")).toBeNull(); // single-session mode hides list
    expect(screen.getByRole("button", { name: "Markdown (.md)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    await waitFor(() => {
      expect(exportSessionAsMarkdown).toHaveBeenCalledWith(session);
      expect(downloadFile).toHaveBeenCalledWith("# md", "My_Session.md", "text/markdown");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("requires selection in multi-session mode and can switch format", async () => {
    render(<SessionExportDialog isOpen onClose={vi.fn()} />);
    const exportBtn = screen.getByRole("button", { name: "导出" });
    expect(exportBtn).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(exportBtn).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "JSON (.json)" }));
    expect(screen.getByRole("button", { name: "JSON (.json)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(exportBtn);
    await waitFor(() => {
      expect(exportSessionAsJSON).toHaveBeenCalled();
      expect(downloadFile).toHaveBeenCalledWith("{}", "My_Session.json", "application/json");
    });
  });

  it("exposes cancel control focus-visible ring for keyboard a11y", () => {
    render(<SessionExportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取消" }).className).toContain("focus-visible:ring-2");
  });
});
