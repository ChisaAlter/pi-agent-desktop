// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { ThinkingBlock, formatDuration, ThinkingText } from "./ThinkingBlock";

type RenderResult = ReturnType<typeof render>;

function renderWithI18n(ui: React.ReactElement): RenderResult {
    const result = render(<I18nProvider>{ui}</I18nProvider>);
    return {
        ...result,
        rerender: (next: React.ReactNode) =>
            result.rerender(<I18nProvider>{next}</I18nProvider>),
    };
}

describe("ThinkingBlock", () => {
  beforeEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("thinking:")) localStorage.removeItem(key);
    }
  });

  it("renders nothing when content empty", () => {
    const { container } = renderWithI18n(<ThinkingBlock content="" />);
    expect(container.textContent).toBe("");
  });

  it("default collapsed, toggles expansion with aria-expanded and label", () => {
    renderWithI18n(<ThinkingBlock content="step one" count={2} />);
    const btn = screen.getByRole("button", { name: /思考 2 次/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/思考 2 次/)).toBeTruthy();
    // 默认折叠: 内容不可见(DOM 卸载)
    expect(screen.queryByText("step one")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("step one")).toBeTruthy();
    expect(screen.getByRole("button", { name: /收起思考/ })).toBeTruthy();
  });

  it("streaming state: 默认折叠 + 计时标签(不展开)", () => {
    renderWithI18n(<ThinkingBlock content="partial..." isStreaming />);
    expect(screen.getByText(/思考中/)).toBeTruthy();
    // 默认折叠: 流式中内容不可见(长思考不刷屏)
    expect(screen.queryByText("partial...")).toBeNull();
  });

  it("persistKey: 展开状态写入 localStorage, 重渲染恢复", () => {
    const { rerender } = renderWithI18n(<ThinkingBlock content="persisted thinking" persistKey="ts-1" />);
    const btn = screen.getByRole("button", { name: /思考 1 次/ });
    fireEvent.click(btn);
    expect(localStorage.getItem("thinking:ts-1")).toBe("true");

    // 重渲染(同一 persistKey): 恢复展开
    rerender(<ThinkingBlock content="persisted thinking" persistKey="ts-1" />);
    expect(screen.getByRole("button", { name: /收起思考/ })).toBeTruthy();
    expect(screen.getByText("persisted thinking")).toBeTruthy();
  });

  it("无 persistKey 不写 thinking key", () => {
    renderWithI18n(<ThinkingBlock content="x" />);
    fireEvent.click(screen.getByRole("button"));
    const thinkingKeys = Object.keys(localStorage).filter((k) => k.startsWith("thinking:"));
    expect(thinkingKeys).toHaveLength(0);
  });

  it("exposes thinking toggle focus-visible ring for keyboard a11y", () => {
    renderWithI18n(<ThinkingBlock content="step one" />);
    expect(screen.getByRole("button", { name: /思考 1 次/ }).className).toContain(
      "focus-visible:ring-2",
    );
  });
});

describe("formatDuration", () => {
  it("short → Xs", () => {
    expect(formatDuration(500)).toBe("1s");
    expect(formatDuration(12_000)).toBe("12s");
  });
  it("long → Xm Ys", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(120_000)).toBe("2m");
  });
});

describe("ThinkingText 轻量行内强调", () => {
  it("渲染 **粗体** / *斜体* / `code`", () => {
    const { container } = renderWithI18n(
      <ThinkingText content={"有 **粗体** 和 *斜体* 与 `code` 混合"} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("粗体");
    expect(container.querySelector("em")?.textContent).toBe("斜体");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("普通文本原样保留", () => {
    const { container } = renderWithI18n(<ThinkingText content={"纯文本 a-b_c"} />);
    expect(container.textContent).toBe("纯文本 a-b_c");
  });

  it("未闭合强调符不崩、不丢文本(流式中思考)", () => {
    const { container } = renderWithI18n(<ThinkingText content={"思考中 **半截强调"} />);
    expect(container.textContent).toBe("思考中 **半截强调");
  });

  it("`code` 内容里的星号不参与强调配对", () => {
    const { container } = renderWithI18n(<ThinkingText content={"`a * b` 后面 *斜体*"} />);
    expect(container.querySelector("code")?.textContent).toBe("a * b");
    expect(container.querySelector("em")?.textContent).toBe("斜体");
  });
});
