// The inside of one piece of text to translate: words, and the tags among them (bold, a link, a line break). The tags
// travel to the translator as XLIFF inline elements whose content is the literal tag, so they can be moved but not
// changed, and they are checked when the translation comes back.
//
// This is OpenStage Author's translation format (tools/xliff.py: to_items, items_to_xml, items_from_element, canon,
// _markup_problem), ported from Python, so a translator's tools see the same thing from both programs. The suite's
// translation layer (C6) is not yet in openstage-core; when it moves there, this file is what moves.

import type { XmlElement } from "../xml.ts";

export type Item =
  | { kind: "t"; text: string }
  | { kind: "open" | "close" | "ph"; literal: string; id: number; pair: number };

export const XLIFF_NS = "urn:oasis:names:tc:xliff:document:1.2";
export const LETTER = /\p{L}/u;
/** {{$score}} (a value) or {1} (a blank): kept exactly as they are. */
export const PLACEHOLDER = /\{\{[^{}]*\}\}|\{[^{}]*\}/g;

const CTYPES: Record<string, string> = { strong: "bold", b: "bold", em: "italic", i: "italic", u: "underlined", a: "link", br: "lb" };
const VOID = new Set(["br", "hr", "img", "wbr", "input", "source", "track", "area", "col", "embed", "meta", "link", "base", "param"]);

/** For a tag: whether it closes, its name in lower case, and whether it closes itself. Null for text and comments. */
export function tagInfo(tok: string): { closing: boolean; name: string; selfClosing: boolean } | null {
  if (tok.startsWith("<!--")) return null;
  const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(tok);
  if (!m) return null;
  return { closing: m[1] === "/", name: m[2]!.toLowerCase(), selfClosing: tok.endsWith("/>") };
}

export function isMarkup(tok: string): boolean {
  return tok.startsWith("<!--") || tagInfo(tok) !== null;
}

/** The inline items of a run of tokens (text with HTML entities already decoded by `decode`). */
export function toItems(tokens: string[], decode: (s: string) => string): Item[] {
  const items: Item[] = [];
  const stack: { name: string; pos: number; pair: number }[] = [];
  let n = 0;
  let pair = 0;
  const ph = (pos: number) => {
    const it = items[pos]!;
    if (it.kind !== "t") items[pos] = { kind: "ph", literal: it.literal, id: it.id, pair: 0 };
  };
  for (const tok of tokens) {
    if (tok.startsWith("<!--")) {
      items.push({ kind: "ph", literal: tok, id: ++n, pair: 0 });
      continue;
    }
    const info = tagInfo(tok);
    if (!info) {
      const text = decode(tok);
      const last = items[items.length - 1];
      if (last?.kind === "t") last.text += text;
      else items.push({ kind: "t", text });
      continue;
    }
    n++;
    if (VOID.has(info.name) || info.selfClosing) items.push({ kind: "ph", literal: tok, id: n, pair: 0 });
    else if (!info.closing) {
      pair++;
      stack.push({ name: info.name, pos: items.length, pair });
      items.push({ kind: "open", literal: tok, id: n, pair });
    } else {
      let k = stack.length - 1;
      while (k >= 0 && stack[k]!.name !== info.name) k--;
      if (k < 0) {
        items.push({ kind: "ph", literal: tok, id: n, pair: 0 });
        continue;
      }
      for (const s of stack.slice(k + 1)) ph(s.pos);
      const pr = stack[k]!.pair;
      stack.length = k;
      items.push({ kind: "close", literal: tok, id: n, pair: pr });
    }
  }
  for (const s of stack) ph(s.pos);
  return items;
}

function ctype(literal: string): string {
  if (literal.startsWith("<!--")) return "x-html-comment";
  const name = tagInfo(literal)?.name ?? "tag";
  return CTYPES[name] ?? `x-html-${name}`;
}

