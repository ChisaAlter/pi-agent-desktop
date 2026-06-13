// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiSlashCommand } from "@shared";
import { useSlashCommands } from "./useSlashCommands";

const COMMANDS: PiSlashCommand[] = [
  { name: "model", description: "Select model", source: "builtin", desktopAction: "open-models" },
  { name: "settings", description: "Open settings", source: "builtin", desktopAction: "open-settings" },
  { name: "plan", description: "Plan work", source: "extension" },
  { name: "skill:tdd", description: "Use TDD", source: "skill" },
];

describe("useSlashCommands", () => {
  beforeEach(() => {
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => COMMANDS),
      },
      configurable: true,
    });
  });

  it("activates for slash input at the start of the draft and filters commands", async () => {
    const { result, rerender } = renderHook(
      ({ text, cursor }) => useSlashCommands(text, cursor, "ws1"),
      { initialProps: { text: "/", cursor: 1 } },
    );

    await waitFor(() => {
      expect(result.current.activeCommand?.query).toBe("");
      expect(result.current.candidates.map((candidate) => candidate.command.name)).toContain("model");
    });

    rerender({ text: "/mo", cursor: 3 });

    await waitFor(() => {
      expect(result.current.activeCommand?.query).toBe("mo");
      expect(result.current.candidates.map((candidate) => candidate.command.name)).toEqual(["model"]);
    });
  });

  it("does not activate for slash text away from the beginning", async () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSlashCommands(text, text.length, "ws1"),
      { initialProps: { text: "hello /mo" } },
    );

    await waitFor(() => {
      expect(result.current.activeCommand).toBeNull();
      expect(result.current.candidates).toEqual([]);
    });

    rerender({ text: "/src/app.ts" });

    await waitFor(() => {
      expect(result.current.activeCommand).toBeNull();
      expect(result.current.candidates).toEqual([]);
    });
  });

  it("replaces the active slash token when selecting a command", async () => {
    const { result, rerender } = renderHook(
      ({ text, cursor }) => useSlashCommands(text, cursor, "ws1"),
      { initialProps: { text: "/ski", cursor: 4 } },
    );

    await waitFor(() => {
      expect(result.current.candidates[0]?.command.name).toBe("skill:tdd");
    });

    const selectedText = result.current.selectCandidate(result.current.candidates[0]);
    expect(selectedText).toBe("/skill:tdd");

    rerender({ text: selectedText, cursor: selectedText.length });

    await waitFor(() => {
      expect(result.current.activeCommand).toBeNull();
    });
  });

  it("adds a trailing space only for commands that require arguments", async () => {
    Object.defineProperty(window, "piAPI", {
      value: {
        listSlashCommands: vi.fn(async () => [
          { name: "compact", description: "Compact", source: "builtin", desktopAction: "compact", requiresArgument: true },
        ]),
      },
      configurable: true,
    });
    const { result } = renderHook(
      () => useSlashCommands("/com", 4, "ws1"),
    );

    await waitFor(() => {
      expect(result.current.candidates[0]?.command.name).toBe("compact");
    });

    expect(result.current.selectCandidate(result.current.candidates[0])).toBe("/compact ");
  });
});
