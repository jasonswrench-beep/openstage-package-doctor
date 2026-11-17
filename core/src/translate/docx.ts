// A Word table for translating a package, for a translator who works in Word rather than a translation tool: one row
// for each piece of text, with its number, the original, an empty column for the translation, and what it is. Bold,
// links and the like show as numbered markers ([[1]] ... [[/1]], and [[2/]] for something that stands alone, such as
// a line break), the Word form of XLIFF's tags; they are checked when the table comes back, just as XLIFF's are.
// The table is read back from the Translation column. Tracked changes count as accepted; deleted text is left out.

import { strToU8, unzipSync, zipSync } from "fflate";
import { parseXml, type XmlElement } from "../xml.ts";
import type { Extraction } from "./extract.ts";
import { TranslationError, xattr, xtext, type Item } from "./inline.ts";
import { checkLanguage } from "./xliff.ts";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** The items as text with markers: [[n]] opens, [[/n]] closes (n the opening tag's number), [[n/]] stands alone. */
export function markedText(items: Item[]): string {
  const opens = new Map<number, number>();
  for (const it of items) if (it.kind === "open") opens.set(it.pair, it.id);
  return items
    .map((it) => {
      if (it.kind === "t") return it.text;
      if (it.kind === "open") return `[[${it.id}]]`;
      if (it.kind === "close") return `[[/${opens.get(it.pair) ?? it.id}]]`;
      return `[[${it.id}/]]`;
    })
    .join("");
}

/** A marked translation back as items, the markers turned into the source's own tags. A marker the source does not
 *  have stays as text, so the tag check finds it. */
export function itemsFromMarked(text: string, source: Item[]): Item[] {
  const byId = new Map<number, Item>();
  const closeOf = new Map<number, Item>();
  const pairToOpen = new Map<number, number>();
  for (const it of source) {
    if (it.kind === "open") pairToOpen.set(it.pair, it.id);
    if (it.kind === "open" || it.kind === "ph") byId.set(it.id, it);
  }
  for (const it of source) if (it.kind === "close") closeOf.set(pairToOpen.get(it.pair) ?? it.id, it);
  const out: Item[] = [];
  const add = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.kind === "t") last.text += s;
    else out.push({ kind: "t", text: s });
  };
  let at = 0;
  for (const m of text.matchAll(/\[\[(\/?)(\d+)(\/?)\]\]/g)) {
    add(text.slice(at, m.index));
    at = m.index! + m[0].length;
    const n = Number(m[2]);
    const tag = m[1] ? closeOf.get(n) : m[3] ? byId.get(n) : byId.get(n);
    const right = tag && ((m[1] && tag.kind === "close") || (m[3] && tag.kind === "ph") || (!m[1] && !m[3] && tag.kind === "open"));
    if (right) out.push({ ...tag });
    else add(m[0]);
  }
  add(text.slice(at));
  return out;
}

function runs(text: string, props = ""): string {
  const rpr = props ? `<w:rPr>${props}</w:rPr>` : "";
  return text
    .split("\n")
    .map((line, i) => `${i ? `<w:r>${rpr}<w:br/></w:r>` : ""}<w:r>${rpr}<w:t xml:space="preserve">${xtext(line)}</w:t></w:r>`)
    .join("");
}

function para(text: string, props = "", ppr = ""): string {
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs(text, props)}</w:p>`;
}

function cell(width: number, content: string, shade = ""): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ""}</w:tcPr>${content}</w:tc>`;
}

