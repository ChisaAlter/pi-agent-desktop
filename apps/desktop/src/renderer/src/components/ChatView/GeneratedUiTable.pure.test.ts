import { describe, expect, it } from "vitest";
import { compareValues, formatValue } from "./GeneratedUiTable";

describe("GeneratedUiTable pure helpers", () => {
  it("compareValues sorts numbers and strings", () => {
    expect(compareValues(1, 10)).toBeLessThan(0);
    expect(compareValues(10, 1)).toBeGreaterThan(0);
    expect(compareValues("a", "b")).toBeLessThan(0);
    expect(compareValues(null, "x")).toBeLessThan(0);
    expect(compareValues("file2", "file10")).toBeLessThan(0);
  });

  it("formatValue handles null, bool, number, percent", () => {
    expect(formatValue(null, "text")).toBe("");
    expect(formatValue(true, "text")).toBe("是");
    expect(formatValue(false, "text")).toBe("否");
    expect(formatValue(1234.5, "number")).toMatch(/1[,.]?234/);
    expect(formatValue(12.5, "percent")).toContain("%");
    expect(formatValue("plain", "text")).toBe("plain");
  });

  // wave-106 residual
  it("compareValues treats equals and nullish pairs as empty-string order", () => {
    expect(compareValues(5, 5)).toBe(0);
    expect(compareValues("same", "same")).toBe(0);
    expect(compareValues(null, null)).toBe(0);
    expect(compareValues(null, "")).toBe(0);
    expect(compareValues("", "x")).toBeLessThan(0);
  });

  it("formatValue falls back to String for non-number number/percent formats", () => {
    expect(formatValue("n/a", "number")).toBe("n/a");
    expect(formatValue("n/a", "percent")).toBe("n/a");
    expect(formatValue(0, "percent")).toContain("%");
    expect(formatValue(0, "number")).toMatch(/0/);
  });

  // wave-124 residual
  it("compareValues uses numeric localeCompare for mixed types and booleans", () => {
    expect(compareValues(true, false)).toBeGreaterThan(0); // "true" > "false"
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(2, "10")).toBeLessThan(0); // numeric: true → 2 < 10
    expect(compareValues("file10", "file2")).toBeGreaterThan(0);
  });

  it("formatValue with undefined format stringifies primitives without percent/number formatting", () => {
    expect(formatValue(12.5, undefined)).toBe("12.5");
    expect(formatValue(true, undefined)).toBe("是");
    expect(formatValue(null, undefined)).toBe("");
    expect(formatValue("keep", undefined)).toBe("keep");
  });
});


// wave-294 residual
describe("GeneratedUiTable pure residual (wave-294)", () => {
  it("compareValues only uses numeric subtract when both sides are numbers", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    // number vs string → localeCompare path with numeric:true
    expect(compareValues(2, "10")).toBeLessThan(0);
    expect(compareValues("2", 10)).toBeLessThan(0);
    expect(compareValues(-5, -1)).toBeLessThan(0);
    expect(compareValues(0, -0)).toBe(0);
  });

  it("formatValue percent uses max 2 fraction digits; number uses Intl; bool stays 是/否", () => {
    const pct = formatValue(1.23456, "percent");
    expect(pct.endsWith("%")).toBe(true);
    // maximumFractionDigits: 2 → not full 1.23456 string
    expect(pct.includes("1.23456")).toBe(false);
    expect(formatValue(-12, "number")).toMatch(/-?12/);
    expect(formatValue(false, "number")).toBe("否"); // boolean branch before String
    expect(formatValue(true, "percent")).toBe("是");
  });

  it("formatValue null always empty regardless of format; undefined format stringifies numbers", () => {
    expect(formatValue(null, "number")).toBe("");
    expect(formatValue(null, "percent")).toBe("");
    expect(formatValue(null, undefined)).toBe("");
    expect(formatValue(3.14, undefined)).toBe("3.14");
  });
});

// wave-304 residual
describe("GeneratedUiTable pure residual (wave-304)", () => {
  it("compareValues numeric-aware localeCompare for file-like names and equals", () => {
    expect(compareValues("file2", "file10")).toBeLessThan(0);
    expect(compareValues("file10", "file2")).toBeGreaterThan(0);
    expect(compareValues(0, 0)).toBe(0);
    expect(compareValues(false, false)).toBe(0);
    expect(compareValues(null, undefined as never)).toBe(0);
    expect(compareValues(null, "a")).toBeLessThan(0);
    expect(compareValues("a", null)).toBeGreaterThan(0);
  });

  it("formatValue boolean 是/否; percent and number locales; boolean with number format still 是/否", () => {
    expect(formatValue(true, "text")).toBe("是");
    expect(formatValue(false, "text")).toBe("否");
    expect(formatValue(null, "number")).toBe("");
    expect(formatValue(null, "percent")).toBe("");
    const pct = formatValue(12.5, "percent");
    expect(pct).toContain("%");
    expect(formatValue(0, "number")).toMatch(/0/);
    expect(formatValue("plain", undefined)).toBe("plain");
    // product: boolean branch runs after number/percent typeof checks, so true+number => 是
    expect(formatValue(true, "number")).toBe("是");
  });
});
