import { describe, expect, it } from "vitest";
import { readToolCallId, readToolCallInput, readToolCallName } from "../tool-call";

describe("tool-call SDK event readers", () => {
  it("reads a tool call from partial.content at contentIndex", () => {
    const event = {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        content: [
          { type: "text", text: "starting" },
          {
            type: "toolCall",
            id: "tc_partial",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
      },
    };

    expect(readToolCallId(event)).toBe("tc_partial");
    expect(readToolCallName(event)).toBe("read");
    expect(readToolCallInput(event)).toEqual({ path: "README.md" });
  });

  it("reads a completed tool call from the top-level toolCall field", () => {
    const event = {
      type: "toolcall_end",
      toolCall: {
        type: "toolCall",
        id: "tc_complete",
        name: "bash",
        arguments: { command: "pwd" },
      },
    };

    expect(readToolCallId(event)).toBe("tc_complete");
    expect(readToolCallName(event)).toBe("bash");
    expect(readToolCallInput(event)).toEqual({ command: "pwd" });
  });
});
