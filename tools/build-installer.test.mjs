// SPDX-License-Identifier: Apache-2.0
// The parts of tools/build-installer.mjs that decide whether a build may be signed and what it may carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderFlags, namingUserFolder, notTagged, versions, webviewMode } from "./build-installer.mjs";

test("the version is the same in tauri.conf.json, Cargo.toml and both package.json files", () => {
  const found = Object.values(versions());
  assert.equal(found.length, 4);
  assert.ok(found[0], "tauri.conf.json has a version");
  for (const v of found) assert.equal(v, found[0]);
});

test("a signed build needs a clean tree and HEAD on the release tag", () => {
  const clean = { ok: true, out: "" };
  assert.equal(notTagged("v0.6.0", clean, { ok: true, out: "v0.6.0" }), null);
  assert.match(notTagged("v0.6.0", { ok: true, out: "?? handoff/" }, { ok: true, out: "v0.6.0" }), /uncommitted or untracked/);
  assert.match(notTagged("v0.6.0", { ok: true, out: " M CLAUDE.md" }, { ok: true, out: "v0.6.0" }), /CLAUDE\.md/);
  assert.match(notTagged("v0.6.0", clean, { ok: false, out: "" }), /not tagged v0\.6\.0/);
  assert.match(notTagged("v0.6.0", clean, { ok: true, out: "v0.5.0" }), /it is tagged v0\.5\.0/);
  assert.match(notTagged("v0.6.0", { ok: false, out: "" }, { ok: true, out: "v0.6.0" }), /could not say/);
});

test("the web view's setup must be carried in the installer, not downloaded", () => {
  const script = '!if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"\n!endif\n!define INSTALLWEBVIEW2MODE "embedBootstrapper"\n';
  assert.equal(webviewMode(script), "embedBootstrapper");
  assert.equal(webviewMode('!define INSTALLWEBVIEW2MODE "downloadBootstrapper"\n'), "downloadBootstrapper");
  assert.equal(webviewMode("nothing here"), null);
});

test("Rust is told to leave out the user folder, Rust's folders and this repository, broadest first", () => {
  const flags = folderFlags("C:\\Users\\someone", {}, "C:\\Dev\\Package Doctor");
  assert.deepEqual(flags, [
    "--remap-path-prefix=C:\\Users\\someone=/home",
    "--remap-path-prefix=C:\\Users\\someone\\.cargo=/cargo",
    "--remap-path-prefix=C:\\Users\\someone\\.rustup=/rustup",
    "--remap-path-prefix=C:\\Dev\\Package Doctor=/openstage-package-doctor",
    "-Clink-arg=/PDBALTPATH:%_PDB%",
  ]);
});

test("a program that names the user folder is found, as text or UTF-16, with either slash", () => {
  const work = mkdtempSync(join(tmpdir(), "pd-build-test-"));
  try {
    const plain = join(work, "a.exe");
    const wide = join(work, "b.dll");
    const slash = join(work, "c.exe");
    const clean = join(work, "d.exe");
    writeFileSync(plain, "panic at C:\\Users\\Someone\\.cargo\\x.rs");
    writeFileSync(wide, Buffer.from("C:\\USERS\\SOMEONE\\file", "utf16le"));
    writeFileSync(slash, "c:/users/someone/src");
    writeFileSync(clean, "/cargo/registry/x.rs");
    assert.deepEqual(namingUserFolder([plain, wide, slash, clean], "C:\\Users\\someone"), [plain, wide, slash]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
