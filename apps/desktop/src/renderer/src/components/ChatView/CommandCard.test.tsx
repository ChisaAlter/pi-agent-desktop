// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../stores/session-store";
import { CommandCard } from "./CommandCard";

describe("CommandCard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  it("copies command and output and exposes output file actions", async () => {
    const openFileSpy = vi.fn();
    const runCommandSpy = vi.fn();
    window.addEventListener("workspace:open-file", openFileSpy);
    window.addEventListener("terminal:run-command", runCommandSpy);
    const toolCall: ToolCall = {
      id: "tc1",
      name: "bash",
      input: { command: "pnpm test" },
      output: "Wrote docs/result.md and C:/repo/src/generated.ts",
      status: "completed",
      startTime: new Date(0),
      endTime: new Date(1000),
    };

    render(<CommandCard toolCall={toolCall} />);

    fireEvent.click(screen.getByRole("button", { name: /运行命令/ }));
    fireEvent.click(screen.getByRole("button", { name: "在终端运行" }));
    expect(runCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { command: "pnpm test", mode: "run" } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("pnpm test");

    fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(toolCall.output);

    fireEvent.click(screen.getByRole("button", { name: "打开 result.md" }));
    expect(openFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { path: "docs/result.md" } }),
    );

    await waitFor(() => expect(screen.getByText("已复制输出")).toBeTruthy());
    window.removeEventListener("workspace:open-file", openFileSpy);
    window.removeEventListener("terminal:run-command", runCommandSpy);
  });

  it("shows clipboard failures instead of reporting a false copy success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValueOnce(new Error("clipboard denied")) },
      configurable: true,
    });

    render(
      <CommandCard
        toolCall={{
          id: "tc-copy-failure",
          name: "bash",
          input: { command: "pnpm lint" },
          status: "completed",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /运行命令/ }));
    fireEvent.click(screen.getByRole("button", { name: "复制命令" }));

    expect((await screen.findByRole("alert")).textContent).toContain("复制失败: clipboard denied");
    expect(screen.queryByText("已复制命令")).toBeNull();
  });

  it("marks destructive commands as terminal drafts instead of auto-run", () => {
    const runCommandSpy = vi.fn();
    window.addEventListener("terminal:run-command", runCommandSpy);
    render(
      <CommandCard
        toolCall={{
          id: "tc-danger",
          name: "bash",
          input: { command: "rm -rf dist" },
          status: "completed",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /运行命令/ }));
    fireEvent.click(screen.getByRole("button", { name: "填入终端" }));

    expect(runCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { command: "rm -rf dist", mode: "draft" } }),
    );
    expect(screen.getByText("需手动确认执行")).toBeTruthy();
    window.removeEventListener("terminal:run-command", runCommandSpy);
  });

  it("exposes expand and action focus-visible rings for keyboard a11y", () => {
    render(
      <CommandCard
        toolCall={{
          id: "tc-a11y",
          name: "bash",
          input: { command: "pnpm test" },
          output: "ok",
          status: "completed",
        }}
      />,
    );

    const expand = screen.getByRole("button", { name: /运行命令/ });
    expect(expand.className).toContain("focus-visible:ring-2");
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "在终端运行" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "复制命令" }).className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "复制输出" }).className).toContain("focus-visible:ring-2");
  });
});
