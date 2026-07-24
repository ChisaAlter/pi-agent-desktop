// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSkillsStore } from "../../stores/skills-store";
import { MySkills } from "./MySkills";

describe("MySkills", () => {
  beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
      value: {
        skillsInstalled: vi.fn(async () => [{ slug: "web-search", enabled: true }]),
        skillsUninstall: vi.fn(async () => undefined),
        skillsCheck: vi.fn(async () => true),
      },
      configurable: true,
    });
    useSkillsStore.setState({
      skillhubAvailable: true,
      installed: [{ slug: "web-search", enabled: true }],
      installedLoading: false,
      error: null,
    });
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  it("confirms uninstall inside the app instead of window.confirm", async () => {
    render(<MySkills />);

    fireEvent.click(await screen.findByRole("button", { name: "卸载" }));

    expect(screen.getByRole("dialog", { name: "确认卸载技能" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "卸载" })[1]);

    await waitFor(() => {
      expect(window.piAPI.skillsUninstall).toHaveBeenCalledWith("web-search");
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("rechecks SkillHub availability without reloading the app", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      configurable: true,
    });
    useSkillsStore.setState({
      skillhubAvailable: false,
      installed: [],
      installedLoading: false,
      error: null,
    });

    render(<MySkills />);

    fireEvent.click(screen.getByRole("button", { name: "重新检测" }));

    await waitFor(() => {
      expect(window.piAPI.skillsCheck).toHaveBeenCalled();
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("exposes uninstall dialog cancel/confirm focus-visible rings", async () => {
    render(<MySkills />);
    fireEvent.click(await screen.findByRole("button", { name: "卸载" }));
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getAllByRole("button", { name: "卸载" })[1];
    expect(cancel.className).toContain("focus-visible:ring-2");
    expect(confirm.className).toContain("focus-visible:ring-2");
  });

  it("exposes installed-skills filter focus-visible ring for keyboard a11y", async () => {
    render(<MySkills />);
    const input = await screen.findByPlaceholderText("过滤已装技能...");
    expect(input.className).toContain("focus-visible:ring-2");
  });


  it("exposes row action focus-visible rings for keyboard a11y", async () => {
    render(<MySkills />);
    const disableBtn = await screen.findByRole("button", { name: "禁用" });
    expect(disableBtn.className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "卸载" }).className).toContain("focus-visible:ring-2");
  });

});
