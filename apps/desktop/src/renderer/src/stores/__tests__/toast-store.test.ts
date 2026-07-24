import { beforeEach, describe, expect, it } from "vitest";
import { addToast, useToastStore } from "../toast-store";

describe("toast-store", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("addToast helper defaults tone to error with 6000ms duration", () => {
    const id = addToast("boom");
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast).toMatchObject({
      message: "boom",
      tone: "error",
      duration: 6000,
    });
    expect(id).toMatch(/^toast_/);
  });

  it("non-error tones default to 3000ms duration", () => {
    const id = addToast("ok", "success");
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.duration).toBe(3000);
    expect(toast?.tone).toBe("success");
  });

  it("respects explicit duration override", () => {
    const id = useToastStore.getState().addToast({
      message: "custom",
      tone: "info",
      duration: 1200,
    });
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.duration).toBe(1200);
  });

  it("keeps at most 5 toasts (drops oldest)", () => {
    for (let i = 0; i < 7; i += 1) {
      addToast(`m${i}`, "info");
    }
    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toHaveLength(5);
    expect(messages[0]).toBe("m2");
    expect(messages[4]).toBe("m6");
  });

  it("removeToast and clearAll mutate list", () => {
    const a = addToast("a", "info");
    const b = addToast("b", "info");
    useToastStore.getState().removeToast(a);
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([b]);
    useToastStore.getState().clearAll();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("stores optional retryAction", () => {
    const retry = () => undefined;
    const id = addToast("retry me", "warning", retry);
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.retryAction).toBe(retry);
  });

  // wave-95 residual
  it("removeToast is a no-op for unknown ids", () => {
    const id = addToast("keep", "info");
    useToastStore.getState().removeToast("toast_missing");
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([id]);
  });

  it("warning tone defaults to non-error duration", () => {
    const id = addToast("warn", "warning");
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.duration).toBe(3000);
  });

  it("clearAll on empty store is safe", () => {
    expect(() => useToastStore.getState().clearAll()).not.toThrow();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  // wave-120 residual
  it("generates unique toast ids across multiple adds", () => {
    const ids = new Set(Array.from({ length: 5 }, () => addToast("x", "info")));
    expect(ids.size).toBe(5);
  });

  it("info and success tones both default to 3000ms", () => {
    const info = addToast("i", "info");
    const success = addToast("s", "success");
    const state = useToastStore.getState().toasts;
    expect(state.find((t) => t.id === info)?.duration).toBe(3000);
    expect(state.find((t) => t.id === success)?.duration).toBe(3000);
  });

  it("error tone keeps 6000ms even when retryAction is provided", () => {
    const id = addToast("err", "error", () => undefined);
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.duration).toBe(6000);
    expect(typeof toast?.retryAction).toBe("function");
  });

  it("append order is oldest-first until cap drops the front", () => {
    const a = addToast("a", "info");
    const b = addToast("b", "info");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0]?.id).toBe(a);
    expect(toasts[1]?.id).toBe(b);
  });

  // wave-127 residual
  it("keeps at most 5 toasts dropping oldest from the front", () => {
    const ids = Array.from({ length: 6 }, (_, i) => addToast(`m${i}`, "info"));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    expect(toasts.map((t) => t.id)).not.toContain(ids[0]);
    expect(toasts.map((t) => t.id)).toEqual(ids.slice(1));
  });

  it("warning tone defaults to 3000ms and clearAll empties the list", () => {
    const id = addToast("warn", "warning");
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.duration).toBe(3000);
    useToastStore.getState().clearAll();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("removeToast is a no-op for unknown ids", () => {
    const id = addToast("keep", "info");
    useToastStore.getState().removeToast("missing");
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([id]);
  });

  // wave-135 residual
  it("honors explicit duration override for all tones including error", () => {
    const id = useToastStore.getState().addToast({
      message: "custom",
      tone: "error",
      duration: 1500,
    });
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.duration).toBe(1500);
  });

  it("addToast default tone is error with 6000ms via convenience helper", () => {
    const id = addToast("default-tone");
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.tone).toBe("error");
    expect(toast?.duration).toBe(6000);
    expect(toast?.message).toBe("default-tone");
    expect(typeof toast?.id).toBe("string");
    expect(toast?.createdAt).toBeGreaterThan(0);
  });

  it("removeToast keeps remaining toasts order stable", () => {
    const a = addToast("a", "info");
    const b = addToast("b", "info");
    const c = addToast("c", "info");
    useToastStore.getState().removeToast(b);
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([a, c]);
  });

  // wave-144 residual
  it("allows duration 0 and empty message without dropping toast", () => {
    const id = useToastStore.getState().addToast({
      message: "",
      tone: "info",
      duration: 0,
    });
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast).toMatchObject({ message: "", duration: 0, tone: "info" });
    expect(toast?.createdAt).toBeGreaterThan(0);
  });

  it("store addToast without duration uses tone defaults", () => {
    const err = useToastStore.getState().addToast({ message: "e", tone: "error" });
    const info = useToastStore.getState().addToast({ message: "i", tone: "info" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.find((t) => t.id === err)?.duration).toBe(6000);
    expect(toasts.find((t) => t.id === info)?.duration).toBe(3000);
  });

  it("cap of 5 still holds when mixing tones and retryAction", () => {
    for (let i = 0; i < 8; i += 1) {
      addToast(`m${i}`, i % 2 === 0 ? "error" : "success", i === 0 ? () => undefined : undefined);
    }
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    expect(toasts.map((t) => t.message)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
  });

  // wave-234 residual
  it("removeToast unknown id is no-op; clearAll empties after cap", () => {
    const a = addToast("keep", "info");
    useToastStore.getState().removeToast("toast_does_not_exist");
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([a]);
    for (let i = 0; i < 10; i += 1) addToast(`x${i}`, "warning");
    expect(useToastStore.getState().toasts).toHaveLength(5);
    useToastStore.getState().clearAll();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("helper default tone is error (6000ms); explicit warning uses 3000", () => {
    const errId = addToast("default-tone");
    const warnId = addToast("w", "warning");
    const state = useToastStore.getState().toasts;
    expect(state.find((t) => t.id === errId)).toMatchObject({
      message: "default-tone",
      tone: "error",
      duration: 6000,
    });
    expect(state.find((t) => t.id === warnId)).toMatchObject({
      tone: "warning",
      duration: 3000,
    });
  });

  it("ids are unique across sequential adds and preserve retryAction reference", () => {
    const retry = () => undefined;
    const ids = [addToast("a", "info", retry), addToast("b", "info"), addToast("c", "info")];
    expect(new Set(ids).size).toBe(3);
    const first = useToastStore.getState().toasts.find((t) => t.id === ids[0]);
    expect(first?.retryAction).toBe(retry);
  });
});
