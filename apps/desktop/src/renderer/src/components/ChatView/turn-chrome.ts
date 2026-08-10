import type { Message } from "@shared";

/**
 * Mark which assistant messages own turn chrome (timestamp + copy).
 *
 * A user turn is everything after a user message until the next user message.
 * Only the last assistant fragment in that slice gets chrome — matching Cindy's
 * turnFinalAssistant / showActionBar contract, without rewriting history rows.
 */
export function computeTurnChromeIds(
  messages: Array<Pick<Message, "id" | "role">>,
  opts?: {
    isStreaming?: boolean;
    streamingMessageId?: string | null;
  },
): Set<string> {
  const chromeIds = new Set<string>();
  let lastAssistantInTurn: string | null = null;

  const flushTurn = (): void => {
    if (lastAssistantInTurn) {
      chromeIds.add(lastAssistantInTurn);
      lastAssistantInTurn = null;
    }
  };

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn();
      continue;
    }
    if (message.role === "assistant") {
      lastAssistantInTurn = message.id;
    }
  }
  flushTurn();

  // While streaming, the live bubble is the turn chrome owner (no copy yet —
  // MessageBubble hides chrome when isStreaming). Prefer it over a sealed
  // intermediate fragment that may still be last in the list until the next
  // frame merges/overlays content.
  if (opts?.isStreaming && opts.streamingMessageId) {
    chromeIds.add(opts.streamingMessageId);
  }

  return chromeIds;
}
