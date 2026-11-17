// Finds the words a learner reads in a package made by any program, and puts translations back in their place.
//
// - Pages (HTML): each run of words between block tags (a paragraph, a heading, a list item, a button, a table cell)
//   is one unit; bold, links and line breaks inside it travel as tags. The words in attributes a person reads or
//   hears are units too: a picture's alt text, a tooltip (title), a screen reader's name (aria-label), a box's hint
//   (placeholder), a button's words (value) and the page's description. Scripts, styles, SVG and anything marked
//   translate="no" are left alone. The page's title is a unit.
// - Captions (WebVTT): each cue's words.
// - The manifest's titles, which the LMS shows: imsmanifest.xml's titles, cmi5.xml's and tincan.xml's names and
//   descriptions.
//
// Words that a course's scripts or data files hold (most of a Storyline, Rise or Captivate course) are not reached:
// which strings are words and which are code differs from program to program. The summary says how many such files
// there are. A file comes back exactly as it was except for the words translated, in its own character encoding.

import type { OpenedPackage } from "../model.ts";
import { hasWords, isMarkup, tagInfo, toItems, type Item } from "./inline.ts";

export interface Unit {
  /** Stable while the file does not change: the file's path, #, and the unit's number in it. */
  id: string;
  file: string;
  /** "html" for words that may hold tags, "plain" for words alone (an attribute, a title). */
  kind: "html" | "plain";
  items: Item[];
  /** What it is and where, for the translator. */
  note: string;
}

export interface TranslatableFile {
  path: string;
  kind: "page" | "captions" | "manifest";
  units: Unit[];
  /** The file with `translations` (unit id to its new items) in place; `language` is set as the page's language. */
  rebuild(translations: ReadonlyMap<string, Item[]>, language?: string): Uint8Array;
}

export interface Extraction {
  files: TranslatableFile[];
  /** The package's language as it says it, if it does. */
  sourceLanguage?: string;
  /** Files holding words this does not reach, by kind, in words. */
  notReached: string[];
}

// ---- character encodings: a page comes back in the encoding it came in

let cp1252Back: Map<string, number> | undefined;
function cp1252Encoder(): Map<string, number> {
  if (!cp1252Back) {
    cp1252Back = new Map();
    const decoded = new TextDecoder("windows-1252").decode(Uint8Array.from({ length: 256 }, (_, i) => i));
    for (let i = 0; i < 256; i++) cp1252Back.set(decoded[i]!, i);
  }
  return cp1252Back;
}

interface Decoded {
  text: string;
  encoding: "utf-8" | "windows-1252";
  bom: boolean;
}

function decodeText(bytes: Uint8Array, sniff = true): Decoded {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8", bom: true };
  if (sniff) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 2048));
    const declared = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
    if (declared && /^(windows-1252|iso-8859-1|latin-?1|us-ascii|cp1252)$/.test(declared)) return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", bom: false };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", bom: false };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", bom: false };
  }
}

/** Back to bytes. In a windows-1252 file a character it cannot hold is written as a character reference (&#NNN;),
 *  which `reference` allows only where the file is markup. */
