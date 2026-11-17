import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { open, scorm12, tincan } from "./helpers.ts";
import { extractPackage, type Extraction } from "../src/translate/extract.ts";
import { matchTranslations, pseudoItems, readXliff, writeXliff } from "../src/translate/xliff.ts";
import { itemsFromMarked, markedText, readDocxTable, writeDocxTable } from "../src/translate/docx.ts";
import { applyTranslations } from "../src/translate/apply.ts";
import { plainText, type Item } from "../src/translate/inline.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Lesson one</title>
  <meta name="description" content="A short lesson about listening">
  <style>p { color: red; }</style>
  <script>var greeting = "Hello there";</script>
</head>
<body>
  <h1>Listening well</h1>
  <p>Read <b>each</b> part, then <a href="next.html" title="Go to the next part">continue</a>.</p>
  <img src="ear.png" alt="An ear, drawn in pencil">
  <button aria-label="Close the window">X</button>
  <input type="submit" value="Send it">
  <p translate="no">Brand Name Ltd</p>
  <svg><text>Chart words</text></svg>
  <ul><li>First thing</li><li>  Second &amp; last  </li></ul>
  <p>   </p>
  <p>2026</p>
</body>
</html>`;

function extracted(files: Record<string, string | Uint8Array>): { ex: Extraction; read: (p: string) => Uint8Array | undefined } {
  const bytes = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? enc.encode(v) : v]));
  const r = open(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? v : "x"])));
  const read = (p: string) => bytes.get(p);
  return { ex: extractPackage(r, read), read };
}

const texts = (ex: Extraction) => ex.files.flatMap((f) => f.units.map((u) => plainText(u.items)));

test("a page's words are found: paragraphs, headings, list items, the title and the attributes a person reads", () => {
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": PAGE });
  const page = ex.files.find((f) => f.path === "index.html")!;
  assert.deepEqual(page.units.map((u) => plainText(u.items)), [
    "Lesson one",
    "A short lesson about listening",
    "Listening well",
    "Go to the next part",
    "Read each part, then continue.",
    "An ear, drawn in pencil",
    "Close the window",
    "X",
    "Send it",
    "First thing",
    "Second & last",
  ]);
  const para = page.units.find((u) => plainText(u.items).startsWith("Read"))!;
  assert.deepEqual(para.items.map((i) => i.kind), ["t", "open", "t", "close", "t", "open", "t", "close", "t"]);
  assert.match(para.note, /A paragraph in index\.html/);
  assert.equal(ex.sourceLanguage, "en");
  assert.ok(!texts(ex).some((t) => /Hello there|Brand Name|Chart words|2026/.test(t)), "scripts, translate=no, SVG and numbers are left alone");
});

test("rebuilding with nothing translated gives the file back byte for byte; translated words land in place", () => {
  const { ex, read } = extracted({ "imsmanifest.xml": scorm12(), "index.html": PAGE });
  const page = ex.files.find((f) => f.path === "index.html")!;
  assert.deepEqual(page.rebuild(new Map()), read("index.html"));
  const tr = new Map<string, Item[]>();
  for (const u of page.units) {
    const text = plainText(u.items);
    if (text === "Listening well") tr.set(u.id, [{ kind: "t", text: "Bien escuchar" }]);
    if (text === "An ear, drawn in pencil") tr.set(u.id, [{ kind: "t", text: 'Una oreja "dibujada" a lápiz' }]);
    if (text === "Go to the next part") tr.set(u.id, [{ kind: "t", text: "Ir a la parte siguiente" }]);
    if (text.startsWith("Read")) {
      const tags = u.items.filter((i) => i.kind !== "t");
      tr.set(u.id, [{ kind: "t", text: "Lee " }, tags[0]!, { kind: "t", text: "cada" }, tags[1]!, { kind: "t", text: " parte y " }, tags[2]!, { kind: "t", text: "sigue" }, tags[3]!, { kind: "t", text: " < 5 min." }]);
    }
  }
  const out = dec.decode(page.rebuild(tr, "es"));
  assert.match(out, /<html lang="es">/);
  assert.match(out, /<h1>Bien escuchar<\/h1>/);
  assert.match(out, /<p>Lee <b>cada<\/b> parte y <a href="next.html" title="Ir a la parte siguiente">sigue<\/a> &lt; 5 min\.<\/p>/);
  assert.match(out, /alt="Una oreja &quot;dibujada&quot; a lápiz"/);
  assert.match(out, /<script>var greeting = "Hello there";<\/script>/);
  assert.equal(out.replace(/<html lang="es">[\s\S]*$/, ""), PAGE.replace(/<html lang="en">[\s\S]*$/, ""));
});

test("a windows-1252 page comes back in windows-1252, with characters it cannot hold written as references", () => {
  const html = `<html><head><meta charset="windows-1252"><title>Café</title></head><body><p>Café menu</p></body></html>`;
  const bytes = Uint8Array.from([...html].map((c) => c.charCodeAt(0)));
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": bytes });
  const page = ex.files.find((f) => f.path === "index.html")!;
  assert.deepEqual(page.rebuild(new Map()), bytes);
  const unit = page.units.find((u) => plainText(u.items) === "Café menu")!;
  const out = page.rebuild(new Map([[unit.id, [{ kind: "t", text: "Меню é" }]]]));
  const text = String.fromCharCode(...out);
  assert.match(text, /<p>&#1052;&#1077;&#1085;&#1102; é<\/p>/);
  assert.match(text, /<title>Café<\/title>/);
});

test("captions and the manifest's titles are found and put back", () => {
  const vtt = "WEBVTT\n\n1\n00:00.000 --> 00:02.000\n<v Ana>Hello, <i>everyone</i>.\nWelcome.\n\n00:02.000 --> 00:03.000\n42\n";
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": "<p>x y</p>", "captions/en.vtt": vtt });
  const cues = ex.files.find((f) => f.path === "captions/en.vtt")!;
  assert.deepEqual(cues.units.map((u) => plainText(u.items)), ["Hello, everyone. Welcome."]);
  const u = cues.units[0]!;
  const tags = u.items.filter((i) => i.kind !== "t");
  const out = dec.decode(cues.rebuild(new Map([[u.id, [tags[0]!, { kind: "t", text: "Hola a " }, tags[1]!, { kind: "t", text: "todos" }, tags[2]!, { kind: "t", text: ".\nBienvenidos." }]]])));
  assert.equal(out, "WEBVTT\n\n1\n00:00.000 --> 00:02.000\n<v Ana>Hola a <i>todos</i>.\nBienvenidos.\n\n00:02.000 --> 00:03.000\n42\n");
  const manifest = ex.files.find((f) => f.path === "imsmanifest.xml")!;
  assert.deepEqual(manifest.units.map((x) => plainText(x.items)), ["Test course", "Lesson one"]);
  const t2 = extracted({ "tincan.xml": tincan(), "index.html": "<p>Hi there</p>" }).ex;
  assert.deepEqual(t2.files.find((f) => f.path === "tincan.xml")!.units.map((x) => plainText(x.items)), ["Test xAPI course", "d"].filter((s) => /\p{L}/u.test(s)));
});

test("what is not reached is said: scripts and data, documents, Flash", () => {
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": "<p>Words here</p>", "data.js": "x", "slides.json": "{}", "guide.pdf": "%PDF", "old.swf": "F" });
  assert.equal(ex.notReached.length, 3);
  assert.match(ex.notReached[0]!, /^2 script and data files/);
  assert.match(ex.notReached[1]!, /Replace a file/);
});

test("XLIFF out and back: a translation goes back, a changed tag or a changed source is kept out and said why", () => {
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": PAGE });
  const xlf = writeXliff("course.zip", ex, "en", "es", { pseudo: true });
  assert.match(xlf, /<xliff version="1\.2" xmlns="urn:oasis:names:tc:xliff:document:1\.2">/);
  assert.match(xlf, /<bpt id="1" rid="1" ctype="bold">&lt;b&gt;<\/bpt>/);
  assert.match(xlf, /ctype="link">&lt;a href="next.html" title="Go to the next part"&gt;<\/bpt>/);
  assert.throws(() => writeXliff("c", ex, "en", "EN"), /already in en/);
  assert.throws(() => writeXliff("c", ex, "en", "Spanish"), /not a language tag/);

  const units = ex.files.flatMap((f) => f.units);
  const read = readXliff(xlf);
  assert.equal(read.targetLanguage, "es");
  const all = matchTranslations(units, read.units);
  assert.equal(all.translated, units.length);
  assert.deepEqual(all.kept, []);

  // A translator who drops the bold and one who edits the source.
  const para = units.find((u) => plainText(u.items).startsWith("Read"))!;
  const heading = units.find((u) => plainText(u.items) === "Listening well")!;
  const broken = new Map(read.units);
  broken.set(para.id, { ...broken.get(para.id)!, target: [{ kind: "t", text: "Lee cada parte y sigue." }] });
  broken.set(heading.id, { ...broken.get(heading.id)!, source: [{ kind: "t", text: "Something else" }] });
  const m = matchTranslations(units, broken);
  assert.equal(m.translated, units.length - 2);
  assert.match(m.kept.find((k) => k.id === para.id)!.why, /the tags were changed \(lost <b>, <\/b>/);
  assert.match(m.kept.find((k) => k.id === heading.id)!.why, /source no longer matches/);

  // Applied: the page changes, the manifest's titles too, and the page's language is set.
  const applied = applyTranslations(ex, m.translations, "es");
  assert.equal(applied.changed, 2);
  const page = dec.decode(applied.files.get("index.html")!);
  assert.match(page, /<html lang="es">/);
  assert.match(page, /<h1>Listening well<\/h1>/, "the unit whose source changed stays as it was");
  assert.match(page, /<title>⟦Léssöñ~~ öñé⟧<\/title>/, "the pseudo-translation is in");
});

test("a pseudo-translation keeps the tags and placeholders and makes the words longer", () => {
  const items: Item[] = [{ kind: "t", text: "You scored {{$score}} of {1}, " }, { kind: "open", literal: "<b>", id: 1, pair: 1 }, { kind: "t", text: "well done" }, { kind: "close", literal: "</b>", id: 2, pair: 1 }];
  const p = pseudoItems(items);
  assert.equal(p.filter((i) => i.kind !== "t").length, 2);
  const words = plainText(p);
  assert.match(words, /\{\{\$score\}\}/);
  assert.match(words, /\{1\}/);
  assert.ok(words.length > plainText(items).length);
});

test("the Word table: markers stand for the tags, and a filled-in table comes back as translations", () => {
  const { ex } = extracted({ "imsmanifest.xml": scorm12(), "index.html": PAGE });
  const units = ex.files.flatMap((f) => f.units);
  const para = units.find((u) => plainText(u.items).startsWith("Read"))!;
  assert.equal(markedText(para.items), "Read [[1]]each[[/1]] part, then [[3]]continue[[/3]].");
  const docx = writeDocxTable("course.zip", ex, "en", "fr");
  // A translator fills in two rows in Word: one keeps the markers, one loses a marker.
  const files = unzipSync(docx);
  let xml = strFromU8(files["word/document.xml"]!);
  const heading = units.find((u) => plainText(u.items) === "Listening well")!;
  const fill = (id: string, text: string) => {
    const row = xml.indexOf(`>${id}<`);
    const empty = '<w:t xml:space="preserve"></w:t>';
    const at = xml.indexOf(empty, row);
    xml = xml.slice(0, at) + `<w:t xml:space="preserve">${text}</w:t>` + xml.slice(at + empty.length);
  };
  fill(para.id, "Lisez [[1]]chaque[[/1]] partie, puis [[3]]continuez[[/3]].");
  fill(heading.id, "Bien écouter");
  const translated = zipSync({ ...files, "word/document.xml": strToU8(xml) });
  const table = readDocxTable(translated);
  assert.equal(table.targetLanguage, "fr");
  assert.equal(table.rows.size, 2);
  const read = new Map([...table.rows].map(([id, text]) => {
    const u = units.find((x) => x.id === id)!;
    return [id, { source: u.items, target: itemsFromMarked(text, u.items) }];
  }));
  const m = matchTranslations(units, read);
  assert.equal(m.translated, 2);
  const page = dec.decode(applyTranslations(ex, m.translations, "fr").files.get("index.html")!);
  assert.match(page, /<p>Lisez <b>chaque<\/b> partie, puis <a href="next.html" title="Go to the next part">continuez<\/a>\.<\/p>/);
  assert.match(page, /<h1>Bien écouter<\/h1>/);
  // A lost marker is caught.
  const lost = matchTranslations(units, new Map([[para.id, { source: para.items, target: itemsFromMarked("Lisez chaque partie, puis [[3]]continuez[[/3]].", para.items) }]]));
  assert.match(lost.kept[0]!.why, /the tags were changed/);
  assert.throws(() => readDocxTable(strToU8("not a zip")), /not a Word document/);
});
