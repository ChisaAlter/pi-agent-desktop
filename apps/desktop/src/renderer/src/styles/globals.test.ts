import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global interaction styles", () => {
  it("does not apply press scaling to every interactive element", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).not.toMatch(/:is\(button,[^}]+:active[^}]+scale:\s*0\.96/s);
  });
});
