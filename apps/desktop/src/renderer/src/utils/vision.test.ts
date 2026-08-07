import { describe, expect, it } from "vitest";
import {
  dataUrlToImageContent,
  imageContentToDataUrl,
  isVisionUnsupportedError,
  modelSupportsVision,
} from "./vision";

describe("vision helpers", () => {
  it("detects vision capability from model.input", () => {
    expect(modelSupportsVision(undefined)).toBe(false);
    expect(modelSupportsVision({ input: ["text"] })).toBe(false);
    expect(modelSupportsVision({ input: ["text", "image"] })).toBe(true);
  });

  it("parses data URLs into raw base64 image content", () => {
    const image = dataUrlToImageContent("data:image/png;base64,abc123");
    expect(image).toEqual({ type: "image", data: "abc123", mimeType: "image/png" });
    expect(imageContentToDataUrl(image!)).toBe("data:image/png;base64,abc123");
  });

  it("rejects non-image data URLs", () => {
    expect(dataUrlToImageContent("not-a-data-url")).toBeNull();
    expect(dataUrlToImageContent("data:text/plain;base64,abc")).toBeNull();
  });

  it("classifies vision-unsupported provider errors", () => {
    expect(isVisionUnsupportedError("HTTP 400 - model does not support images")).toBe(true);
    expect(isVisionUnsupportedError("network down")).toBe(false);
  });
});
