import type { PiImageContent } from "@shared";

const DATA_URL_RE = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i;

/** True when model.input includes "image". Missing input ⇒ text-only. */
export function modelSupportsVision(model?: { input?: string[] } | null): boolean {
  return Array.isArray(model?.input) && model.input.includes("image");
}

/** Convert a browser data URL into SDK/IPC PiImageContent (raw base64). */
export function dataUrlToImageContent(dataUrl: string, fallbackMime = "image/png"): PiImageContent | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = (match[1] || fallbackMime).toLowerCase();
  const data = match[2];
  if (!data) return null;
  if (!mimeType.startsWith("image/")) return null;
  return { type: "image", data, mimeType };
}

export function imageContentToDataUrl(image: PiImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** Heuristic: provider/model rejected images — safe to auto-fallback to describeImages. */
export function isVisionUnsupportedError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("does not support image")
    || text.includes("does not support images")
    || text.includes("image_url is only supported")
    || text.includes("vision is not supported")
    || text.includes("multimodal")
    || text.includes("invalid image")
    || text.includes("unsupported image")
    || text.includes("no image support")
  );
}
