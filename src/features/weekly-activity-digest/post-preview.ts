import type { JSONContent } from "@tiptap/core";
import { parseSerializedTipTapDocument } from "@/components/db/types/poem-term-validation";

function nodeText(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  const text = (node.content ?? []).map(nodeText).join("");
  return ["paragraph", "heading", "listItem", "blockquote", "tableRow"].includes(node.type ?? "")
    ? `${text}\n`
    : text;
}

export function firstPostLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).find(Boolean) ?? null;
}

export function postPreviewFromJson(value: string | null | undefined): string | null {
  if (!value?.trim() || value.trim() === "{}") return null;
  const parsed = parseSerializedTipTapDocument(value);
  if (!parsed.success) {
    console.warn("[weekly-activity-digest.post-preview] Invalid stored TipTap document");
    return null;
  }
  return nodeText(parsed.content).replace(/\s+/g, " ").trim() || null;
}
