// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GeneratedUiCardV2 } from "@shared";
import { GeneratedUiCard } from "./GeneratedUiCard";
import { I18nProvider } from "../../i18n";

function cardWith(sections: GeneratedUiCardV2["sections"]): GeneratedUiCardV2 {
  return { version: "v2", id: "card-v2", title: "综合卡片", sections };
}

describe("GeneratedUiCard v2", () => {
  it("sorts table rows", () => {
    render(<I18nProvider><GeneratedUiCard card={cardWith([{
      id: "table",
      kind: "table",
      columns: [{ key: "name", label: "名称", sortable: true }],
      rows: [{ name: "B" }, { name: "A" }],
    }])} /></I18nProvider>);

    fireEvent.click(screen.getByRole("button", { name: /名称/ }));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("A")).toBeTruthy();
  });

  it("validates and sends structured form responses with readable visible content", async () => {
    const onSend = vi.fn(async () => undefined);
    render(<I18nProvider><GeneratedUiCard card={cardWith([{
      id: "form",
      kind: "form",
      submitLabel: "提交配置",
      submitPrompt: "继续部署",
      fields: [
        { id: "target", kind: "select", label: "环境", required: true, options: [{ label: "测试", value: "staging" }] },
        { id: "confirm", kind: "checkbox", label: "确认", required: true },
      ],
    }])} onSend={onSend} /></I18nProvider>);

    expect(screen.getAllByText("确认")).toHaveLength(1);
    expect(screen.getByLabelText(/环境/).className).toContain("border-[var(--mm-border-strong)]");
    expect(screen.getByRole("button", { name: "提交配置" }).closest("[data-generated-ui-form-actions]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "提交配置" }));
    expect(screen.getAllByText("此项为必填")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText(/环境/), { target: { value: "staging" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "提交配置" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      transportContent: expect.stringContaining('<generated_ui_response card_id="card-v2" form_id="form">'),
      visibleContent: expect.stringContaining("环境: staging"),
    }));
  });

  it("uses a stronger card frame and clearly separated action controls", () => {
    render(<I18nProvider><GeneratedUiCard card={cardWith([{
      id: "actions",
      kind: "action_bar",
      actions: [{ id: "copy", label: "复制摘要", kind: "copy-text", value: "summary" }],
    }])} /></I18nProvider>);

    const card = screen.getByRole("region", { name: "综合卡片" });
    const action = screen.getByRole("button", { name: "复制摘要" });
    expect(card.className).toContain("border-[var(--mm-border-strong)]");
    expect(card.className).toContain("bg-[var(--mm-bg-input)]");
    expect(action.className).toContain("h-9");
    expect(action.closest("[data-generated-ui-actions]")?.className ?? "").toContain("py-4");
  });

  it("sends safe action messages through the current conversation", async () => {
    const onSend = vi.fn(async () => undefined);
    render(<I18nProvider><GeneratedUiCard card={cardWith([{
      id: "actions",
      kind: "action_bar",
      actions: [{ id: "continue", label: "继续", kind: "send-message", value: "继续执行下一步" }],
    }])} onSend={onSend} /></I18nProvider>);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      transportContent: expect.stringContaining("继续执行下一步"),
      visibleContent: "已选择「继续」",
    })));
  });

  it("does not display a product title when the generated card has no title", () => {
    render(<I18nProvider><GeneratedUiCard card={{
      version: "v2",
      id: "untitled-card",
      sections: [{ id: "summary", kind: "markdown", content: "项目状态正常" }],
    }} /></I18nProvider>);

    expect(screen.getByText("项目状态正常")).toBeTruthy();
    expect(screen.queryByText("Pi 生成式界面")).toBeNull();
    expect(screen.getByRole("region", { name: "生成内容" })).toBeTruthy();
  });
  it("exposes generated-ui action focus-visible rings for keyboard a11y", () => {
    render(<I18nProvider><GeneratedUiCard card={cardWith([{
      id: "actions",
      kind: "action_bar",
      actions: [{ id: "copy", label: "复制摘要", kind: "copy-text", value: "summary" }],
    }])} /></I18nProvider>);

    expect(screen.getByRole("button", { name: "复制摘要" }).className).toContain("focus-visible:ring-2");
  });
});
