import { describe, expect, it } from "vitest";
import { isSettingsTab } from "./tab-defs";

describe("isSettingsTab", () => {
  it("accepts known settings tab ids", () => {
    for (const id of [
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ] as const) {
      expect(isSettingsTab(id)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isSettingsTab("models")).toBe(false);
    expect(isSettingsTab("")).toBe(false);
    expect(isSettingsTab(null)).toBe(false);
    expect(isSettingsTab(1)).toBe(false);
  });

  // wave-108 residual
  it("rejects undefined, booleans, objects, and near-miss tab ids", () => {
    expect(isSettingsTab(undefined)).toBe(false);
    expect(isSettingsTab(true)).toBe(false);
    expect(isSettingsTab({ id: "model" })).toBe(false);
    expect(isSettingsTab("Model")).toBe(false);
    expect(isSettingsTab("pi-agent")).toBe(false);
    expect(isSettingsTab("longhorizon")).toBe(false);
  });

  // wave-124 residual
  it("rejects arrays, symbols, and whitespace-padded known ids", () => {
    expect(isSettingsTab(["model"])).toBe(false);
    expect(isSettingsTab(Symbol("model"))).toBe(false);
    expect(isSettingsTab(" model")).toBe(false);
    expect(isSettingsTab("model ")).toBe(false);
    expect(isSettingsTab("usage\n")).toBe(false);
  });


  // wave-293 residual
  it("accepts all ten product SettingsTab ids only", () => {
    const all = [
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ] as const;
    expect(all).toHaveLength(10);
    for (const id of all) expect(isSettingsTab(id)).toBe(true);
    expect(isSettingsTab("tools")).toBe(false);
    expect(isSettingsTab("settings")).toBe(false);
    expect(isSettingsTab(0)).toBe(false);
  });

  it("isSettingsTab is strict equality (no trim/case fold)", () => {
    expect(isSettingsTab("ABOUT")).toBe(false);
    expect(isSettingsTab("LongHorizon")).toBe(false);
    expect(isSettingsTab(" longHorizon")).toBe(false);
    expect(isSettingsTab("longHorizon ")).toBe(false);
  });



  // wave-302 residual
  it("isSettingsTab accepts exact product union members only", () => {
    const ids = [
      "model",
      "piagent",
      "permissions",
      "usage",
      "longHorizon",
      "appearance",
      "general",
      "shortcuts",
      "config",
      "about",
    ] as const;
    expect(ids).toHaveLength(10);
    for (const id of ids) expect(isSettingsTab(id)).toBe(true);
    expect(isSettingsTab("long-horizon")).toBe(false);
    expect(isSettingsTab("PiAgent")).toBe(false);
    expect(isSettingsTab([])).toBe(false);
  });

  it("rejects near-miss strings and non-strings without coercion", () => {
    expect(isSettingsTab("models")).toBe(false);
    expect(isSettingsTab("permission")).toBe(false);
    expect(isSettingsTab("configs")).toBe(false);
    expect(isSettingsTab(NaN)).toBe(false);
    expect(isSettingsTab(false)).toBe(false);
  });

});
