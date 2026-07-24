// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneratedUiForm } from "./GeneratedUiForm";

const section = {
  id: "form1",
  kind: "form" as const,
  submitLabel: "提交表单",
  submitPrompt: "Use the form values.",
  fields: [
    {
      id: "name",
      label: "名称",
      kind: "text" as const,
      required: true,
      placeholder: "输入名称",
    },
    {
      id: "count",
      label: "数量",
      kind: "number" as const,
      min: 1,
      max: 10,
      defaultValue: 2,
    },
  ],
};

describe("GeneratedUiForm", () => {
  it("blocks submit when required field empty", async () => {
    const onSend = vi.fn();
    render(
      <GeneratedUiForm cardId="card1" cardTitle="Demo" section={section} onSend={onSend} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(await screen.findByText("此项为必填")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("submits transport + visible payloads when valid", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <GeneratedUiForm cardId="card1" cardTitle="Demo" section={section} onSend={onSend} />,
    );
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const payload = onSend.mock.calls[0]?.[0] as {
      transportContent: string;
      visibleContent: string;
    };
    expect(payload.transportContent).toContain('card_id="card1"');
    expect(payload.transportContent).toContain('"name":"alpha"');
    expect(payload.visibleContent).toContain("alpha");
  });

  it("exposes submit focus-visible ring for keyboard a11y", () => {
    render(
      <GeneratedUiForm cardId="card1" cardTitle="Demo" section={section} onSend={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /提交/ }).className).toContain("focus-visible:ring-2");
  });
});
