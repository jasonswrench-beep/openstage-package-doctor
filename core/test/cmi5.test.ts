import { test } from "node:test";
import assert from "node:assert/strict";
import { cmi5, ids, open, PAGE, scorm12, tincan } from "./helpers.ts";

test("a sound cmi5 package", () => {
  const r = open({ "cmi5.xml": cmi5(), "index.html": PAGE });
  assert.equal(r.kind, "cmi5");
  assert.equal(r.kindLabel, "cmi5");
  assert.equal(r.title, "Test cmi5 course");
  assert.equal(r.identifier, "https://example.org/course/1");
  assert.deepEqual(r.launches.map((l) => l.file), ["index.html"]);
  assert.deepEqual(ids(r, "problem"), []);
  assert.deepEqual(ids(r, "warning"), []);
  const t = Object.fromEntries(r.tracking.map((s) => [s.name, s.value]));
  assert.equal(t["To move on"], "The learner must complete it or pass");
  assert.equal(t["Passing score"], "0.8 (80 percent)");
  assert.equal(t["Opens in"], "Its own window");
});

test("cmi5 blocks nest AUs in the outline", () => {
  const au = `<block id="https://example.org/block/1"><title><langstring lang="en">Unit</langstring></title>
    <au id="https://example.org/au/1"><title><langstring lang="en">A</langstring></title><url>a.html</url></au>
    <au id="https://example.org/au/2"><title><langstring lang="en">B</langstring></title><url>b.html?x=1</url></au></block>`;
  const r = open({ "cmi5.xml": cmi5(au), "a.html": PAGE, "b.html": PAGE });
  assert.equal(r.outline[0]!.kind, "block");
  assert.deepEqual(r.outline[0]!.children.map((c) => c.title), ["A", "B"]);
  assert.deepEqual(ids(r, "problem"), []);
});

test("cmi5 values cmi5 does not allow", () => {
  const au = `<au id="lesson-1" moveOn="Finished" masteryScore="80" launchMethod="NewTab"><title><langstring lang="en">A</langstring></title><url>missing.html</url></au>`;
  const r = open({ "cmi5.xml": cmi5(au) });
  for (const id of ["cmi5-id", "cmi5-moveon", "cmi5-mastery", "cmi5-launchmethod", "cmi5-launch-missing"]) assert.ok(ids(r, "problem").includes(id), id);
});

test("cmi5: no AU, an AU with no URL, a duplicate id, the wrong namespace, capitals", () => {
  assert.ok(ids(open({ "cmi5.xml": cmi5("") })).includes("cmi5-no-au"));
  assert.ok(ids(open({ "cmi5.xml": cmi5(`<au id="https://e.org/a"><title><langstring>A</langstring></title></au>`) })).includes("cmi5-no-url"));
  const dup = `<au id="https://example.org/course/1"><title><langstring>A</langstring></title><url>index.html</url></au>`;
  assert.ok(ids(open({ "cmi5.xml": cmi5(dup), "index.html": PAGE })).includes("cmi5-duplicate-id"));
  assert.ok(ids(open({ "cmi5.xml": cmi5().replace(/ xmlns="[^"]*"/, ""), "index.html": PAGE }), "warning").includes("cmi5-namespace"));
  assert.ok(ids(open({ "cmi5.xml": cmi5(), "INDEX.html": PAGE }), "problem").includes("cmi5-launch-case"));
});

test("a sound xAPI package", () => {
  const r = open({ "tincan.xml": tincan(), "index.html": PAGE });
  assert.equal(r.kind, "xapi");
  assert.equal(r.kindLabel, "xAPI (tincan.xml)");
  assert.equal(r.title, "Test xAPI course");
  assert.deepEqual(r.launches.map((l) => l.file), ["index.html"]);
  assert.deepEqual(ids(r, "problem"), []);
  assert.deepEqual(ids(r, "warning"), []);
  assert.equal(r.tracking.find((t) => t.name === "Activity id")!.value, "https://example.org/course/1");
});

test("xAPI: no activity, no launch, a missing start page, an id that is not an address", () => {
  assert.ok(ids(open({ "tincan.xml": tincan("") })).includes("xapi-no-activity"));
  assert.ok(ids(open({ "tincan.xml": tincan(`<activity id="https://e.org/1"><name>x</name></activity>`) })).includes("xapi-no-launch"));
  assert.ok(ids(open({ "tincan.xml": tincan() })).includes("xapi-launch-missing"));
  assert.ok(ids(open({ "tincan.xml": tincan().replace("https://example.org/course/1", "course1"), "index.html": PAGE }), "warning").includes("xapi-id"));
});

test("several kinds of manifest: imsmanifest.xml is read, the others noted", () => {
  const r = open({ "imsmanifest.xml": scorm12(), "tincan.xml": tincan(), "index.html": PAGE });
  assert.equal(r.kind, "scorm12");
  assert.ok(ids(r, "note").includes("manifest-several"));
});
