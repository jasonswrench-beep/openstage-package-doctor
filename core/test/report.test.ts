import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportText } from "../src/report.ts";
import { checksDoc, DOC_PATH } from "../tools/make-checks-doc.ts";
import { RULES } from "../src/findings.ts";
import { makeZip, open, PAGE, scorm12 } from "./helpers.ts";

test("the text report: verdict, counts, each finding with what to do, tracking, outline, limits", () => {
  const text = reportText(open({ "imsmanifest.xml": scorm12() }, "lesson.zip"));
  assert.match(text, /^OpenStage Package Doctor report: lesson\.zip\n\n1 problem will probably stop/);
  assert.match(text, /Problem: A start page is not in the package \[scorm-launch-missing\]\n {4}"Lesson one" starts at index\.html/);
  assert.match(text, /What to do: The course will not open/);
  assert.match(text, /Tracking settings\n {2}Lesson one: Passing score: 80 \(adlcp:masteryscore\)/);
  assert.match(text, /Outline\n {2}- Test course\n {4}- Lesson one \(opens index\.html\)/);
  assert.match(text, /Not checked\n {2}Links that a course's scripts build/);
});

test("the command line: text, JSON and exit codes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pd-"));
  const good = join(dir, "good.zip");
  const bad = join(dir, "bad.zip");
  writeFileSync(good, makeZip([{ name: "imsmanifest.xml", data: scorm12() }, { name: "index.html", data: PAGE }]));
  writeFileSync(bad, makeZip([{ name: "imsmanifest.xml", data: scorm12() }]));
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  const ok = run(good);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /No problems found/);
  const problem = run(bad, "--json");
  assert.equal(problem.status, 1);
  assert.equal(JSON.parse(problem.stdout).kind, "scorm12");
  assert.equal(run(join(dir, "nothing.zip")).status, 2);
  assert.equal(run().status, 2);
});

test("docs/checks.md lists every finding and is up to date", () => {
  const doc = readFileSync(DOC_PATH, "utf8");
  assert.equal(doc, checksDoc(), "docs/checks.md is out of date: run `npm run docs` in core/");
  for (const id of Object.keys(RULES)) assert.ok(doc.includes(`\`${id}\``), id);
});
