// A small XML reader for package manifests. It works the same in Node and in the program's window (no DOMParser),
// resolves namespaces the way an LMS's importer does (so `adlcp:scormtype` is found whatever prefix a tool chose), and
// gives the line of every element and of every mistake. It refuses what a strict XML reader refuses, because many
// LMSs use one: an unclosed or mismatched tag, an undeclared prefix, an unknown entity, a repeated attribute.

export interface XmlAttr {
  name: string;
  local: string;
  prefix: string;
  ns: string;
  value: string;
}

export interface XmlElement {
  name: string;
  local: string;
  prefix: string;
  ns: string;
  attrs: XmlAttr[];
  children: XmlElement[];
  /** The element's own text (not its children's), with entities decoded. */
  text: string;
  /** Its text and child elements in document order, for mixed content such as a translation with bold in it. */
  nodes: (string | XmlElement)[];
  line: number;
}

function addText(el: XmlElement, s: string): void {
  if (!s) return;
  el.text += s;
  const last = el.nodes[el.nodes.length - 1];
  if (typeof last === "string") el.nodes[el.nodes.length - 1] = last + s;
  else el.nodes.push(s);
}

export class XmlError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "XmlError";
    this.line = line;
    this.column = column;
  }
}

export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export interface DecodedText {
  text: string;
  encoding: string;
  /** Set when the file said one encoding and its bytes did not fit it, or named one that is not known. */
  encodingProblem?: string;
}

/** Turns a file's bytes into text, as an XML reader would: a byte-order mark first, then the declaration's encoding. */
export function decodeXmlBytes(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeAs(bytes.subarray(3), "utf-8");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1]?.toLowerCase();
  if (!declared || declared === "utf-8" || declared === "utf8") return decodeAs(bytes, "utf-8");
  try {
    return { text: new TextDecoder(declared).decode(bytes), encoding: declared };
  } catch {
    const fallback = decodeAs(bytes, "utf-8");
    return { ...fallback, encodingProblem: `The file says its encoding is "${declared}", which is not one an XML reader knows.` };
  }
}

function decodeAs(bytes: Uint8Array, encoding: "utf-8"): DecodedText {
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
      encodingProblem: "The file is meant to be UTF-8 but has characters saved in another encoding (often accented letters typed in an older editor).",
    };
  }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const NAME = /[A-Za-z_:À-￿][-A-Za-z0-9_:.·À-￿]*/y;

