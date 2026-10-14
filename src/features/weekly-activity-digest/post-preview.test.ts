import { afterEach, describe, expect, it, vi } from "vitest";
import { firstPostLine, postPreviewFromJson } from "./post-preview";

describe("digest post previews", () => {
  afterEach(() => vi.restoreAllMocks());

  it("extracts text across source lines and paragraphs while preserving inline formatting boundaries", () => {
    const value = JSON.stringify({ type: "doc", content: [
      { type: "paragraph" },
      { type: "paragraph", content: [
        { type: "text", text: "First " }, { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " line." }, { type: "hardBreak" }, { type: "text", text: "Second line." },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "Later paragraph." }] },
    ] });
    expect(postPreviewFromJson(value)).toBe("First bold line. Second line. Later paragraph.");
  });

  it("includes nested list text without media URLs", () => {
    expect(postPreviewFromJson(JSON.stringify({ type: "doc", content: [
      { type: "image", attrs: { src: "https://example.com/private.jpg" } },
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First item" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second item" }] }] },
      ] },
    ] }))).toBe("First item Second item");
  });

  it("handles missing and empty documents and logs malformed stored content", () => {
    expect(postPreviewFromJson(null)).toBeNull();
    expect(postPreviewFromJson("{}")).toBeNull();
    expect(postPreviewFromJson('{"type":"doc","content":[]}')).toBeNull();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(postPreviewFromJson("not JSON")).toBeNull();
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("normalizes only the first nonempty plain-text line", () => {
    expect(firstPostLine("\n  A   short line.\r\nDo not include this.")).toBe("A short line.");
  });
});