function encodeText(text: string, how: Decoded, reference = true): Uint8Array {
  if (how.encoding === "utf-8") {
    const body = new TextEncoder().encode(text);
    if (!how.bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const map = cp1252Encoder();
  const out: number[] = [];
  for (const ch of text) {
    const b = map.get(ch);
    if (b !== undefined) out.push(b);
    else for (const c of reference ? `&#${ch.codePointAt(0)};` : "?") out.push(c.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

// ---- entities

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  bull: "•", middot: "·", deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢",
  yen: "¥", sect: "§", para: "¶", iexcl: "¡", iquest: "¿", shy: "­", ensp: " ", emsp: " ",
  thinsp: " ", zwnj: "‌", zwj: "‍", lrm: "‎", rlm: "‏", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó",
  uacute: "ú", Uacute: "Ú", agrave: "à", egrave: "è", ograve: "ò", ugrave: "ù", acirc: "â", ecirc: "ê",
  icirc: "î", ocirc: "ô", ucirc: "û", auml: "ä", Auml: "Ä", euml: "ë", iuml: "ï", ouml: "ö",
  Ouml: "Ö", uuml: "ü", Uuml: "Ü", szlig: "ß", ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç",
  aring: "å", Aring: "Å", aelig: "æ", oslash: "ø", atilde: "ã", otilde: "õ",
};

/** Text with its character references read: &amp; &#233; &#xe9; and the common named ones. An unknown one is kept. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const n = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[ref] !== undefined && whole.endsWith(";") ? NAMED[ref]! : whole;
  });
}

/** Text for markup: & (unless it already starts a reference), < and >. */
function escapeText(s: string): string {
  return s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string, quote: string): string {
  const t = escapeText(s);
  return quote === "'" ? t.replace(/'/g, "&#39;") : t.replace(/"/g, "&quot;");
}

// ---- pages

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<\/?[A-Za-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;
const RAW = new Set(["script", "style", "textarea", "xmp", "title"]);
const SKIP = new Set(["script", "style", "template", "svg", "math", "noscript", "object", "iframe", "textarea", "xmp"]);
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em", "font", "i", "img", "ins", "kbd", "mark", "nobr", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const ATTR = /([^\s"'>\/=]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;

const BLOCK_WORDS: Record<string, string> = {
  p: "A paragraph", h1: "A heading", h2: "A heading", h3: "A heading", h4: "A heading", h5: "A heading", h6: "A heading", li: "An item in a list",
  td: "A table cell", th: "A table heading", caption: "A table's caption", figcaption: "A picture's caption", button: "A button's words",
  a: "A link's words", label: "A label", option: "A choice in a list", legend: "A group's name", summary: "A heading that opens more",
  dt: "A term", dd: "A definition", blockquote: "A quotation",
};
const ATTR_WORDS: Record<string, string> = {
  alt: "A picture's description (alt text)", title: "A tooltip (title)", "aria-label": "A name a screen reader reads (aria-label)",
  "aria-description": "A description a screen reader reads (aria-description)", placeholder: "A hint shown in an empty box (placeholder)",
  value: "A button's words (value)", label: "A label (label)", content: "The page's description",
};

interface Token {
  text: string;
  start: number;
  raw?: boolean;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  while (at < src.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m || m.index !== at) break;
    out.push({ text: m[0], start: at });
    at += m[0].length;
    const info = tagInfo(m[0]);
    if (info && !info.closing && !info.selfClosing && RAW.has(info.name)) {
      const close = src.slice(at).search(new RegExp(`</${info.name}\\s*>`, "i"));
      const end = close < 0 ? src.length : at + close;
      if (end > at) out.push({ text: src.slice(at, end), start: at, raw: true });
      at = end;
    }
  }
  if (at < src.length) out.push({ text: src.slice(at), start: at });
  return out;
}

function attrValue(token: string, name: string): string | undefined {
  ATTR.lastIndex = 0;
  for (const m of token.matchAll(ATTR)) if (m[1]!.toLowerCase() === name) return m[3]!.replace(/^["']|["']$/g, "");
  return undefined;
}

interface AttrUnit {
  /** Where the value is in the token, quotes included. */
  start: number;
  end: number;
  quote: string;
  unit: Unit;
}

function readPage(path: string, bytes: Uint8Array): TranslatableFile & { language?: string } {
  const decoded = decodeText(bytes);
  const src = decoded.text;
  const tokens = tokenize(src);
  const units: Unit[] = [];
  const attrs = new Map<number, AttrUnit[]>(); // token index -> its translatable attributes
  type Part = { kind: "tok"; index: number } | { kind: "seg"; unit: Unit; from: number; to: number };
  const parts: Part[] = [];
  let n = 0;
  const id = () => `${path}#${++n}`;
  let block = "";
  let language: string | undefined;
  let htmlTag = -1;

  const attributeUnits = (index: number, token: string, name: string) => {
    const found: AttrUnit[] = [];
    const nameEnd = /^<\/?[^\s/>]+/.exec(token)![0].length;
    const type = attrValue(token, "type")?.toLowerCase();
    const metaName = (attrValue(token, "name") ?? attrValue(token, "property") ?? "").toLowerCase();
    ATTR.lastIndex = 0;
    for (const m of token.slice(nameEnd).matchAll(ATTR)) {
      const attr = m[1]!.toLowerCase();
      const wanted =
        ["alt", "title", "aria-label", "aria-description", "placeholder"].includes(attr) ||
        (attr === "value" && name === "input" && ["button", "submit", "reset"].includes(type ?? "")) ||
        (attr === "label" && ["track", "option", "optgroup"].includes(name)) ||
        (attr === "content" && name === "meta" && ["description", "og:title", "og:description"].includes(metaName));
      if (!wanted) continue;
      const rawValue = m[3]!;
      const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : "";
      const text = decodeEntities(quote ? rawValue.slice(1, -1) : rawValue);
      if (!/\p{L}/u.test(text)) continue;
      const start = nameEnd + m.index! + m[1]!.length + m[2]!.length;
      const unit: Unit = { id: id(), file: path, kind: "plain", items: [{ kind: "t", text: text.trim() }], note: `${ATTR_WORDS[attr] ?? attr}, on a ${name} element in ${path}` };
      found.push({ start, end: start + rawValue.length, quote, unit });
      units.push(unit);
    }
    if (found.length) attrs.set(index, found);
  };

  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const toks = run.map((i) => tokens[i]!.text);
    const items = toItems(toks, decodeEntities);
    if (hasWords(items)) {
      // Spaces at either end stay in the page, where the translator never sees them.
      let from = 0;
      let to = run.length - 1;
      while (from <= to && !isMarkup(toks[from]!) && !toks[from]!.trim()) from++;
      while (to >= from && !isMarkup(toks[to]!) && !toks[to]!.trim()) to--;
      for (let k = 0; k < from; k++) parts.push({ kind: "tok", index: run[k]! });
      const lead = toks[from]!.match(/^\s+/)?.[0] ?? "";
      const trail = toks[to]!.match(/\s+$/)?.[0] ?? "";
      const core = toItems(toks.slice(from, to + 1), decodeEntities);
      const first = core[0];
      const last = core[core.length - 1];
      if (first?.kind === "t") first.text = first.text.replace(/^\s+/, "");
      if (last?.kind === "t") last.text = last.text.replace(/\s+$/, "");
      const unit: Unit = { id: id(), file: path, kind: "html", items: core.filter((i) => i.kind !== "t" || i.text), note: `${BLOCK_WORDS[block] ?? "Words"} in ${path}` };
      units.push(unit);
      parts.push({ kind: "seg", unit, from: run[from]!, to: run[to]! });
      (unit as Unit & { lead?: string; trail?: string }).lead = isMarkup(toks[from]!) ? "" : lead;
      (unit as Unit & { lead?: string; trail?: string }).trail = isMarkup(toks[to]!) ? "" : trail;
      for (let k = to + 1; k < run.length; k++) parts.push({ kind: "tok", index: run[k]! });
    } else for (const i of run) parts.push({ kind: "tok", index: i });
    run = [];
  };

  const skip: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const info = tok.raw ? null : tagInfo(tok.text);
    if (skip.length) {
      if (info && info.name === skip[skip.length - 1] && !VOID.has(info.name) && !info.selfClosing) {
        if (info.closing) skip.pop();
        else skip.push(info.name);
      }
      parts.push({ kind: "tok", index: i });
      continue;
    }
    if (tok.raw) {
      const prev = tagInfo(tokens[i - 1]?.text ?? "");
      if (prev?.name === "title" && /\p{L}/u.test(tok.text)) {
        const unit: Unit = { id: id(), file: path, kind: "plain", items: [{ kind: "t", text: decodeEntities(tok.text).trim() }], note: `The page's title, shown on its tab, in ${path}` };
        units.push(unit);
        parts.push({ kind: "seg", unit, from: i, to: i });
        (unit as Unit & { lead?: string; trail?: string }).lead = tok.text.match(/^\s*/)![0];
        (unit as Unit & { lead?: string; trail?: string }).trail = tok.text.match(/\s*$/)![0];
      } else parts.push({ kind: "tok", index: i });
      continue;
    }
    if (!info) {
      if (tok.text.startsWith("<!--") && run.length) run.push(i);
      else if (tok.text.startsWith("<") && !tok.text.startsWith("<!--") && tok.text !== "<") {
        flush();
        parts.push({ kind: "tok", index: i }); // a doctype or processing instruction
      } else if (tok.text.startsWith("<!--")) parts.push({ kind: "tok", index: i });
      else run.push(i);
      continue;
    }
    const translateNo = /\btranslate\s*=\s*["']?no\b/i.test(tok.text) || /\bclass\s*=\s*["'][^"']*\bnotranslate\b/i.test(tok.text);
    if (!info.closing) {
      if (info.name === "html") {
        htmlTag = i;
        language = attrValue(tok.text, "lang") ?? language;
      }
      if (!translateNo) attributeUnits(i, tok.text, info.name);
    }
    if (!info.closing && !info.selfClosing && !VOID.has(info.name) && (SKIP.has(info.name) || translateNo)) {
      flush();
      parts.push({ kind: "tok", index: i });
      if (!RAW.has(info.name) || translateNo) skip.push(info.name);
      continue;
    }
    if (INLINE.has(info.name)) {
      run.push(i);
      continue;
    }
    flush();
    if (!info.closing) block = info.name;
    parts.push({ kind: "tok", index: i });
  }
  flush();

  const renderTag = (index: number, tr: ReadonlyMap<string, Item[]>, lang?: string): string => {
    let token = tokens[index]!.text;
    const found = attrs.get(index) ?? [];
    for (const a of [...found].reverse()) {
      const t = tr.get(a.unit.id);
      if (!t) continue;
      const text = t.map((x) => (x.kind === "t" ? x.text : "")).join("");
      const q = a.quote || '"';
      token = token.slice(0, a.start) + q + escapeAttr(text, q) + q + token.slice(a.end);
    }
    if (lang && index === htmlTag) {
      const m = /(\slang\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/i.exec(token);
      token = m ? token.slice(0, m.index) + m[1] + `"${lang}"` + token.slice(m.index + m[0].length) : token.replace(/^<html/i, `<html lang="${lang}"`);
    }
    return token;
  };

  return {
    path,
    kind: "page",
    units,
    language,
    rebuild(tr, lang) {
      const out: string[] = [];
      for (const p of parts) {
        if (p.kind === "tok") {
          out.push(tokens[p.index]!.raw ? tokens[p.index]!.text : renderTag(p.index, tr, lang));
          continue;
        }
        const target = tr.get(p.unit.id);
        if (!target) {
          for (let k = p.from; k <= p.to; k++) out.push(tokens[k]!.raw ? tokens[k]!.text : renderTag(k, tr, lang));
          continue;
        }
        const u = p.unit as Unit & { lead?: string; trail?: string };
        // A tag in the translation is the source's literal tag; its translated attributes are put in it.
        const literals = new Map<string, string>();
        for (let k = p.from; k <= p.to; k++) if (!tokens[k]!.raw && isMarkup(tokens[k]!.text)) literals.set(tokens[k]!.text, renderTag(k, tr, lang));
        out.push(u.lead ?? "");
        out.push(target.map((x) => (x.kind === "t" ? escapeText(x.text) : literals.get(x.literal) ?? x.literal)).join(""));
        out.push(u.trail ?? "");
      }
      return encodeText(out.join(""), decoded);
    },
  };
}

// ---- captions

function readCaptions(path: string, bytes: Uint8Array): TranslatableFile {
  const decoded = decodeText(bytes, false);
  const lines = decoded.text.split(/(\r\n|\n|\r)/); // separators kept, so the file comes back as it was
  const units: Unit[] = [];
  const cues: { start: number; end: number; unit: Unit }[] = []; // line indexes (in `lines`) of a cue's text
  let n = 0;
  let i = 0;
  const textLine = (k: number) => k < lines.length && lines[k]!.trim() !== "";
  while (i < lines.length) {
    if (lines[i]!.includes("-->")) {
      let j = i + 2;
      const start = j;
      while (textLine(j)) j += 2;
      if (j > start) {
        const raw = lines.slice(start, j - 1).join("");
        const items = toItems(raw.match(/<[^<>]*>|[^<]+|</g) ?? [], decodeEntities);
        if (hasWords(items)) {
          const unit: Unit = { id: `${path}#${++n}`, file: path, kind: "html", items, note: `A caption (cue ${n}) in ${path}` };
          units.push(unit);
          cues.push({ start, end: j - 1, unit });
        }
      }
      i = j;
    } else i += 2;
  }
  return {
    path,
    kind: "captions",
    units,
    rebuild(tr) {
      const out = [...lines];
      for (const c of [...cues].reverse()) {
        const t = tr.get(c.unit.id);
        if (!t) continue;
        const text = t.map((x) => (x.kind === "t" ? escapeText(x.text) : x.literal)).join("");
        out.splice(c.start, c.end - c.start, text);
      }
      return encodeText(out.join(""), decoded, false);
    },
  };
}

// ---- the manifest's titles

function readManifest(path: string, bytes: Uint8Array, names: string[]): TranslatableFile & { language?: string } {
  const decoded = decodeText(bytes, false);
  const src = decoded.text;
  const units: Unit[] = [];
  const spots: { start: number; end: number; unit: Unit }[] = [];
  let language: string | undefined;
  const re = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?(${names.join("|")}))(\\s[^>]*)?>([^<]+)</\\1\\s*>`, "g");
  let n = 0;
  for (const m of src.matchAll(re)) {
    const text = m[4]!;
    if (!/\p{L}/u.test(text)) continue;
    language ??= /\b(?:xml:)?lang\s*=\s*["']([^"']+)/.exec(m[3] ?? "")?.[1];
    const start = m.index! + m[0].indexOf(">") + 1;
    const unit: Unit = { id: `${path}#${++n}`, file: path, kind: "plain", items: [{ kind: "t", text: decodeEntities(text).trim() }], note: `A title or description the LMS shows (<${m[2]}> in ${path})` };
    units.push(unit);
    spots.push({ start, end: start + text.length, unit });
  }
  return {
    path,
    kind: "manifest",
    units,
    language,
    rebuild(tr) {
      let out = src;
      for (const s of [...spots].reverse()) {
        const t = tr.get(s.unit.id);
        if (!t) continue;
        const lead = src.slice(s.start, s.end).match(/^\s*/)![0];
        const trail = src.slice(s.start, s.end).match(/\s*$/)![0];
        out = out.slice(0, s.start) + lead + escapeText(t.map((x) => (x.kind === "t" ? x.text : "")).join("")) + trail + out.slice(s.end);
      }
      return encodeText(out, decoded);
    },
  };
}

/** Everything in a package a translator can work on. `read` gives a file's bytes (or undefined if it cannot be read). */
export function extractPackage(report: OpenedPackage, read: (path: string) => Uint8Array | undefined): Extraction {
  const files: TranslatableFile[] = [];
  let sourceLanguage: string | undefined;
  const launch = new Set(report.launches.map((l) => l.file).filter(Boolean));
  let scripts = 0;
  let documents = 0;
  let flash = 0;
  const paths = report.files.map((f) => f.path).filter((p) => !p.endsWith("/") && p.startsWith(report.root)).sort((a, b) => Number(launch.has(b)) - Number(launch.has(a)) || a.localeCompare(b));
  for (const path of paths) {
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    let file: (TranslatableFile & { language?: string }) | undefined;
    if (/\.(html?|xhtml)$/.test(lower)) {
      const bytes = read(path);
      if (bytes) file = readPage(path, bytes);
    } else if (lower.endsWith(".vtt")) {
      const bytes = read(path);
      if (bytes) file = readCaptions(path, bytes);
    } else if (path === report.manifest && ["imsmanifest.xml", "cmi5.xml", "tincan.xml"].includes(base)) {
      const bytes = read(path);
      const names = base === "imsmanifest.xml" ? ["title", "langstring"] : base === "cmi5.xml" ? ["langstring"] : ["name", "description"];
      if (bytes) file = readManifest(path, bytes, names);
    } else if (/\.(m?js|json)$/.test(lower)) scripts++;
    else if (/\.(pdf|docx?|pptx?|xlsx?)$/.test(lower)) documents++;
    else if (lower.endsWith(".swf")) flash++;
    if (!file) continue;
    sourceLanguage ??= file.language;
    if (file.units.length) files.push(file);
  }
  const notReached: string[] = [];
  if (scripts) notReached.push(`${scripts} script and data file${scripts === 1 ? "" : "s"} (.js, .json). Programs such as Storyline, Rise and Captivate keep most of a course's words in these, and which strings in them are words is different for each program, so they are not read.`);
  if (documents) notReached.push(`${documents} document${documents === 1 ? "" : "s"} (PDF, Word, PowerPoint, Excel). Translate them on their own and put each translated copy in with Replace a file.`);
  if (flash) notReached.push(`${flash} Flash file${flash === 1 ? "" : "s"} (.swf), which browsers no longer play.`);
  return { files, sourceLanguage, notReached };
}
