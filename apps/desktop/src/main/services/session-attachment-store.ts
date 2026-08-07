import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { MessageAttachment, PiImageContent } from "@shared";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export interface SaveImageInput {
  name: string;
  mimeType: string;
  /** raw base64 (no data: prefix) */
  data: string;
  size?: number;
}

export class SessionAttachmentStore {
  constructor(private readonly rootDir: string) {}

  sessionDir(sessionId: string): string {
    return join(this.rootDir, sanitizeId(sessionId));
  }

  async saveImages(sessionId: string, images: readonly SaveImageInput[]): Promise<MessageAttachment[]> {
    if (images.length === 0) return [];
    const dir = this.sessionDir(sessionId);
    await mkdir(dir, { recursive: true });
    const saved: MessageAttachment[] = [];
    for (const image of images) {
      const mimeType = normalizeMime(image.mimeType);
      if (!ALLOWED_MIME.has(mimeType)) {
        throw new Error(`unsupported image mimeType: ${image.mimeType}`);
      }
      const buffer = Buffer.from(image.data, "base64");
      if (buffer.byteLength === 0) {
        throw new Error(`empty image payload: ${image.name}`);
      }
      if (buffer.byteLength > 5 * 1024 * 1024) {
        throw new Error(`image too large (>5MB): ${image.name}`);
      }
      const id = createAttachmentId(image.name, buffer);
      const ext = extensionForMime(mimeType);
      const storageKey = `${id}${ext}`;
      const absolute = this.resolveSafePath(sessionId, storageKey);
      await writeFile(absolute, buffer);
      saved.push({
        id,
        kind: "image",
        name: image.name || `${id}${ext}`,
        mimeType,
        size: image.size ?? buffer.byteLength,
        storageKey,
      });
    }
    return saved;
  }

  async saveFromImageContent(sessionId: string, images: readonly PiImageContent[], names?: string[]): Promise<MessageAttachment[]> {
    return this.saveImages(
      sessionId,
      images.map((image, index) => ({
        name: names?.[index] ?? `image-${index + 1}${extensionForMime(image.mimeType)}`,
        mimeType: image.mimeType,
        data: image.data,
      })),
    );
  }

  async readImage(sessionId: string, storageKey: string): Promise<{ mimeType: string; data: string; byteLength: number }> {
    const absolute = this.resolveSafePath(sessionId, storageKey);
    const buffer = await readFile(absolute);
    const mimeType = mimeFromExtension(extname(storageKey));
    return {
      mimeType,
      data: buffer.toString("base64"),
      byteLength: buffer.byteLength,
    };
  }

  async readAsDataUrl(sessionId: string, storageKey: string): Promise<string> {
    const image = await this.readImage(sessionId, storageKey);
    return `data:${image.mimeType};base64,${image.data}`;
  }

  async deleteSessionAttachments(sessionId: string): Promise<void> {
    await rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  /** Resolve path under session dir; rejects path traversal. */
  resolveSafePath(sessionId: string, storageKey: string): string {
    const key = storageKey.replace(/\\/g, "/");
    if (!key || key.includes("..") || key.startsWith("/") || key.includes("\0")) {
      throw new Error("invalid attachment storageKey");
    }
    const root = resolve(this.sessionDir(sessionId));
    const absolute = resolve(root, key);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new Error("attachment path escapes session directory");
    }
    return absolute;
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function createAttachmentId(name: string, buffer: Buffer): string {
  const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const rand = randomBytes(3).toString("hex");
  const base = sanitizeId(name.replace(/\.[^.]+$/, "")).slice(0, 24) || "img";
  return `${base}-${hash}-${rand}`;
}

function normalizeMime(mimeType: string): string {
  const lower = mimeType.toLowerCase().trim();
  if (lower === "image/jpg") return "image/jpeg";
  return lower;
}

function extensionForMime(mimeType: string): string {
  switch (normalizeMime(mimeType)) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

function mimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export function ensureSessionAttachmentRoot(userDataPath: string): string {
  const root = join(userDataPath, "session-attachments");
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    // best-effort
  }
  return root;
}
