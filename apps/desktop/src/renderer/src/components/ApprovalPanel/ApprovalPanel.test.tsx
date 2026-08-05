// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ApprovalPanel } from "./ApprovalPanel";
import type { PendingChange } from "../../stores/approval-store";

const {
  keepChange,
  undoChange,
  undoAll,
  keepAll,
  toggleAutoApprove,
  setAutoApprove,
  useApprovalStore,
} = vi.hoisted(() => {
  const keepChange = vi.fn();
  const undoChange = vi.fn();
  const undoAll = vi.fn().mockResolvedValue(undefined);
  const keepAll = vi.fn();
  const toggleAutoApprove = vi.fn();
  const setAutoApprove = vi.fn();
  let state = {
    changes: [] as PendingChange[],
    autoApprove: false,
    undoError: {} as Record<string, string>,
    keepChange,
    undoChange,
    undoAll,
    keepAll,
    toggleAutoApprove,
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
          undoError: {},
          keepChange,
          undoChange,
          undoAll,
          keepAll,
          toggleAutoApprove,
          setAutoApprove,
        };
      },
    },
  );
  return {
    keepChange,
    undoChange,
    undoAll,
    keepAll,
    toggleAutoApprove,
    setAutoApprove,
    useApprovalStore,
  };
});

vi.mock("../../stores/approval-store", () => ({ useApprovalStore }));

vi.mock("./ChangeApprovalCard", () => ({
  ChangeApprovalCard: ({
    filePath,
    changes,
    onKeep,
    onUndo,
    undoError,
  }: {
    filePath: string;
    changes: PendingChange[];
    onKeep: (id: string) => void;
    onUndo: (id: string) => void;
    undoError: Record<string, string>;
  }) => (
    <div data-testid={`group-${filePath}`}>
      <span>{filePath}</span>
      <button type="button" onClick={() => onKeep(changes[0]!.id)}>
        keep-{changes[0]!.id}
      </button>
      <button type="button" onClick={() => onUndo(changes[0]!.id)}>
        undo-{changes[0]!.id}
      </button>
      {undoError[changes[0]!.id] ? <span>{undoError[changes[0]!.id]}</span> : null}
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
    keepChange.mockClear();
    undoChange.mockClear();
    undoAll.mockClear(); // 保留 mockResolvedValue 实现, 只清调用记录
    keepAll.mockClear();
    toggleAutoApprove.mockClear();
    setAutoApprove.mockClear();
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
    const panel = screen.getByRole("dialog", { name: "文件变更" });
    expect(panel).toBeTruthy();
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("z-[230]");
    expect(screen.getByText("暂无变更")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起面板" })).toBeTruthy();
  });

  it("groups changes by file, wires keep/undo and bulk actions + auto-approve", async () => {
    useApprovalStore.setState({
      changes: [
        makeChange("a"),
        makeChange("b", "approved"),
        makeChange("c", "pending"),
      ],
      autoApprove: false,
    });
    const onToggle = vi.fn();
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={onToggle} />
      </I18nProvider>,
    );

    // 两个文件分组 (a.ts + c.ts), b.ts 已处理也展示
    expect(screen.getByTestId("group-a.ts")).toBeTruthy();
    expect(screen.getByTestId("group-b.ts")).toBeTruthy();
    expect(screen.getByTestId("group-c.ts")).toBeTruthy();
    expect(screen.getByLabelText("2 个待处理")).toBeTruthy();

    // 单条 keep/undo 路由
    fireEvent.click(screen.getByRole("button", { name: "keep-a" }));
    fireEvent.click(screen.getByRole("button", { name: "undo-c" }));
    expect(keepChange).toHaveBeenCalledWith("a");
    expect(undoChange).toHaveBeenCalledWith("c");

    // 批量
    fireEvent.click(screen.getByRole("button", { name: "全部保留" }));
    await waitFor(() => expect(keepAll).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "全部撤销" }));
    await waitFor(() => {
      expect(undoAll).toHaveBeenCalledTimes(1);
    });

    // 自动放行
    const auto = screen.getByRole("switch", { name: "自动放行" });
    expect(auto.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(auto);
    expect(toggleAutoApprove).toHaveBeenCalledTimes(1);
    expect(setAutoApprove).toHaveBeenCalledWith(true);

    // 收起 = dismiss, 只通知 onToggle
    fireEvent.click(screen.getByRole("button", { name: "收起面板" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("exposes close control focus-visible ring for keyboard a11y", () => {
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "收起面板" }).className).toContain(
      "focus-visible:ring-2",
    );
  });

  it("floats over the app instead of stretching document flow under the composer", () => {
    render(
      <I18nProvider>
        <ApprovalPanel isOpen onToggle={vi.fn()} />
      </I18nProvider>,
    );
    const panel = screen.getByTestId("approval-panel");
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("bottom-3");
    expect(panel.className).toContain("right-3");
    expect(panel.className).not.toMatch(/(?:^|\s)h-full(?:\s|$)/);
    expect(panel.className).not.toContain("border-l");
  });
});
