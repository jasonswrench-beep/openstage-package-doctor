import { test } from "node:test";
import assert from "node:assert/strict";
import { ZipArchive, ZipError } from "../src/zip.ts";
import { openPackage } from "../src/open.ts";
import { ids, makeZip, PAGE, scorm12 } from "./helpers.ts";

test("lists entries and reads stored and deflated files", () => {
  const zip = new ZipArchive(makeZip([
    { name: "a.txt", data: "stored text" },
    { name: "folder/b.txt", data: "deflated text ".repeat(50), method: 8 },
    { name: "folder/" },
  ]));
  assert.equal(zip.entries.length, 3);
  const [a, b, dir] = zip.entries;
  assert.equal(new TextDecoder().decode(zip.read(a!)), "stored text");
  assert.equal(new TextDecoder().decode(zip.read(b!)), "deflated text ".repeat(50));
  assert.ok(b!.packedSize < b!.size);
  assert.equal(dir!.isDirectory, true);
});

test("a wrong checksum is reported as damage", () => {
  const zip = new ZipArchive(makeZip([{ name: "a.txt", data: "x", wrongCrc: true }]));
  assert.throws(() => zip.read(zip.entries[0]!), ZipError);
});

test("a file that is not a zip, and a zip cut short", () => {
  assert.throws(() => new ZipArchive(new TextEncoder().encode("just some text, not a zip at all")), (e: ZipError) => e.code === "not-a-zip");
  const whole = makeZip([{ name: "a.txt", data: "hello" }]);
  assert.throws(() => new ZipArchive(whole.subarray(0, whole.length - 30)), (e: ZipError) => e.code === "damaged");
});

test("names: backslashes become slashes in the path, the raw name is kept, and the UTF-8 marker is read", () => {
  const latin = new Uint8Array([0x63, 0x61, 0x66, 0x82, 0x2e, 0x68, 0x74, 0x6d]); // "café.htm" in code page 437
  const zip = new ZipArchive(makeZip([
    { name: "images\\logo.png", data: "x" },
    { name: "résumé.html", data: "x", utf8Flag: true },
    { name: "", nameBytes: latin, data: "x" },
  ]));
  assert.equal(zip.entries[0]!.path, "images/logo.png");
  assert.equal(zip.entries[0]!.rawName, "images\\logo.png");
  assert.equal(zip.entries[1]!.path, "résumé.html");
  assert.equal(zip.entries[1]!.utf8Name, true);
  assert.equal(zip.entries[2]!.path, "café.htm");
  assert.equal(zip.entries[2]!.nonAsciiName, true);
  assert.equal(zip.entries[2]!.utf8Name, false);
});

const good = [
  { name: "imsmanifest.xml", data: scorm12(), method: 8 },
  { name: "index.html", data: PAGE, method: 8 },
];

test("zip problems an LMS would refuse", () => {
  assert.deepEqual(ids(openPackage(new TextEncoder().encode("not a zip"), "x.zip")), ["zip-unreadable"]);
  assert.deepEqual(ids(openPackage(makeZip([]), "x.zip")), ["zip-empty"]);
  assert.ok(ids(openPackage(makeZip([...good, { name: "secret.html", data: "x", encrypted: true }]), "x.zip")).includes("zip-encrypted"));
  assert.ok(ids(openPackage(makeZip([...good, { name: "big.bin", data: "x", method: 12 }]), "x.zip")).includes("zip-method"));
  assert.ok(ids(openPackage(makeZip([...good, { name: "images\\a.png", data: "x" }]), "x.zip")).includes("zip-backslash"));
  assert.ok(ids(openPackage(makeZip([...good, { name: "../evil.html", data: "x" }]), "x.zip")).includes("zip-unsafe-path"));
  assert.ok(ids(openPackage(makeZip([...good, { name: "index.html", data: PAGE }]), "x.zip")).includes("zip-duplicate"));
  assert.ok(ids(openPackage(makeZip([good[0]!, { name: "index.html", data: PAGE, wrongCrc: true }]), "x.zip")).includes("zip-damaged"));
  assert.ok(ids(openPackage(makeZip([{ name: "imsmanifest.xml", data: scorm12(), wrongCrc: true }, good[1]!]), "x.zip")).includes("zip-damaged"));
});

test("harmless leftovers and nested zips are notes", () => {
  const r = openPackage(makeZip([...good, { name: "__MACOSX/._index.html", data: "x" }, { name: ".DS_Store", data: "x" }, { name: "extra/other.zip", data: "x" }]), "x.zip");
  assert.equal(r.findings.find((f) => f.id === "zip-junk")?.severity, "note");
  assert.equal(r.findings.find((f) => f.id === "zip-nested")?.severity, "note");
  assert.deepEqual(ids(r, "problem"), []);
});

test("names stored without the UTF-8 marker are a warning; marked ones are not", () => {
  const cp437 = new Uint8Array([0x63, 0x61, 0x66, 0x82, 0x2e, 0x70, 0x6e, 0x67]);
  assert.ok(ids(openPackage(makeZip([...good, { name: "", nameBytes: cp437, data: "x" }]), "x.zip"), "warning").includes("zip-name-encoding"));
  assert.ok(!ids(openPackage(makeZip([...good, { name: "café.png", data: "x", utf8Flag: true }]), "x.zip")).includes("zip-name-encoding"));
});

test("sizes and totals", () => {
  const r = openPackage(makeZip(good), "x.zip");
  assert.equal(r.totals.files, 2);
  assert.equal(r.totals.size, scorm12().length + PAGE.length);
  assert.ok(r.findings.some((f) => f.id === "zip-size" && f.severity === "note"));
});
