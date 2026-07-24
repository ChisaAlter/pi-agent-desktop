// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SwitchControl } from "./_shared";

describe("Settings shared controls", () => {
    it("anchors the switch thumb inside the track", () => {
        render(<SwitchControl checked label="增强能力" onChange={vi.fn()} />);

        const thumb = screen.getByRole("switch", { name: "增强能力" }).querySelector("span");

        expect(thumb?.className).toContain("left-0.5");
        expect(thumb?.className).toContain("translate-x-5");
        expect(thumb?.className).not.toContain("translate-x-0.5");
    });

    it("exposes switch focus-visible ring for keyboard a11y", () => {
        render(<SwitchControl checked={false} label="增强能力" onChange={vi.fn()} />);
        const control = screen.getByRole("switch", { name: "增强能力" });
        expect(control.getAttribute("type")).toBe("button");
        expect(control.className).toContain("focus-visible:ring-2");
        expect(control.getAttribute("aria-checked")).toBe("false");
    });
});
