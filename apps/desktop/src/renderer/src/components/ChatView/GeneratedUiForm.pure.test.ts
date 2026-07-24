import { describe, expect, it } from "vitest";
import { initialFieldValue, isEmptyFieldValue } from "./GeneratedUiForm";
import type { GeneratedUiFormField } from "@shared";

describe("GeneratedUiForm pure helpers", () => {
  it("initialFieldValue defaults by field kind", () => {
    expect(
      initialFieldValue({ id: "c", label: "C", kind: "checkbox" } as GeneratedUiFormField),
    ).toBe(false);
    expect(
      initialFieldValue({
        id: "c",
        label: "C",
        kind: "checkbox",
        defaultValue: true,
      } as GeneratedUiFormField),
    ).toBe(true);
    expect(
      initialFieldValue({ id: "m", label: "M", kind: "multi-select", options: [] } as GeneratedUiFormField),
    ).toEqual([]);
    expect(
      initialFieldValue({ id: "n", label: "N", kind: "number" } as GeneratedUiFormField),
    ).toBe("");
    expect(
      initialFieldValue({ id: "t", label: "T", kind: "text", defaultValue: "hi" } as GeneratedUiFormField),
    ).toBe("hi");
  });

  it("isEmptyFieldValue treats empty forms as empty", () => {
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue(false)).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue("x")).toBe(false);
    expect(isEmptyFieldValue(true)).toBe(false);
    expect(isEmptyFieldValue(["a"])).toBe(false);
    expect(isEmptyFieldValue(0)).toBe(false);
  });

  // wave-106 residual
  it("initialFieldValue respects select/textarea defaults and multi-select arrays", () => {
    expect(
      initialFieldValue({
        id: "s",
        label: "S",
        kind: "select",
        options: [{ label: "A", value: "a" }],
        defaultValue: "a",
      } as GeneratedUiFormField),
    ).toBe("a");
    expect(
      initialFieldValue({
        id: "ta",
        label: "TA",
        kind: "textarea",
      } as GeneratedUiFormField),
    ).toBe("");
    expect(
      initialFieldValue({
        id: "m",
        label: "M",
        kind: "multi-select",
        options: [],
        defaultValue: ["x", "y"],
      } as GeneratedUiFormField),
    ).toEqual(["x", "y"]);
  });

  it("isEmptyFieldValue does not treat zero or whitespace-only strings specially", () => {
    expect(isEmptyFieldValue(0)).toBe(false);
    expect(isEmptyFieldValue(" ")).toBe(false);
    expect(isEmptyFieldValue(["", ""])).toBe(false);
  });

  // wave-125 residual
  it("initialFieldValue keeps number defaultValue and empty string default", () => {
    expect(
      initialFieldValue({
        id: "n",
        label: "N",
        kind: "number",
        defaultValue: 0,
      }),
    ).toBe(0);
    expect(
      initialFieldValue({
        id: "n2",
        label: "N2",
        kind: "number",
        defaultValue: 42,
      }),
    ).toBe(42);
    expect(
      initialFieldValue({
        id: "t",
        label: "T",
        kind: "text",
        defaultValue: "",
      }),
    ).toBe("");
  });

  it("isEmptyFieldValue only empties empty string / false / empty array", () => {
    expect(isEmptyFieldValue(null as never)).toBe(false);
    expect(isEmptyFieldValue(undefined as never)).toBe(false);
    expect(isEmptyFieldValue(1)).toBe(false);
    // product FieldValue arrays are string[]; non-empty string array is not empty
    expect(isEmptyFieldValue(["0"])).toBe(false);
  });
});


// wave-294 residual
describe("GeneratedUiForm pure residual (wave-294)", () => {
  it("initialFieldValue defaults select/text/textarea to empty string when default missing", () => {
    expect(
      initialFieldValue({
        id: "s",
        label: "S",
        kind: "select",
        options: [{ label: "A", value: "a" }],
      } as GeneratedUiFormField),
    ).toBe("");
    expect(
      initialFieldValue({ id: "t", label: "T", kind: "text" } as GeneratedUiFormField),
    ).toBe("");
    expect(
      initialFieldValue({ id: "ta", label: "TA", kind: "textarea" } as GeneratedUiFormField),
    ).toBe("");
  });

  it("initialFieldValue keeps explicit false checkbox and empty multi-select default", () => {
    expect(
      initialFieldValue({
        id: "c",
        label: "C",
        kind: "checkbox",
        defaultValue: false,
      } as GeneratedUiFormField),
    ).toBe(false);
    expect(
      initialFieldValue({
        id: "m",
        label: "M",
        kind: "multi-select",
        options: [],
        defaultValue: [],
      } as GeneratedUiFormField),
    ).toEqual([]);
  });

  it("isEmptyFieldValue is true only for '', false, [] — not for whitespace or zero", () => {
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue(false)).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue("0")).toBe(false);
    expect(isEmptyFieldValue(0)).toBe(false);
    expect(isEmptyFieldValue("  ")).toBe(false);
    expect(isEmptyFieldValue([""])).toBe(false);
  });
});

// wave-305 residual
describe("GeneratedUiForm pure residual (wave-305)", () => {
  it("initialFieldValue checkbox false default vs explicit true; multi-select empty array default", () => {
    expect(
      initialFieldValue({ id: "c", label: "C", kind: "checkbox" } as GeneratedUiFormField),
    ).toBe(false);
    expect(
      initialFieldValue({
        id: "c2",
        label: "C2",
        kind: "checkbox",
        defaultValue: true,
      } as GeneratedUiFormField),
    ).toBe(true);
    expect(
      initialFieldValue({
        id: "m",
        label: "M",
        kind: "multi-select",
        options: [],
      } as GeneratedUiFormField),
    ).toEqual([]);
  });

  it("number defaultValue 0 is kept; missing number default is empty string", () => {
    expect(
      initialFieldValue({
        id: "n0",
        label: "N0",
        kind: "number",
        defaultValue: 0,
      } as GeneratedUiFormField),
    ).toBe(0);
    expect(
      initialFieldValue({ id: "n", label: "N", kind: "number" } as GeneratedUiFormField),
    ).toBe("");
  });

  it("isEmptyFieldValue only '', false, []; non-empty arrays and whitespace strings are not empty", () => {
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue(false)).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue(" ")).toBe(false);
    expect(isEmptyFieldValue(0)).toBe(false);
    expect(isEmptyFieldValue([""])).toBe(false);
    expect(isEmptyFieldValue(true)).toBe(false);
  });
});