export function parseXml(source: string): XmlElement {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const where = (at: number): [number, number] => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return [lo + 1, at - lineStarts[lo]! + 1];
  };
  const fail = (message: string, at: number): never => {
    const [line, column] = where(at);
    throw new XmlError(message, line, column);
  };

  const decode = (raw: string, at: number): string =>
    raw.indexOf("&") < 0
      ? raw
      : raw.replace(/&([^;\s&<]*);?/g, (match, body: string, offset: number) => {
          if (!match.endsWith(";")) fail("An & must start an entity such as &amp; (write &amp; for a plain &).", at + offset);
          if (body.startsWith("#x") || body.startsWith("#X")) {
            const code = parseInt(body.slice(2), 16);
            if (!Number.isFinite(code) || code > 0x10ffff) fail(`&${body}; is not a character.`, at + offset);
            return String.fromCodePoint(code);
          }
          if (body.startsWith("#")) {
            const code = parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code > 0x10ffff) fail(`&${body}; is not a character.`, at + offset);
            return String.fromCodePoint(code);
          }
          const value = ENTITIES[body];
          if (value === undefined) fail(`&${body}; is not an entity XML knows (only &lt; &gt; &amp; &quot; &apos; and numbers).`, at + offset);
          return value!;
        });

  interface Open {
    el: XmlElement;
    scope: Map<string, string>;
    at: number;
  }
  const stack: Open[] = [];
  let root: XmlElement | undefined;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  const readName = (at: number): string => {
    NAME.lastIndex = at;
    const m = NAME.exec(source);
    if (!m) fail("A name was expected here.", at);
    return m![0];
  };
  const skipSpace = (at: number): number => {
    while (at < source.length && /\s/.test(source[at]!)) at++;
    return at;
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > i) {
      const raw = source.slice(i, textEnd);
      if (stack.length) addText(stack[stack.length - 1]!.el, decode(raw, i));
      else if (raw.trim()) fail(root ? "There is text after the end of the document." : "There is text before the document starts.", i);
    }
    if (lt < 0) break;
    i = lt;

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) fail("A comment is never closed (-->).", i);
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0) fail("A CDATA section is never closed (]]>).", i);
      if (!stack.length) fail("A CDATA section is outside the document.", i);
      addText(stack[stack.length - 1]!.el, source.slice(i + 9, end));
      i = end + 3;
    } else if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end < 0) fail("A processing instruction (<?...?>) is never closed.", i);
      i = end + 2;
    } else if (source.startsWith("<!DOCTYPE", i)) {
      let depth = 0;
      let j = i + 9;
      for (; j < source.length; j++) {
        const c = source[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (j >= source.length) fail("The DOCTYPE is never closed.", i);
      i = j + 1;
    } else if (source.startsWith("</", i)) {
      const name = readName(i + 2);
      const end = skipSpace(i + 2 + name.length);
      if (source[end] !== ">") fail(`The closing tag </${name}> is not closed with >.`, i);
      const top = stack.pop();
      if (!top) fail(`</${name}> closes a tag that was never opened.`, i);
      if (top!.el.name !== name) {
        const [line] = where(top!.at);
        fail(`</${name}> is here, but the open tag is <${top!.el.name}> from line ${line}.`, i);
      }
      i = end + 1;
    } else {
      const tagAt = i;
      const name = readName(i + 1);
      let j = i + 1 + name.length;
      const rawAttrs: { name: string; value: string; at: number }[] = [];
      let selfClosing = false;
      for (;;) {
        const k = skipSpace(j);
        if (k >= source.length) fail(`The tag <${name}> is never closed with >.`, tagAt);
        if (source[k] === ">") { j = k + 1; break; }
        if (source.startsWith("/>", k)) { j = k + 2; selfClosing = true; break; }
        if (k === j) fail(`<${name}> needs a space before each attribute.`, k);
        const attrName = readName(k);
        let m = skipSpace(k + attrName.length);
        if (source[m] !== "=") fail(`The attribute ${attrName} on <${name}> has no value (write ${attrName}="...").`, k);
        m = skipSpace(m + 1);
        const quote = source[m];
        if (quote !== '"' && quote !== "'") fail(`The value of ${attrName} on <${name}> must be in quotes.`, m);
        const close = source.indexOf(quote!, m + 1);
        if (close < 0) fail(`The value of ${attrName} on <${name}> is never closed.`, m);
        const raw = source.slice(m + 1, close);
        if (raw.includes("<")) fail(`The value of ${attrName} on <${name}> contains a <, which XML does not allow.`, m);
        if (rawAttrs.some((a) => a.name === attrName)) fail(`<${name}> has the attribute ${attrName} twice.`, k);
        rawAttrs.push({ name: attrName, value: decode(raw, m + 1).replace(/[\t\n\r]/g, " "), at: k });
        j = close + 1;
      }

      if (root && !stack.length) fail(`A second top-level element <${name}> follows the document's end.`, tagAt);
      const parentScope = stack.length ? stack[stack.length - 1]!.scope : new Map([["xml", XML_NS]]);
      let scope = parentScope;
      for (const a of rawAttrs) {
        if (a.name === "xmlns" || a.name.startsWith("xmlns:")) {
          if (scope === parentScope) scope = new Map(parentScope);
          scope.set(a.name === "xmlns" ? "" : a.name.slice(6), a.value);
        }
      }
      const split = (qname: string, at: number, isAttr: boolean): { prefix: string; local: string; ns: string } => {
        const colon = qname.indexOf(":");
        const prefix = colon < 0 ? "" : qname.slice(0, colon);
        const local = colon < 0 ? qname : qname.slice(colon + 1);
        if (!prefix) return { prefix, local, ns: isAttr ? "" : scope.get("") ?? "" };
        const ns = scope.get(prefix);
        if (ns === undefined) fail(`The prefix "${prefix}:" in ${qname} is used but never declared with xmlns:${prefix}="...".`, at);
        return { prefix, local, ns: ns! };
      };
      const el: XmlElement = { name, ...split(name, tagAt, false), attrs: [], children: [], text: "", nodes: [], line: where(tagAt)[0] };
      for (const a of rawAttrs) {
        if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue;
        el.attrs.push({ name: a.name, value: a.value, ...split(a.name, a.at, true) });
      }
      if (stack.length) {
        stack[stack.length - 1]!.el.children.push(el);
        stack[stack.length - 1]!.el.nodes.push(el);
      }
      else root = el;
      if (!selfClosing) stack.push({ el, scope, at: tagAt });
      i = j;
    }
  }
  if (stack.length) {
    const top = stack[stack.length - 1]!;
    fail(`<${top.el.name}> is never closed.`, top.at);
  }
  if (!root) fail("The file has no XML in it.", 0);
  return root!;
}

// Finding things. Manifest makers are inconsistent about namespaces, so these match on the local name and, when asked,
// a namespace; the readers then compare the namespace themselves where it matters.

export function kids(el: XmlElement | undefined, local: string, ns?: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c) => c.local === local && (ns === undefined || c.ns === ns));
}

export function kid(el: XmlElement | undefined, local: string, ns?: string): XmlElement | undefined {
  return el?.children.find((c) => c.local === local && (ns === undefined || c.ns === ns));
}

/** An attribute by local name; with `ns`, only in that namespace ("" for an unprefixed attribute). */
export function attr(el: XmlElement | undefined, local: string, ns?: string): string | undefined {
  return el?.attrs.find((a) => a.local === local && (ns === undefined || a.ns === ns))?.value;
}

/** The element's text with its children's text, trimmed. */
export function allText(el: XmlElement | undefined): string {
  if (!el) return "";
  return (el.text + el.children.map(allText).join(" ")).replace(/\s+/g, " ").trim();
}
