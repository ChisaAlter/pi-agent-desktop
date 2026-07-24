import { beforeEach, describe, expect, it } from "vitest";
import type { Attachment } from "../../types/attachments";
import { useAttachmentsStore } from "../attachments-store";

function att(id: string, name = id): Attachment {
  return { id, kind: "file", name, value: `C:/tmp/${name}` };
}

describe("attachments-store", () => {
  beforeEach(() => {
    useAttachmentsStore.setState({ byWorkspace: {} });
  });

  it("adds and lists attachments per workspace", () => {
    useAttachmentsStore.getState().add("ws-a", att("1", "a.ts"));
    useAttachmentsStore.getState().add("ws-b", att("2", "b.ts"));
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(1);
    expect(useAttachmentsStore.getState().list("ws-b")[0]?.name).toBe("b.ts");
    expect(useAttachmentsStore.getState().list("ws-missing")).toEqual([]);
  });

  it("removes by id without affecting other workspaces", () => {
    useAttachmentsStore.getState().add("ws-a", att("1"));
    useAttachmentsStore.getState().add("ws-a", att("2"));
    useAttachmentsStore.getState().add("ws-b", att("3"));
    useAttachmentsStore.getState().remove("ws-a", "1");
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(["2"]);
    expect(useAttachmentsStore.getState().list("ws-b")).toHaveLength(1);
  });

  it("clears a workspace entry entirely", () => {
    useAttachmentsStore.getState().add("ws-a", att("1"));
    useAttachmentsStore.getState().clear("ws-a");
    expect(useAttachmentsStore.getState().byWorkspace["ws-a"]).toBeUndefined();
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([]);
  });

  it("enforces max 20 attachments per workspace", () => {
    for (let i = 0; i < 25; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(String(i)));
    }
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
    expect(useAttachmentsStore.getState().list("ws-a")[0]?.id).toBe("0");
    expect(useAttachmentsStore.getState().list("ws-a")[19]?.id).toBe("19");
  });

  // wave-96 residual
  it("remove is a no-op for missing attachment ids", () => {
    useAttachmentsStore.getState().add("ws-a", att("1"));
    useAttachmentsStore.getState().remove("ws-a", "missing");
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(["1"]);
  });

  it("clear is a no-op for unknown workspace", () => {
    expect(() => useAttachmentsStore.getState().clear("ws-missing")).not.toThrow();
    expect(useAttachmentsStore.getState().byWorkspace).toEqual({});
  });

  it("allows adding again after clear when previously at cap", () => {
    for (let i = 0; i < 20; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(String(i)));
    }
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
    useAttachmentsStore.getState().clear("ws-a");
    useAttachmentsStore.getState().add("ws-a", att("fresh"));
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([att("fresh")]);
  });

  it("stores image-kind attachments without altering shape", () => {
    const image: Attachment = {
      id: "img1",
      kind: "image",
      name: "shot.png",
      value: "data:image/png;base64,abc",
    };
    useAttachmentsStore.getState().add("ws-a", image);
    expect(useAttachmentsStore.getState().list("ws-a")[0]).toEqual(image);
  });

  // wave-104 residual
  it("allows duplicate ids (list is append-only) and removes all matches by id", () => {
    useAttachmentsStore.getState().add("ws-a", att("dup", "a.ts"));
    useAttachmentsStore.getState().add("ws-a", att("dup", "b.ts"));
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(2);
    useAttachmentsStore.getState().remove("ws-a", "dup");
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([]);
  });

  it("drops adds beyond the cap without mutating existing entries", () => {
    for (let i = 0; i < 20; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(String(i)));
    }
    const before = useAttachmentsStore.getState().list("ws-a").map((a) => a.id);
    useAttachmentsStore.getState().add("ws-a", att("overflow"));
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(before);
  });

  it("list returns empty array for undefined workspace without creating a key", () => {
    expect(useAttachmentsStore.getState().list("ghost")).toEqual([]);
    expect(useAttachmentsStore.getState().byWorkspace.ghost).toBeUndefined();
  });

  // wave-121 residual
  it("isolates attachments across workspaces", () => {
    useAttachmentsStore.getState().add("ws-a", att("a1"));
    useAttachmentsStore.getState().add("ws-b", att("b1"));
    useAttachmentsStore.getState().clear("ws-a");
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([]);
    expect(useAttachmentsStore.getState().list("ws-b").map((a) => a.id)).toEqual(["b1"]);
    expect(useAttachmentsStore.getState().byWorkspace["ws-a"]).toBeUndefined();
  });

  it("remove only targets the given workspace", () => {
    useAttachmentsStore.getState().add("ws-a", att("shared"));
    useAttachmentsStore.getState().add("ws-b", att("shared"));
    useAttachmentsStore.getState().remove("ws-a", "shared");
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([]);
    expect(useAttachmentsStore.getState().list("ws-b").map((a) => a.id)).toEqual(["shared"]);
  });

  it("preserves append order within a workspace", () => {
    useAttachmentsStore.getState().add("ws-a", att("1", "a.ts"));
    useAttachmentsStore.getState().add("ws-a", att("2", "b.ts"));
    useAttachmentsStore.getState().add("ws-a", att("3", "c.ts"));
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(["1", "2", "3"]);
  });

  // wave-128 residual
  it("allows exactly 20 attachments then rejects the 21st without dropping existing", () => {
    for (let i = 0; i < 20; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(String(i)));
    }
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
    useAttachmentsStore.getState().add("ws-a", att("overflow"));
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).not.toContain("overflow");
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
  });

  it("clear/remove on missing workspace are no-ops", () => {
    expect(() => useAttachmentsStore.getState().clear("missing")).not.toThrow();
    expect(() => useAttachmentsStore.getState().remove("missing", "x")).not.toThrow();
    expect(useAttachmentsStore.getState().list("missing")).toEqual([]);
  });

  // wave-148 residual
  it("stores optional mimeType/size on image attachments", () => {
    const image: Attachment = {
      id: "img2",
      kind: "image",
      name: "x.png",
      value: "data:image/png;base64,xx",
      mimeType: "image/png",
      size: 128,
    };
    useAttachmentsStore.getState().add("ws-a", image);
    expect(useAttachmentsStore.getState().list("ws-a")[0]).toEqual(image);
  });

  it("caps each workspace independently at 20", () => {
    for (let i = 0; i < 22; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(`a${i}`));
      useAttachmentsStore.getState().add("ws-b", att(`b${i}`));
    }
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
    expect(useAttachmentsStore.getState().list("ws-b")).toHaveLength(20);
    expect(useAttachmentsStore.getState().list("ws-a")[19]?.id).toBe("a19");
    expect(useAttachmentsStore.getState().list("ws-b")[19]?.id).toBe("b19");
  });

  it("remove from empty workspace list is a no-op", () => {
    useAttachmentsStore.getState().add("ws-a", att("1"));
    useAttachmentsStore.getState().clear("ws-a");
    expect(() => useAttachmentsStore.getState().remove("ws-a", "1")).not.toThrow();
    expect(useAttachmentsStore.getState().list("ws-a")).toEqual([]);
  });

  // wave-235 residual
  it("add at cap is silent no-op; order of existing items preserved", () => {
    for (let i = 0; i < 20; i += 1) {
      useAttachmentsStore.getState().add("ws-a", att(`c${i}`));
    }
    const before = useAttachmentsStore.getState().list("ws-a").map((a) => a.id);
    useAttachmentsStore.getState().add("ws-a", att("overflow"));
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(before);
    expect(useAttachmentsStore.getState().list("ws-a")).toHaveLength(20);
  });

  it("clear only deletes the target workspace key; others remain", () => {
    useAttachmentsStore.getState().add("ws-a", att("a1"));
    useAttachmentsStore.getState().add("ws-b", att("b1"));
    useAttachmentsStore.getState().clear("ws-a");
    expect(useAttachmentsStore.getState().byWorkspace["ws-a"]).toBeUndefined();
    expect(useAttachmentsStore.getState().list("ws-b").map((a) => a.id)).toEqual(["b1"]);
  });

  it("remove unknown id leaves list unchanged", () => {
    useAttachmentsStore.getState().add("ws-a", att("keep"));
    useAttachmentsStore.getState().remove("ws-a", "missing-id");
    expect(useAttachmentsStore.getState().list("ws-a").map((a) => a.id)).toEqual(["keep"]);
  });
});
