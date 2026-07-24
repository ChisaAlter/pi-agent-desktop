// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LONG_HORIZON_SETTINGS } from "@shared";
import { I18nProvider } from "../../../i18n";
import { LongHorizonTab } from "./LongHorizonTab";

const { updateSettings, useSettingsStore, useRuntimeFeatureStore } = vi.hoisted(() => {
  const updateSettings = vi.fn();
  const useSettingsStore = vi.fn(() => ({
    settings: {
      longHorizon: {
        ...DEFAULT_LONG_HORIZON_SETTINGS,
        enabled: true,
        defaultMode: "build" as const,
      },
    },
    updateSettings,
  }));
  // null featureState → fallbackAgentModes from longHorizon settings
  const useRuntimeFeatureStore = vi.fn(
    (selector: (s: { featureState: null }) => unknown) => selector({ featureState: null }),
  );
  return { updateSettings, useSettingsStore, useRuntimeFeatureStore };
});

vi.mock("../../../stores/settings-store", () => ({ useSettingsStore }));
vi.mock("../../../stores/runtime-feature-store", async () => {
  const actual = await vi.importActual<typeof import("../../../stores/runtime-feature-store")>(
    "../../../stores/runtime-feature-store",
  );
  return {
    ...actual,
    useRuntimeFeatureStore,
  };
});

describe("LongHorizonTab", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    useSettingsStore.mockImplementation(() => ({
      settings: {
        longHorizon: {
          ...DEFAULT_LONG_HORIZON_SETTINGS,
          enabled: true,
          defaultMode: "build" as const,
        },
      },
      updateSettings,
    }));
  });

  it("renders heading and toggles master long-horizon switch", () => {
    render(
      <I18nProvider>
        <LongHorizonTab />
      </I18nProvider>,
    );
    expect(screen.getByText("长程能力")).toBeTruthy();
    const master = screen.getByRole("switch", { name: "启用增强能力" });
    fireEvent.click(master);
    expect(updateSettings).toHaveBeenCalled();
    const arg = updateSettings.mock.calls[0]?.[0] as {
      longHorizon: { enabled: boolean };
    };
    expect(arg.longHorizon.enabled).toBe(false);
  });

  it("changes default mode via select", () => {
    render(
      <I18nProvider>
        <LongHorizonTab />
      </I18nProvider>,
    );
    const select = screen.getByRole("combobox", { name: "默认会话模式" });
    fireEvent.change(select, { target: { value: "plan" } });
    expect(updateSettings).toHaveBeenCalled();
    const arg = updateSettings.mock.calls[0]?.[0] as {
      longHorizon: { defaultMode: string };
    };
    expect(arg.longHorizon.defaultMode).toBe("plan");
  });

  it("toggles Plan Mode feature switch", () => {
    render(
      <I18nProvider>
        <LongHorizonTab />
      </I18nProvider>,
    );
    const plan = screen.getByRole("switch", { name: "Plan Mode" });
    fireEvent.click(plan);
    expect(updateSettings).toHaveBeenCalled();
    const arg = updateSettings.mock.calls[0]?.[0] as {
      longHorizon: { planMode: { enabled: boolean } };
    };
    expect(arg.longHorizon.planMode.enabled).toBe(false);
  });

  it("exposes default mode select focus-visible ring for keyboard a11y", () => {
    render(
      <I18nProvider>
        <LongHorizonTab />
      </I18nProvider>,
    );
    expect(screen.getByRole("combobox").className).toContain("focus-visible:ring-2");
  });

});