/** The Word table for translating `extraction` from `source` into `target`, as a .docx file. */
export function writeDocxTable(packageName: string, extraction: Extraction, source: string, target: string): Uint8Array {
  checkLanguage(source, "course's language");
  checkLanguage(target, "language to translate into");
  const widths = [1700, 5600, 5600, 2500];
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${["Number", `Original (${source})`, `Translation (${target})`, "What it is"].map((t, i) => cell(widths[i]!, para(t, "<w:b/>"), "D9E2F3")).join("")}</w:tr>`;
  const rows: string[] = [];
  for (const f of extraction.files) {
    for (const u of f.units) {
      rows.push(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(widths[0]!, para(u.id, '<w:color w:val="595959"/><w:sz w:val="16"/>'))}${cell(widths[1]!, para(markedText(u.items)))}${cell(widths[2]!, para(""))}${cell(widths[3]!, para(u.note, '<w:color w:val="595959"/><w:sz w:val="18"/>'))}</w:tr>`,
      );
    }
  }
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join("");
  const body = [
    para(`Translation of ${packageName}`, '<w:b/><w:sz w:val="32"/>', '<w:pStyle w:val="Heading1"/>'),
    para(`From ${source} into ${target}.`),
    para("Write each translation in the Translation column, beside its original. Leave the Number column and the Original column as they are: Package Doctor finds each row by its number and checks the original still matches the package."),
    para("Markers such as [[1]] and [[/1]] mark words that are bold, a link or similar: keep each pair around the words it belongs to (you may move them). A marker such as [[2/]] is something in the text, such as a line break or a picture: keep it. Keep any {placeholder} exactly as it is."),
    para("A row left empty stays in the original language. When you are done, save the document as a Word file (.docx) and open it in Package Doctor's Translate part."),
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${header}${rows.join("")}</w:tbl>`,
    para(""),
    `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`,
  ].join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="${xattr(source)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(styles),
  });
}

/** The words of a cell: its paragraphs on separate lines, tracked insertions in, deletions out. */
function cellText(tc: XmlElement): string {
  const paras: string[] = [];
  const inline = (el: XmlElement, out: string[]) => {
    for (const c of el.children) {
      if (c.ns !== W) continue;
      if (c.local === "t") out.push(c.text);
      else if (c.local === "tab") out.push("\t");
      else if (c.local === "br" || c.local === "cr") out.push("\n");
      else if (c.local === "del" || c.local === "delText" || c.local === "rPr" || c.local === "pPr") continue;
      else inline(c, out);
    }
  };
  const block = (el: XmlElement) => {
    for (const c of el.children) {
      if (c.ns !== W) continue;
      if (c.local === "p") {
        const out: string[] = [];
        inline(c, out);
        paras.push(out.join(""));
      } else if (c.local !== "tcPr") block(c);
    }
  };
  block(tc);
  while (paras.length > 1 && paras[paras.length - 1] === "") paras.pop();
  return paras.join("\n");
}

export interface ReadTable {
  targetLanguage?: string;
  /** Unit id to the text in its Translation column, for every row where it is not empty. */
  rows: Map<string, string>;
}

/** Reads a translated Word table made by writeDocxTable. */
export function readDocxTable(bytes: Uint8Array): ReadTable {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  } catch {
    throw new TranslationError("The file is not a Word document (.docx) that can be opened. Save it from Word as a .docx and try again.");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new TranslationError("The file is not a Word document: it has no word/document.xml.");
  const root = parseXml(new TextDecoder().decode(xml));
  const rows = new Map<string, string>();
  let targetLanguage: string | undefined;
  let found = false;
  const walk = (el: XmlElement) => {
    for (const c of el.children) {
      if (c.ns === W && c.local === "p" && !targetLanguage) {
        const m = /^From (\S+) into (\S+)\.$/.exec(cellText({ ...c, children: [c] } as XmlElement).trim());
        if (m) targetLanguage = m[2];
      }
      if (c.ns === W && c.local === "tr") {
        const cells = c.children.filter((x) => x.ns === W && x.local === "tc");
        const first = cells[0] ? cellText(cells[0]).trim() : "";
        if (first === "Number") {
          found = true;
          continue;
        }
        if (cells.length >= 3 && first) {
          const translation = cellText(cells[2]!);
          if (translation.trim()) rows.set(first, translation);
        }
      } else walk(c);
    }
  };
  walk(root);
  if (!found) throw new TranslationError("No translation table was found in the document. Use the Word table Package Doctor made, with its Number, Original and Translation columns.");
  return { targetLanguage, rows };
}
