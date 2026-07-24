// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApprovalPanel } from "./ApprovalPanel";
import type { PendingChange } from "../../stores/approval-store";

const {
  approveChange,
  rejectChange,
  approveAll,
  rejectAll,
  toggleAutoApprove,
  clearChanges,
  setAutoApprove,
  useApprovalStore,
} = vi.hoisted(() => {
  const approveChange = vi.fn();
  const rejectChange = vi.fn();
  const approveAll = vi.fn();
  const rejectAll = vi.fn();
  const toggleAutoApprove = vi.fn();
  const clearChanges = vi.fn();
  const setAutoApprove = vi.fn();
  let state = {
    changes: [] as PendingChange[],
    autoApprove: false,
    approveChange,
    rejectChange,
    approveAll,
    rejectAll,
    toggleAutoApprove,
    clearChanges,
    setAutoApprove,
  };
  const useApprovalStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    {
      setState: (partial: Partial<typeof state>) => {
        state = { ...state, ...partial };
      },
      getState: () => state,
      _reset: () => {
        state = {
          changes: [],
          autoApprove: false,
          approveChange,
          rejectChange,
          approveAll,
          rejectAll,
          toggleAutoApprove,
          clearChanges,
          setAutoApprove,
        };
      },
    },
  );
  return {
    approveChange,
    rejectChange,
    approveAll,
    rejectAll,
    toggleAutoApprove,
    clearChanges,
    setAutoApprove,
    useApprovalStore,
  };
});

vi.mock("../../stores/approval-store", () => ({ useApprovalStore }));

vi.mock("./ChangeApprovalCard", () => ({
  ChangeApprovalCard: ({
    change,
    onApprove,
    onReject,
  }: {
    change: PendingChange;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
  }) => (
    <div data-testid={`card-${change.id}`}>
      <button type="button" onClick={() => onApprove(change.id)}>
        approve-{change.id}
      </button>
      <button type="button" onClick={() => onReject(change.id)}>
        reject-{change.id}
      </button>
    </div>
  ),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: (s: unknown) => unknown) => fn,
}));

function makeChange(id: string, status: PendingChange["status"] = "pending"): PendingChange {
  return {
    id,
    toolCallId: `tc_${id}`,
    toolName: "write",
    filePath: `${id}.ts`,
    status,
    timestamp: new Date("2026-07-21T00:00:00Z"),
  };
}

describe("ApprovalPanel", () => {
  beforeEach(() => {
    useApprovalStore._reset();
    approveChange.mockReset();
    rejectChange.mockReset();
    approveAll.mockReset();
    rejectAll.mockReset();
    toggleAutoApprove.mockReset();
    clearChanges.mockReset();
    setAutoApprove.mockReset();
    setAutoApprove.mockReset();
    window.piAPI = { setAutoApprove } as never;
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <I18nProvider>
        <ApprovalPanel isOpen={false} onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("shows empty state when open with no changes", () => {
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("region", { name: "文件变更审批" })).toBeTruthy();
    expect(screen.getByText("暂无待审批的变更")).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭审批面板" })).toBeTruthy();
  });

  it("lists pending changes and wires bulk actions + auto-approve", () => {
    useApprovalStore.setState({
      changes: [makeChange("a"), makeChange("b", "approved")],
      autoApprove: false,
    });
    const onToggle = vi.fn();
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={onToggle} />
      </I18nProvider>,
    );

    expect(screen.getByTestId("card-a")).toBeTruthy();
    expect(screen.getByTestId("card-b")).toBeTruthy();
    expect(screen.getByLabelText("1 个待审批")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "全部接受" }));
    fireEvent.click(screen.getByRole("button", { name: "全部拒绝" }));
    fireEvent.click(screen.getByRole("button", { name: "清除所有变更" }));
    expect(approveAll).toHaveBeenCalledTimes(1);
    expect(rejectAll).toHaveBeenCalledTimes(1);
    expect(clearChanges).toHaveBeenCalledTimes(1);

    const auto = screen.getByRole("switch", { name: "自动审批" });
    expect(auto.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(auto);
    expect(toggleAutoApprove).toHaveBeenCalledTimes(1);
    expect(setAutoApprove).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭审批面板" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("approve-a"));
    fireEvent.click(screen.getByText("reject-a"));
    expect(approveChange).toHaveBeenCalledWith("a");
    expect(rejectChange).toHaveBeenCalledWith("a");
  });

  it("exposes close control focus-visible ring for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "关闭审批面板" }).className).toContain(
      "focus-visible:ring-2",
    );
  });
});
