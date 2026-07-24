import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global interaction styles", () => {
  it("does not apply press scaling to every interactive element", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).not.toMatch(/:is\(button,[^}]+:active[^}]+scale:\s*0\.96/s);
  });

  it("keeps Markdown code blocks readable in narrow chat columns", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.markdown-body pre\s*\{[^}]*white-space:\s*pre-wrap/s);
    expect(css).toMatch(/\.markdown-body pre\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.markdown-body pre\s*\{[^}]*line-height:\s*1\.75/s);
  });

  // wave-108 residual
  it("defines focus-visible rings for interactive controls and dark theme overrides", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/button:focus-visible/);
    expect(css).toMatch(/\[role="switch"\]:focus-visible/);
    expect(css).toMatch(/:focus:not\(:focus-visible\)/);
    expect(css).toMatch(/\[data-theme="dark"\] button:focus-visible/);
  });

  it("disables press scale under reduced motion and inherits pre code wrap", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\.settings-pressable:active[\s\S]*scale:\s*none/);
    expect(css).toMatch(/\.markdown-body pre code\s*\{[^}]*white-space:\s*inherit/s);
    expect(css).toMatch(/\.markdown-body pre code\s*\{[^}]*overflow-wrap:\s*inherit/s);
  });
});
