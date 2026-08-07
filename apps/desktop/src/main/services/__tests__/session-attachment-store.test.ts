import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionAttachmentStore } from "../session-attachment-store";

describe("SessionAttachmentStore", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("saves and reads images under the session directory", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-attach-"));
    const store = new SessionAttachmentStore(root);
    const data = Buffer.from("hello-image").toString("base64");
    const [attachment] = await store.saveImages("s1", [
      { name: "pasted.png", mimeType: "image/png", data },
    ]);
    expect(attachment.kind).toBe("image");
    expect(attachment.storageKey.endsWith(".png")).toBe(true);

    const absolute = store.resolveSafePath("s1", attachment.storageKey);
    const onDisk = await readFile(absolute);
    expect(onDisk.toString("utf8")).toBe("hello-image");

    const read = await store.readImage("s1", attachment.storageKey);
    expect(read.mimeType).toBe("image/png");
    expect(read.data).toBe(data);
  });

  it("rejects path traversal storage keys", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-attach-"));
    const store = new SessionAttachmentStore(root);
    expect(() => store.resolveSafePath("s1", "../escape.png")).toThrow(/invalid|escapes/i);
  });

  it("deletes the whole session attachment directory", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-attach-"));
    const store = new SessionAttachmentStore(root);
    await store.saveImages("s1", [
      { name: "a.png", mimeType: "image/png", data: Buffer.from("a").toString("base64") },
    ]);
    await store.deleteSessionAttachments("s1");
    await expect(store.readImage("s1", "missing.png")).rejects.toThrow();
  });
});
