import { beforeEach, describe, expect, it, vi } from "vitest";

const addToast = vi.fn();

vi.mock("../toast-store", () => ({
  addToast,
}));

describe("skills-store", () => {
  beforeEach(() => {
    vi.resetModules();
    addToast.mockReset();
    vi.unstubAllGlobals();
  });

  async function load() {
    return import("../skills-store");
  }

  it("checkAvailability stores boolean from IPC", async () => {
    vi.stubGlobal("window", {
      piAPI: { skillsCheck: vi.fn(async () => true) },
    });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({ skillhubAvailable: null });
    await useSkillsStore.getState().checkAvailability();
    expect(useSkillsStore.getState().skillhubAvailable).toBe(true);
  });

  it("checkAvailability falls back to false on failure", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsCheck: vi.fn(async () => {
          throw new Error("no skillhub");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().checkAvailability();
    expect(useSkillsStore.getState().skillhubAvailable).toBe(false);
  });

  it("searchMarket clears results for empty query", async () => {
    const skillsSearch = vi.fn();
    vi.stubGlobal("window", { piAPI: { skillsSearch } });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({
      marketQuery: "   ",
      marketResults: [
        {
          slug: "x",
          name: "X",
          description: "",
          version: "0.0.1",
        },
      ],
    });
    await useSkillsStore.getState().searchMarket();
    expect(skillsSearch).not.toHaveBeenCalled();
    expect(useSkillsStore.getState().marketResults).toEqual([]);
  });

  it("searchMarket stores results and clears loading", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsSearch: vi.fn(async () => [
          {
            slug: "demo",
            name: "Demo",
            description: "d",
            version: "1.0.0",
          },
        ]),
      },
    });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({ marketQuery: "demo" });
    await useSkillsStore.getState().searchMarket();
    expect(useSkillsStore.getState().marketResults[0]?.slug).toBe("demo");
    expect(useSkillsStore.getState().marketLoading).toBe(false);
  });

  it("searchMarket records error on failure", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsSearch: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
    });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({ marketQuery: "x" });
    await useSkillsStore.getState().searchMarket();
    expect(useSkillsStore.getState().error).toBe("network down");
    expect(useSkillsStore.getState().marketLoading).toBe(false);
  });

  it("installSkill refreshes installed list", async () => {
    const skillsInstall = vi.fn(async () => undefined);
    const skillsInstalled = vi.fn(async () => [{ slug: "demo", enabled: true }]);
    vi.stubGlobal("window", { piAPI: { skillsInstall, skillsInstalled } });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().installSkill("demo");
    expect(skillsInstall).toHaveBeenCalledWith("demo");
    expect(useSkillsStore.getState().installed).toEqual([{ slug: "demo", enabled: true }]);
  });

  it("uninstallSkill toasts on failure", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsUninstall: vi.fn(async () => {
          throw new Error("busy");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().uninstallSkill("demo");
    expect(useSkillsStore.getState().error).toBe("busy");
    expect(addToast).toHaveBeenCalledWith("卸载技能失败: busy", "error");
  });

  it("toggleSkill refreshes after IPC", async () => {
    const skillsToggle = vi.fn(async () => undefined);
    const skillsInstalled = vi.fn(async () => [{ slug: "demo", enabled: false }]);
    vi.stubGlobal("window", { piAPI: { skillsToggle, skillsInstalled } });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().toggleSkill("demo", false);
    expect(skillsToggle).toHaveBeenCalledWith("demo", false);
    expect(useSkillsStore.getState().installed[0]?.enabled).toBe(false);
  });

  // wave-103 residual
  it("installSkill records error and rethrows on failure", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsInstall: vi.fn(async () => {
          throw new Error("quota");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await expect(useSkillsStore.getState().installSkill("demo")).rejects.toThrow("quota");
    expect(useSkillsStore.getState().error).toBe("quota");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("refreshInstalled records error without crashing", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsInstalled: vi.fn(async () => {
          throw new Error("list failed");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().refreshInstalled();
    expect(useSkillsStore.getState().error).toBe("list failed");
    expect(useSkillsStore.getState().installedLoading).toBe(false);
  });

  it("setMarketQuery updates query without searching", async () => {
    const skillsSearch = vi.fn();
    vi.stubGlobal("window", { piAPI: { skillsSearch } });
    const { useSkillsStore } = await load();
    useSkillsStore.getState().setMarketQuery("  foo  ");
    expect(useSkillsStore.getState().marketQuery).toBe("  foo  ");
    expect(skillsSearch).not.toHaveBeenCalled();
  });

  // wave-122 residual
  it("searchMarket narrows non-array IPC payload to empty results", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsSearch: vi.fn(async () => ({ not: "array" })),
      },
    });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({ marketQuery: "demo" });
    await useSkillsStore.getState().searchMarket();
    expect(useSkillsStore.getState().marketResults).toEqual([]);
    expect(useSkillsStore.getState().marketLoading).toBe(false);
  });

  it("checkAvailability narrows non-boolean truthy IPC values", async () => {
    vi.stubGlobal("window", {
      piAPI: { skillsCheck: vi.fn(async () => "yes") },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().checkAvailability();
    expect(useSkillsStore.getState().skillhubAvailable).toBe(true);
  });

  it("uninstallSkill toasts on failure without rethrowing", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsUninstall: vi.fn(async () => {
          throw new Error("busy");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await expect(useSkillsStore.getState().uninstallSkill("demo")).resolves.toBeUndefined();
    expect(useSkillsStore.getState().error).toBe("busy");
    expect(addToast).toHaveBeenCalledWith("卸载技能失败: busy", "error");
  });

  it("refreshInstalled narrows non-array installed payload to empty", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsInstalled: vi.fn(async () => "nope"),
      },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().refreshInstalled();
    expect(useSkillsStore.getState().installed).toEqual([]);
    expect(useSkillsStore.getState().installedLoading).toBe(false);
  });

  // wave-129 residual
  it("searchMarket blank query clears results without IPC", async () => {
    const skillsSearch = vi.fn(async () => [{ slug: "x" }]);
    vi.stubGlobal("window", { piAPI: { skillsSearch } });
    const { useSkillsStore } = await load();
    useSkillsStore.setState({ marketQuery: "   ", marketResults: [{ slug: "stale" } as never] });
    await useSkillsStore.getState().searchMarket();
    expect(skillsSearch).not.toHaveBeenCalled();
    expect(useSkillsStore.getState().marketResults).toEqual([]);
    expect(useSkillsStore.getState().marketLoading).toBe(false);
  });

  it("installSkill rethrows and sets error without toast", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsInstall: vi.fn(async () => {
          throw new Error("network");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await expect(useSkillsStore.getState().installSkill("demo")).rejects.toThrow("network");
    expect(useSkillsStore.getState().error).toBe("network");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("toggleSkill toasts on failure without rethrowing", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        skillsToggle: vi.fn(async () => {
          throw new Error("locked");
        }),
      },
    });
    const { useSkillsStore } = await load();
    await expect(useSkillsStore.getState().toggleSkill("demo", false)).resolves.toBeUndefined();
    expect(useSkillsStore.getState().error).toBe("locked");
    expect(addToast).toHaveBeenCalledWith("切换技能失败: locked", "error");
  });

  // wave-245 residual
  it("missing skills* IPC surfaces product error messages; check falls back false", async () => {
    vi.stubGlobal("window", { piAPI: {} });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().checkAvailability();
    expect(useSkillsStore.getState().skillhubAvailable).toBe(false);

    useSkillsStore.setState({ marketQuery: "x" });
    await useSkillsStore.getState().searchMarket();
    expect(useSkillsStore.getState().error).toBe("Skill search IPC unavailable");
    expect(useSkillsStore.getState().marketLoading).toBe(false);

    await useSkillsStore.getState().refreshInstalled();
    expect(useSkillsStore.getState().error).toBe("Installed skills IPC unavailable");
    expect(useSkillsStore.getState().installedLoading).toBe(false);

    await expect(useSkillsStore.getState().installSkill("s")).rejects.toThrow(
      "Skill install IPC unavailable",
    );
    expect(useSkillsStore.getState().error).toBe("Skill install IPC unavailable");

    await useSkillsStore.getState().uninstallSkill("s");
    expect(useSkillsStore.getState().error).toBe("Skill uninstall IPC unavailable");
    expect(addToast).toHaveBeenCalledWith(
      "卸载技能失败: Skill uninstall IPC unavailable",
      "error",
    );

    await useSkillsStore.getState().toggleSkill("s", true);
    expect(useSkillsStore.getState().error).toBe("Skill toggle IPC unavailable");
    expect(addToast).toHaveBeenCalledWith(
      "切换技能失败: Skill toggle IPC unavailable",
      "error",
    );
  });

  it("installSkill refreshes installed list on success; narrowCheck treats 0 as false", async () => {
    const skillsInstalled = vi.fn(async () => [{ slug: "demo", enabled: true }]);
    vi.stubGlobal("window", {
      piAPI: {
        skillsInstall: vi.fn(async () => undefined),
        skillsInstalled,
        skillsCheck: vi.fn(async () => 0),
      },
    });
    const { useSkillsStore } = await load();
    await useSkillsStore.getState().installSkill("demo");
    expect(skillsInstalled).toHaveBeenCalled();
    expect(useSkillsStore.getState().installed).toEqual([{ slug: "demo", enabled: true }]);
    expect(useSkillsStore.getState().error).toBeNull();

    await useSkillsStore.getState().checkAvailability();
    expect(useSkillsStore.getState().skillhubAvailable).toBe(false);
  });
});
