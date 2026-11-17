// The XLIFF 1.2 file for translating a package, in OpenStage Author's form (tools/xliff.py export and import): one
// <file>, a <group> for each file in the package, a <trans-unit> for each piece of text, with xml:space="preserve",
// the source's language on <source>, and a note saying what the text is and where. Translators work in a tool that
// reads XLIFF (OmegaT, Weblate, memoQ, Trados and others), not in Package Doctor.

import { parseXml, XmlError, type XmlElement } from "../xml.ts";
import type { Extraction, Unit } from "./extract.ts";
import { canon, itemsFromElement, itemsToXml, markupProblem, plainText, TranslationError, xattr, xtext, XLIFF_NS, type Item } from "./inline.ts";

export const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function checkLanguage(tag: string, which: string): void {
  if (!LANGUAGE.test(tag)) throw new TranslationError(`"${tag}" is not a language tag for the ${which}. Use one such as en, en-US, fr or es-MX.`);
}

/** The XLIFF file for translating `extraction` from `source` into `target`. With `pseudo`, every target is filled with
 *  longer, accented text, so a course can be looked at for text that does not fit and text that was never reached. */
export function writeXliff(packageName: string, extraction: Extraction, source: string, target: string, options: { pseudo?: boolean } = {}): string {
  checkLanguage(source, "course's language");
  checkLanguage(target, "language to translate into");
  if (source.toLowerCase() === target.toLowerCase()) throw new TranslationError(`The course is already in ${source}. Choose another language, or another variety such as en-GB.`);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xliff version="1.2" xmlns="${XLIFF_NS}">`,
    `  <file original="${xattr(packageName)}" source-language="${xattr(source)}" target-language="${xattr(target)}" datatype="x-openstage-package" tool-id="openstage-package-doctor">`,
    "    <header>",
    '      <tool tool-id="openstage-package-doctor" tool-name="OpenStage Package Doctor"/>',
    "      <note>Translate the text inside each source element. The coloured or bracketed tags in it are formatting and links: keep every one, and you may move them. Keep any {placeholder} exactly as it is. Do not change the source text: Package Doctor checks it still matches the package.</note>",
    "    </header>",
    "    <body>",
  ];
  for (const file of extraction.files) {
    out.push(`      <group id="${xattr(file.path)}" resname="${xattr(file.path)}">`);
    for (const u of file.units) {
      out.push(`        <trans-unit id="${xattr(u.id)}" xml:space="preserve" restype="x-${u.kind}">`);
      out.push(`          <source xml:lang="${xattr(source)}">${itemsToXml(u.items)}</source>`);
      if (options.pseudo) out.push(`          <target xml:lang="${xattr(target)}" state="needs-review-translation">${itemsToXml(pseudoItems(u.items))}</target>`);
      out.push(`          <note from="developer">${xtext(u.note)}</note>`);
      out.push("        </trans-unit>");
    }
    out.push("      </group>");
  }
  out.push("    </body>", "  </file>", "</xliff>", "");
  return out.join("\n");
}

const ACCENTED: Record<string, string> = { a: "á", e: "é", i: "í", o: "ö", u: "ü", A: "Å", E: "É", I: "Î", O: "Ø", U: "Ü", c: "ç", n: "ñ", y: "ý" };

/** Words made accented and about a third longer, inside brackets, with the tags and placeholders kept. */
export function pseudoItems(items: Item[]): Item[] {
  const out = items.map((it) => (it.kind === "t" ? { kind: "t" as const, text: it.text.replace(/\{\{[^{}]*\}\}|\{[^{}]*\}|\p{L}+/gu, (w) => (w.startsWith("{") ? w : [...w].map((c) => ACCENTED[c] ?? c).join("") + (w.length > 3 ? "~".repeat(Math.ceil(w.length / 3)) : ""))) } : it));
  const first = out.findIndex((i) => i.kind === "t");
  const last = out.length - 1 - [...out].reverse().findIndex((i) => i.kind === "t");
  if (first >= 0) (out[first] as { text: string }).text = `⟦${(out[first] as { text: string }).text}`;
  if (first >= 0) (out[last] as { text: string }).text = `${(out[last] as { text: string }).text}⟧`;
  return out;
}

export interface ReadUnit {
  source: Item[];
  target?: Item[];
  state?: string;
}

export interface ReadXliff {
  targetLanguage?: string;
  units: Map<string, ReadUnit>;
}

/** Reads a translated XLIFF 1.2 file. A file with a document type or entity declaration is refused, as Author does. */
export function readXliff(text: string): ReadXliff {
  const head = text.slice(0, 200000).toLowerCase();
  if (head.includes("<!doctype") || head.includes("<!entity")) throw new TranslationError("The file has a document type or entity declaration, which a translation file does not need. It was not read.");
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    throw new TranslationError(e instanceof XmlError ? `The file is not well-formed XML (line ${e.line}): ${e.message}` : String(e));
  }
  if (root.local !== "xliff") throw new TranslationError("The file is not an XLIFF file: its top element is not <xliff>.");
  const version = root.attrs.find((a) => a.local === "version")?.value;
  if (!["1.2", "1.1", "1.0"].includes(version ?? "")) throw new TranslationError(`The file is XLIFF ${version ?? "of no version"}; Package Doctor reads XLIFF 1.2. Most translation tools can save 1.2.`);
  const units = new Map<string, ReadUnit>();
  let targetLanguage: string | undefined;
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (c.local === "file") targetLanguage ??= c.attrs.find((a) => a.local === "target-language")?.value;
      if (c.local === "trans-unit") {
        const id = c.attrs.find((a) => a.local === "id")?.value;
        const source = c.children.find((x) => x.local === "source");
        const target = c.children.find((x) => x.local === "target");
        if (!id || !source) continue;
        const read: ReadUnit = { source: itemsFromElement(source) };
        if (target) {
          read.target = itemsFromElement(target);
          read.state = target.attrs.find((a) => a.local === "state")?.value;
        }
        units.set(id, read);
      } else walk(c);
    }
  };
  walk(root);
  return { targetLanguage, units };
}

export interface Matched {
  /** Unit id to its translation, for every unit that can be put back. */
  translations: Map<string, Item[]>;
  translated: number;
  /** Units with no translation in the file: they stay in the original language. */
  untranslated: number;
  /** Units that could not be put back, and why. */
  kept: { id: string; text: string; why: string }[];
  /** Units in the file that are not in this package. */
  unknown: number;
}

/** Matches a read translation against the package's units: each target goes back only if its source still matches and
 *  its tags and placeholders are the source's. */
export function matchTranslations(units: Unit[], read: Map<string, ReadUnit>): Matched {
  const m: Matched = { translations: new Map(), translated: 0, untranslated: 0, kept: [], unknown: 0 };
  const known = new Set(units.map((u) => u.id));
  for (const id of read.keys()) if (!known.has(id)) m.unknown++;
  for (const u of units) {
    const r = read.get(u.id);
    if (!r?.target || !plainText(r.target) && !r.target.some((i) => i.kind !== "t")) {
      m.untranslated++;
      continue;
    }
    if (canon(r.source) !== canon(u.items) && plainText(r.source) !== plainText(u.items)) {
      m.kept.push({ id: u.id, text: plainText(u.items), why: "its source no longer matches the package (the package or the file was changed)" });
      continue;
    }
    // Tags are compared by their literal text; the file's tags carry the literals the package's source had.
    const problem = markupProblem(u.items, r.target);
    if (problem) {
      m.kept.push({ id: u.id, text: plainText(u.items), why: problem });
      continue;
    }
    m.translations.set(u.id, r.target);
    m.translated++;
  }
  return m;
}
