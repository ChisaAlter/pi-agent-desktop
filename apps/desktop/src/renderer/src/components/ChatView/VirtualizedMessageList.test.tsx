// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message as ChatMessage } from "@shared";
import { VirtualizedMessageList } from "./VirtualizedMessageList";

const scrollToIndex = vi.fn();
const measureElement = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 120,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * 120,
        size: 120,
        end: (index + 1) * 120,
      })),
    measureElement,
    scrollToIndex,
  }),
}));

vi.mock("./MessageBubble", () => ({
  MessageBubble: ({
    message,
    isStreaming,
    isSearchTarget,
  }: {
    message: ChatMessage;
    isStreaming?: boolean;
    isSearchTarget?: boolean;
  }) => (
    <div
      data-message-id={message.id}
      data-streaming={isStreaming ? "1" : "0"}
      data-search-target={isSearchTarget ? "1" : "0"}
    >
      bubble-{message.id}
    </div>
  ),
}));

function msg(id: string, content = id): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date(0),
  } as ChatMessage;
}

type RenderListProps = Omit<Parameters<typeof VirtualizedMessageList>[0], "scrollElementRef">;

function renderList(props: RenderListProps): void {
  // 真实布局里 scrollElementRef 指向 chat-scroll-region 滚动容器
  const scrollEl = document.createElement("div");
  render(<VirtualizedMessageList {...props} scrollElementRef={{ current: scrollEl }} />);
}

describe("VirtualizedMessageList", () => {
  it("renders bubbles for each message via virtualizer items", () => {
    renderList({
      messages: [msg("a"), msg("b"), msg("c")],
      isStreaming: false,
      streamingMessageId: null,
    });
    expect(screen.getByText("bubble-a")).toBeTruthy();
    expect(screen.getByText("bubble-b")).toBeTruthy();
    expect(screen.getByText("bubble-c")).toBeTruthy();
  });

  it("marks streaming and search target messages", () => {
    renderList({
      messages: [msg("a"), msg("b")],
      isStreaming: true,
      streamingMessageId: "b",
      focusMessageId: "a",
    });
    const a = screen.getByText("bubble-a").closest("[data-message-id]");
    const b = screen.getByText("bubble-b").closest("[data-message-id]");
    expect(a?.getAttribute("data-search-target")).toBe("1");
    expect(b?.getAttribute("data-streaming")).toBe("1");
    expect(scrollToIndex).toHaveBeenCalled();
  });

  it("renders empty list without rows", () => {
    const { container } = render(
      <VirtualizedMessageList
        messages={[]}
        isStreaming={false}
        streamingMessageId={null}
        scrollElementRef={{ current: document.createElement("div") }}
      />,
    );
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(0);
  });
});
