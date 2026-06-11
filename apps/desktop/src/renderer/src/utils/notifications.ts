const PERMISSION_KEY = "pi-desktop-notification-permission";

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  const result = await Notification.requestPermission();
  localStorage.setItem(PERMISSION_KEY, result);
  return result;
}

export function canNotify(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export function sendNotification(title: string, body?: string, options?: NotificationOptions): void {
  if (!canNotify()) return;
  try {
    new Notification(title, { body, icon: "icon.png", ...options });
  } catch {
    // Silent fail in environments where Notification constructor is restricted
  }
}

export function notifyTaskComplete(taskName: string): void {
  sendNotification("任务完成", `${taskName} 已完成`);
}

export function notifyError(message: string): void {
  sendNotification("发生错误", message);
}

export function notifyMessageReceived(sessionTitle: string): void {
  sendNotification("新消息", `来自 ${sessionTitle} 的回复`);
}
