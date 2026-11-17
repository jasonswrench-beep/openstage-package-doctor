import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, PAGE, scorm12 } from "./helpers.ts";
import { openPackageSession } from "../src/open.ts";
import { writePackage } from "../src/write.ts";
import { ZipArchive } from "../src/zip.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function opened(entries: Parameters<typeof makeZip>[0]) {
  const { report, archive } = openPackageSession(makeZip(entries), "test.zip");
  return { report, archive: archive! };
}

test("a replaced file comes back with its new content, and every other file is copied exactly", () => {
  const { archive } = opened([
    { name: "imsmanifest.xml", data: scorm12(), method: 8 },
    { name: "index.html", data: PAGE },
    { name: "images/", data: "" },
    { name: "images/photo.jpg", data: "old picture bytes" },
    { name: "notes/résumé.txt", data: "café", utf8Flag: true },
  ]);
  const { bytes } = writePackage(archive, new Map([["images/photo.jpg", enc.encode("new, smaller picture")]]));
  const again = new ZipArchive(bytes);
  assert.deepEqual(again.entries.map((e) => e.path), archive.entries.map((e) => e.path));
  const byPath = new Map(again.entries.map((e) => [e.path, e]));
  assert.equal(dec.decode(again.read(byPath.get("images/photo.jpg")!)), "new, smaller picture");
  assert.equal(byPath.get("images/photo.jpg")!.method, 0, "a picture is stored, not deflated again");
  for (const name of ["imsmanifest.xml", "index.html", "notes/résumé.txt"]) {
    const before = archive.entries.find((e) => e.path === name)!;
    const after = byPath.get(name)!;
    assert.deepEqual(again.packed(after), archive.packed(before), `${name} is copied as it was stored`);
    assert.equal(after.crc32, before.crc32);
    assert.equal(after.dosDate, before.dosDate);
  }
  assert.equal(byPath.get("notes/résumé.txt")!.utf8Name, true);
  assert.equal(byPath.get("images/")!.isDirectory, true);
  // The new zip opens as a package with no new findings.
  const { report } = openPackageSession(bytes, "new.zip");
  assert.equal(report.kind, "scorm12");
  assert.deepEqual(report.findings.filter((f) => f.severity !== "note").map((f) => f.id), []);
});

test("a replaced page is deflated when that makes it smaller", () => {
  const { archive } = opened([{ name: "imsmanifest.xml", data: scorm12() }, { name: "index.html", data: PAGE }]);
  const page = enc.encode(PAGE.repeat(50));
  const { bytes } = writePackage(archive, new Map([["index.html", page]]));
  const again = new ZipArchive(bytes);
  const entry = again.entries.find((e) => e.path === "index.html")!;
  assert.equal(entry.method, 8);
  assert.ok(entry.packedSize < page.length / 5);
  assert.deepEqual(again.read(entry), page);
});

test("packing text again shrinks stored pages and scripts and leaves pictures alone", () => {
  const script = "function hello() { return 'hello'; }\n".repeat(200);
  const { archive } = opened([
    { name: "imsmanifest.xml", data: scorm12() },
    { name: "index.html", data: PAGE.repeat(20) },
    { name: "app.js", data: script },
    { name: "logo.png", data: "png bytes ".repeat(100) },
  ]);
  const { bytes, repacked } = writePackage(archive, new Map(), { repackText: true });
  assert.deepEqual(repacked.map((r) => r.path).sort(), ["app.js", "imsmanifest.xml", "index.html"]);
  assert.ok(repacked.every((r) => r.after < r.before));
  const again = new ZipArchive(bytes);
  assert.equal(dec.decode(again.read(again.entries.find((e) => e.path === "app.js")!)), script);
  assert.equal(again.entries.find((e) => e.path === "logo.png")!.method, 0);
  assert.ok(bytes.length < archive.byteLength);
});

test("a password-protected file is copied, still protected", () => {
  const { archive } = opened([{ name: "imsmanifest.xml", data: scorm12() }, { name: "index.html", data: PAGE }, { name: "secret.bin", data: "xxxx", encrypted: true }]);
  const again = new ZipArchive(writePackage(archive, new Map(), { repackText: true }).bytes);
  assert.equal(again.entries.find((e) => e.path === "secret.bin")!.encrypted, true);
});
