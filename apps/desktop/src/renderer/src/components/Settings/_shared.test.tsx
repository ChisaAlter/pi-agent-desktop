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
});
