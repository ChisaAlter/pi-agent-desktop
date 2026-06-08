// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RightRail } from "./RightRail";
import { usePlanStore } from "../../stores/plan-store";
import { useAgentStore } from "../../stores/agent-store";

describe("RightRail", () => {
  const getGitStatus = vi.fn();

  beforeEach(() => {
    getGitStatus.mockReset();
    Object.defineProperty(window, "piAPI", {
      value: { getGitStatus },
      configurable: true,
    });
    useAgentStore.setState({
      agents: [],
      currentAgentId: null,
      messagesByAgent: {},
      runtimeByAgent: {},
      initialized: true,
    });
    usePlanStore.setState({
      enabled: false,
      activeCard: null,
      decisionRequest: null,
      steps: [],
      status: "idle",
    });
  });

  it("renders environment git information from the current workspace", async () => {
    getGitStatus.mockResolvedValue({
      branch: "master",
      modified: ["a.ts", "b.ts"],
      added: ["c.ts"],
      deleted: [],
      untracked: ["d.ts"],
      ahead: 1,
      behind: 2,
    });

    render(<RightRail workspacePath="C:/ai/pi-agent-desktop/apps/desktop" />);

    await waitFor(() => {
      expect(screen.getByText("master")).toBeTruthy();
    });
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(getGitStatus).toHaveBeenCalledWith("C:/ai/pi-agent-desktop/apps/desktop");
  });

  it("renders Agent card with idle status when agent exists", () => {
    useAgentStore.setState({
      agents: [{ id: "a1", workspaceId: "ws1", title: "Demo Agent", status: "idle", createdAt: 1, updatedAt: 1 }],
      currentAgentId: "a1",
    });

    render(<RightRail />);

    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("空闲")).toBeTruthy();
  });

  it("renders Agent card with not-created status when no agent exists", () => {
    render(<RightRail />);

    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("未创建")).toBeTruthy();
  });
it("prefers plan checklist over generic task activity", () => {
    usePlanStore.setState({
      steps: [
        { id: "s1", text: "梳理界面", status: "completed" },
        { id: "s2", text: "执行计划", status: "running" },
      ],
    });

    render(
      <RightRail
        tasks={[{ id: "t1", name: "普通任务", status: "running" }]}
      />,
    );

    expect(screen.getByText("梳理界面")).toBeTruthy();
    expect(screen.getByText("执行计划")).toBeTruthy();
    expect(screen.queryByText("普通任务")).toBeNull();
  });
});
