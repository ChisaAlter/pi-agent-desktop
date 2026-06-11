import type { Session } from "../stores/session-store";
import type { Message } from "@shared";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: Date): string {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageToMarkdown(message: Message): string {
  const role = message.role === "user" ? "**你**" : "**AI**";
  const time = message.timestamp instanceof Date
    ? formatDate(message.timestamp)
    : formatDate(new Date(message.timestamp));

  let content = message.content;

  if (message.toolCalls && message.toolCalls.length > 0) {
    const toolSummary = message.toolCalls
      .map((tc) => `- \`${tc.name}\`: ${tc.status}`)
      .join("\n");
    content += `\n\n<details><summary>工具调用</summary>\n\n${toolSummary}\n\n</details>`;
  }

  return `### ${role} (${time})\n\n${content}`;
}

export function exportSessionAsMarkdown(session: Session): string {
  const lines: string[] = [];

  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push(`**创建时间**: ${formatDate(session.createdAt)}`);
  lines.push(`**更新时间**: ${formatDate(session.updatedAt)}`);
  lines.push(`**消息数量**: ${session.messages.length}`);
  lines.push("");

  if (session.usage) {
    lines.push("## 使用统计");
    lines.push("");
    lines.push(`- 输入 Token: ${session.usage.inputTokens ?? 0}`);
    lines.push(`- 输出 Token: ${session.usage.outputTokens ?? 0}`);
    lines.push(`- 总 Token: ${session.usage.totalTokens ?? 0}`);
    if (session.usage.estimatedCostUsd) {
      lines.push(`- 预估费用: $${session.usage.estimatedCostUsd.toFixed(2)}`);
    }
    lines.push("");
  }

  lines.push("## 对话内容");
  lines.push("");

  for (const message of session.messages) {
    lines.push(messageToMarkdown(message));
    lines.push("");
  }

  return lines.join("\n");
}

export function exportSessionAsJSON(session: Session): string {
  return JSON.stringify(
    {
      id: session.id,
      title: session.title,
      workspaceId: session.workspaceId,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: session.messages.map((m) => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
      })),
      usage: session.usage,
      tags: session.tags,
      summary: session.summary,
    },
    null,
    2,
  );
}

export function exportSessionAsHTML(session: Session): string {
  const messages = session.messages
    .map((m) => {
      const role = m.role === "user" ? "用户" : "AI";
      const time = m.timestamp instanceof Date
        ? formatDate(m.timestamp)
        : formatDate(new Date(m.timestamp));
      const content = m.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

      return `
        <div class="message ${m.role}">
          <div class="header">
            <span class="role">${role}</span>
            <span class="time">${time}</span>
          </div>
          <div class="content">${content}</div>
        </div>
      `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(session.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #1a1a1a; border-bottom: 1px solid #e5e5e5; padding-bottom: 10px; }
    .message { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; border: 1px solid #e5e5e5; }
    .message.user { border-left: 3px solid #3b82f6; }
    .message.assistant { border-left: 3px solid #10b981; }
    .header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #666; }
    .role { font-weight: 600; }
    .content { font-size: 14px; line-height: 1.6; }
    .meta { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(session.title)}</h1>
  ${messages}
  <div class="meta">
    <p>导出时间: ${formatDate(new Date())} · 共 ${session.messages.length} 条消息</p>
  </div>
</body>
</html>`;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
