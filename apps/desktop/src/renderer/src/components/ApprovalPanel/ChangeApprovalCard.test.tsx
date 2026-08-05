// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangeApprovalCard } from "./ChangeApprovalCard";
import type { PendingChange } from "../../stores/approval-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      if (key === "approvalPanel.changeCount.write") return `新建×${opts?.count ?? 0}`;
      if (key === "approvalPanel.changeCount.edit") return `编辑×${opts?.count ?? 0}`;
      if (key === "approvalPanel.changeTypes.new") return "新建/覆盖";
      if (key === "approvalPanel.changeTypes.edit") return "编辑";
      if (key === "approvalPanel.statusBadge.approved") return "已保留";
      if (key === "approvalPanel.statusBadge.undone") return "已撤销";
      if (key === "approvalPanel.statusBadge.rejected") return "已拒绝";
      return key;
    },
  }),
}));

vi.mock("../../i18n", () => ({
  useTranslateIpcError: () => (err: { fallback: string }) => err.fallback,
}));

vi.mock("../DiffView", () => ({
  DiffViewer: ({ diff }: { diff: string }) => <pre data-testid="diff-viewer">{diff}</pre>,
}));

function makeChange(id: string, overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    id,
    toolCallId: `tc_${id}`,
    toolName: "write",
    filePath: "src/app/main.ts",
    status: "pending",
    timestamp: new Date("2026-07-21T00:00:00Z"),
    ...overrides,
  };
}

describe("ChangeApprovalCard", () => {
  it("groups multiple edits into one card with summary and per-change actions", () => {
    const onKeep = vi.fn();
    const onUndo = vi.fn();
    render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[
          makeChange("c1", { toolName: "write" }),
          makeChange("c2", { toolName: "edit" }),
        ]}
        onKeep={onKeep}
        onUndo={onUndo}
        undoError={{}}
      />,
    );

    // 头部: 路径 + 次数摘要 + 展开默认打开
    expect(screen.getByText("main.ts")).toBeTruthy();
    expect(screen.getByText("新建×1 · 编辑×1")).toBeTruthy();
    expect(screen.getByText("新建/覆盖")).toBeTruthy();
    expect(screen.getByText("编辑")).toBeTruthy();

    const undo = screen.getAllByRole("button", { name: "approvalPanel.reject src/app/main.ts" });
    const keep = screen.getAllByRole("button", { name: "approvalPanel.approve src/app/main.ts" });
    fireEvent.click(undo[0]!);
    fireEvent.click(keep[0]!);
    expect(onUndo).toHaveBeenCalledWith("c1");
    expect(onKeep).toHaveBeenCalledWith("c1");
  });

  it("shows diff per change and collapses on header click", () => {
    const { container } = render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[makeChange("c1", { diff: "@@ +1 @@" })]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{}}
      />,
    );
    expect(screen.getByTestId("diff-viewer").textContent).toBe("@@ +1 @@");

    fireEvent.click(screen.getByRole("button", { name: "src/app/main.ts · 新建×1" }));
    expect(container.querySelector("[data-testid='diff-viewer']")).toBeNull();
  });

  it("shows kept badge and hides actions after decision", () => {
    render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[makeChange("c1", { toolName: "edit", status: "approved" })]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{}}
      />,
    );

    expect(screen.getByText("已保留")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /保留变更/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /撤销变更/ })).toBeNull();
  });

  it("shows undone badge for rolled-back changes", () => {
    render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[makeChange("c1", { status: "undone" })]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{}}
      />,
    );
    expect(screen.getByText("已撤销")).toBeTruthy();
  });

  it("surfaces undo errors with an alert role", () => {
    render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[makeChange("c1")]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{ c1: "目标路径不在工作区内, 已拒绝撤销" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("已拒绝撤销");
  });

  it("translates IpcError-shaped undo errors via fallback", () => {
    render(
      <ChangeApprovalCard
        filePath="src/app/main.ts"
        changes={[makeChange("c1")]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{ c1: { __brand: "IpcError", code: "ipcErrors.chat.approvalUndoFailed", fallback: "磁盘写入失败" } as never }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("磁盘写入失败");
  });

  it("shows rejected status badge without action buttons", () => {
    render(
      <ChangeApprovalCard
        filePath="gone.ts"
        changes={[makeChange("c1", { status: "rejected" })]}
        onKeep={vi.fn()}
        onUndo={vi.fn()}
        undoError={{}}
      />,
    );
    expect(screen.getByText("已拒绝")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /保留变更/ })).toBeNull();
  });
});
