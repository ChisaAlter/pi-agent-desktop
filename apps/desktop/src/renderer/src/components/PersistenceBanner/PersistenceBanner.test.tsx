// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PersistenceBanner } from "./PersistenceBanner";
import { useSessionStore } from "../../stores/session-store";

describe("PersistenceBanner", () => {
  beforeEach(() => {
    useSessionStore.setState({
      persistErrorCount: 0,
      lastPersistError: null,
    });
  });

  it("renders as a fixed in-window overlay instead of changing the layout flow height", () => {
    useSessionStore.setState({
      persistErrorCount: 2,
      lastPersistError: "disk full",
    });

    render(<PersistenceBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.className).toContain("fixed");
    expect(banner.className).toContain("top-8");
  });

  it("dismisses the banner via the session store action", () => {
    useSessionStore.setState({
      persistErrorCount: 1,
      lastPersistError: "disk full",
    });

    render(<PersistenceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "关闭持久化失败提示" }));

    expect(useSessionStore.getState().persistErrorCount).toBe(0);
  });

  it("stays hidden when there are no persist errors", () => {
    render(<PersistenceBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("exposes dismiss button type and focus-visible ring", () => {
    useSessionStore.setState({
      persistErrorCount: 3,
      lastPersistError: "ENOSPC",
    });
    render(<PersistenceBanner />);
    const dismiss = screen.getByRole("button", { name: "关闭持久化失败提示" });
    expect(dismiss.getAttribute("type")).toBe("button");
    expect(dismiss.className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("alert").textContent).toContain("ENOSPC");
    expect(screen.getByRole("alert").textContent).toContain("3 次");
  });
});
