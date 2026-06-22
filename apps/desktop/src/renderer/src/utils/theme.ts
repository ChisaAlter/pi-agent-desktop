export type Theme = "light" | "dark" | "system";

const DEFAULT_FONT_SIZE = 14;
const MIN_RENDER_FONT_SIZE = 12;
const MAX_RENDER_FONT_SIZE = 20;

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
}

export function normalizeFontSize(fontSize: unknown): number {
  const parsed = typeof fontSize === "number" ? fontSize : Number.parseInt(String(fontSize), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_RENDER_FONT_SIZE, Math.max(MIN_RENDER_FONT_SIZE, Math.round(parsed)));
}

export function getEditorFontSize(fontSize: unknown): number {
  return Math.max(11, normalizeFontSize(fontSize) - 1);
}

export function getDiffFontSize(fontSize: unknown): number {
  return Math.max(10, normalizeFontSize(fontSize) - 3);
}

export function applyFontSize(fontSize: unknown): number {
  const normalized = normalizeFontSize(fontSize);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--font-size-body", `${normalized}px`);
  rootStyle.setProperty("--font-size-xs", `${Math.max(10, normalized - 3)}px`);
  rootStyle.setProperty("--font-size-sm", `${Math.max(11, normalized - 2)}px`);
  rootStyle.setProperty("--font-size-base", `${Math.max(12, normalized - 1)}px`);
  rootStyle.setProperty("--font-size-md", `${normalized}px`);
  rootStyle.setProperty("--font-size-lg", `${normalized + 2}px`);
  rootStyle.setProperty("--font-size-xl", `${normalized + 6}px`);
  rootStyle.setProperty("--font-size-2xl", `${normalized + 10}px`);
  rootStyle.setProperty("--font-size-mono", `${getEditorFontSize(normalized)}px`);
  rootStyle.setProperty("--font-size-mono-small", `${getDiffFontSize(normalized)}px`);
  rootStyle.setProperty("--line-height-mono", `${Math.round(getEditorFontSize(normalized) * 1.55)}px`);
  return normalized;
}

export function getInitialFontSize(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
  try {
    return normalizeFontSize(localStorage.getItem("pi-desktop-font-size"));
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("pi-desktop-theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export function watchSystemTheme(callback: (theme: "light" | "dark") => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent) => callback(e.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
