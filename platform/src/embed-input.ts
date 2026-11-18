// What one block is embedded from for semantic search (SEC-17; SEC-31 brief
// section 7.4). Pure, so it is tested without a database or Voyage.
//
// In order: the block's kind and AI description (or, until the tagger has written
// one, its headline and copy); the heading and button text of its measured
// outline ("hero with two buttons"); the store's design summary ("serif
// headings, pill buttons"). Outline and summary exist only for captures made
// with --styles; they keep their room and the description or copy gets the
// rest, so without them the input is exactly what it was before.

import type { OutlineNode } from "../../web/src/contracts/manifest.js";

export const MAX_INPUT_CHARS = 2000;
const OUTLINE_CHARS = 300;
const SUMMARY_CHARS = 450;

export type EmbeddingSource = {
  ai_description: string | null;
  block_type: string | null;
  type_hint: string;
  headline: string | null;
  text: string;
  outline?: OutlineNode[] | null;
  design_summary?: string | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The outline's headings and buttons, top to bottom: `heading "Meet the box"; 2 buttons "Shop now", "Gift it"`. */
export function outlineText(outline: OutlineNode[] | null | undefined): string {
  if (!outline?.length) return "";
  const headings: string[] = [], buttons: string[] = [];
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      const text = n.text ? squash(n.text) : "";
      if (n.type === "heading" && text) headings.push(`"${text}"`);
      if (n.type === "button") for (let i = 0; i < Math.max(1, n.count ?? 1); i++) buttons.push(text ? `"${text}"` : "");
      if (n.children) walk(n.children);
    }
  };
  walk(outline);
  const labelled = [...new Set(buttons.filter(Boolean))];
  const parts = [
    headings.length ? `${headings.length === 1 ? "heading" : `${headings.length} headings`} ${headings.join(", ")}` : "",
    buttons.length ? `${buttons.length === 1 ? "button" : `${buttons.length} buttons`}${labelled.length ? ` ${labelled.join(", ")}` : ""}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

export function embeddingInput(b: EmbeddingSource): string {
  const kind = (b.block_type ?? b.type_hint).replace(/-/g, " ");
  const body = b.ai_description?.trim()
    ? b.ai_description.trim()
    : [b.headline?.trim(), squash(b.text)].filter(Boolean).join(". ");
  const contents = outlineText(b.outline).slice(0, OUTLINE_CHARS);
  const design = b.design_summary ? squash(b.design_summary).slice(0, SUMMARY_CHARS) : "";
  const tail = [contents ? `Contains ${contents}.` : "", design ? `Store design: ${design}` : ""].filter(Boolean).join(" ");
  const head = `${kind} block. ${body}`.slice(0, tail ? MAX_INPUT_CHARS - tail.length - 1 : MAX_INPUT_CHARS);
  return tail ? `${head} ${tail}` : head;
}