/** Text for the inside of an XML element, with characters XML does not allow left out. */
export function xtext(s: string): string {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Text for an XML attribute. */
export function xattr(s: string): string {
  return xtext(s).replace(/"/g, "&quot;");
}

export function itemsToXml(items: Item[]): string {
  return items
    .map((it) => {
      if (it.kind === "t") return xtext(it.text);
      if (it.kind === "open") return `<bpt id="${it.id}" rid="${it.pair}" ctype="${ctype(it.literal)}">${xtext(it.literal)}</bpt>`;
      if (it.kind === "close") return `<ept id="${it.id}" rid="${it.pair}">${xtext(it.literal)}</ept>`;
      return `<ph id="${it.id}" ctype="${ctype(it.literal)}">${xtext(it.literal)}</ph>`;
    })
    .join("");
}

/** The words only, with spaces tidied: what a person reads. */
export function plainText(items: Item[]): string {
  return items
    .filter((i): i is { kind: "t"; text: string } => i.kind === "t")
    .map((i) => i.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export class TranslationError extends Error {}

function allText(el: XmlElement): string {
  return el.nodes.map((n) => (typeof n === "string" ? n : allText(n))).join("");
}

/** The items inside a <source> or <target>. Tags are read from the content of ph, bpt, ept and it. */
export function itemsFromElement(el: XmlElement): Item[] {
  const items: Item[] = [];
  const add = (s: string) => {
    if (!s) return;
    const last = items[items.length - 1];
    if (last?.kind === "t") last.text += s;
    else items.push({ kind: "t", text: s });
  };
  const walk = (e: XmlElement) => {
    for (const node of e.nodes) {
      if (typeof node === "string") {
        add(node);
        continue;
      }
      if (["ph", "bpt", "ept", "it"].includes(node.local)) {
        const get = (n: string) => Number(node.attrs.find((a) => a.local === n)?.value ?? 0) || 0;
        const kind = node.local === "bpt" ? "open" : node.local === "ept" ? "close" : "ph";
        items.push({ kind, literal: allText(node), id: get("id"), pair: get("rid") });
      } else if (node.local === "mrk" || node.local === "g") walk(node);
      else throw new TranslationError(`it holds an inline element <${node.local}> that Package Doctor cannot put back`);
    }
  };
  walk(el);
  return items;
}

/** What must match between the source in the package and the source in a file: text and tags, not their numbering. */
export function canon(items: Item[]): string {
  return JSON.stringify(
    items.reduce<[string, string][]>((out, it) => {
      const last = out[out.length - 1];
      if (it.kind === "t") {
        if (last?.[0] === "t") last[1] += it.text;
        else out.push(["t", it.text]);
      } else out.push(["x", it.literal]);
      return out;
    }, []),
  );
}

function counts(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function difference(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, n] of a) for (let i = (b.get(k) ?? 0); i < n; i++) out.push(k);
  return out;
}

/** Why a translated unit cannot be put back, or null when it can: its tags and placeholders must be the source's. */
export function markupProblem(source: Item[], target: Item[]): string | null {
  const tags = (items: Item[]) => counts(items.flatMap((i) => (i.kind === "t" ? [] : [i.literal])));
  const src = tags(source);
  const tgt = tags(target);
  const missing = difference(src, tgt);
  const extra = difference(tgt, src);
  if (missing.length || extra.length) {
    const bits = [missing.length ? `lost ${missing.slice(0, 3).join(", ")}` : "", extra.length ? `added ${extra.slice(0, 3).join(", ")}` : ""].filter(Boolean);
    return `the tags were changed (${bits.join("; ")})`;
  }
  const stack: string[] = [];
  for (const it of target) {
    if (it.kind === "open") stack.push(tagInfo(it.literal)?.name ?? "?");
    else if (it.kind === "close" && stack.pop() !== (tagInfo(it.literal)?.name ?? "?")) return "the tags are out of order or cross each other";
  }
  if (stack.length) return "a tag is not closed";
  const holders = (items: Item[]) => counts(items.flatMap((i) => (i.kind === "t" ? (i.text.match(PLACEHOLDER) ?? []) : [])));
  const lost = difference(holders(source), holders(target));
  const added = difference(holders(target), holders(source));
  if (lost.length || added.length) return `a placeholder was changed or lost${lost.length ? ` (${lost.slice(0, 3).join(", ")})` : ""}`;
  return null;
}

/** Whether a run of items has any words to translate. */
export function hasWords(items: Item[]): boolean {
  return items.some((i) => i.kind === "t" && LETTER.test(i.text));
}
