import { test } from "node:test";
import assert from "node:assert/strict";
import { ids, open, PAGE, scorm12, scorm2004 } from "./helpers.ts";
import { verdict } from "../src/open.ts";

test("a sound SCORM 1.2 package: kind, title, start page, tracking, no problems or warnings", () => {
  const r = open({ "imsmanifest.xml": scorm12(), "index.html": PAGE });
  assert.equal(r.kind, "scorm12");
  assert.equal(r.kindLabel, "SCORM 1.2");
  assert.equal(r.title, "Test course");
  assert.equal(r.identifier, "M1");
  assert.equal(r.manifest, "imsmanifest.xml");
  assert.deepEqual(r.launches, [{ title: "Lesson one", from: "item I1", href: "index.html", file: "index.html", tracked: true }]);
  assert.deepEqual(r.tracking.map((t) => [t.scope, t.name, t.value]), [["Lesson one", "Passing score", "80"]]);
  assert.deepEqual(ids(r, "problem"), []);
  assert.deepEqual(ids(r, "warning"), []);
  assert.equal(verdict(r), "No problems found. The package should import and launch.");
  assert.equal(r.outline[0]!.children[0]!.launches, "index.html");
});

test("SCORM 1.2 tracking settings in words", () => {
  const item = `<item identifier="I1" identifierref="R1"><title>Timed</title>
    <adlcp:maxtimeallowed>00:30:00</adlcp:maxtimeallowed><adlcp:timelimitaction>exit,message</adlcp:timelimitaction>
    <adlcp:datafromlms>mode=review</adlcp:datafromlms><adlcp:prerequisites type="aicc_script">I0</adlcp:prerequisites></item>`;
  const r = open({ "imsmanifest.xml": scorm12({ item }), "index.html": PAGE });
  assert.deepEqual(r.tracking.map((t) => [t.name, t.value]), [
    ["Time allowed", "00:30:00"],
    ["When time runs out", "Leave the course and show a message"],
    ["Start-up data", "mode=review"],
    ["Prerequisites", "I0"],
  ]);
});

test("a sound SCORM 2004 4th Edition package, and its sequencing in words", () => {
  const r = open({ "imsmanifest.xml": scorm2004(), "index.html": PAGE });
  assert.equal(r.kind, "scorm2004");
  assert.equal(r.kindLabel, "SCORM 2004 4th Edition");
  assert.deepEqual(ids(r, "problem"), []);
  assert.deepEqual(ids(r, "warning"), []);
  const t = Object.fromEntries(r.tracking.map((s) => [`${s.scope}: ${s.name}`, s.value]));
  assert.equal(t["Course: Learners pick from the menu"], "Yes");
  assert.equal(t["Course: Next and Previous"], "Yes");
  assert.equal(t["Course: Objectives shared with other courses"], "No");
  assert.equal(t["Lesson one: Completion threshold"], "0.75 (75 percent)");
  assert.equal(t["Lesson one: Completion set by the course"], "Yes");
  assert.equal(t["Lesson one: Passing score"], "0.8 (80 percent)");
  assert.equal(t["Lesson one: Attempts allowed"], "3");
  assert.equal(t["Lesson one: LMS buttons hidden"], "continue, previous");
});

test("SCORM editions from schemaversion", () => {
  const label = (sv: string) => open({ "imsmanifest.xml": scorm2004().replace("2004 4th Edition", sv), "index.html": PAGE }).kindLabel;
  assert.equal(label("CAM 1.3"), "SCORM 2004 2nd Edition");
  assert.equal(label("2004 3rd Edition"), "SCORM 2004 3rd Edition");
  const unstated = open({ "imsmanifest.xml": scorm2004().replace("<schemaversion>2004 4th Edition</schemaversion>", ""), "index.html": PAGE });
  assert.equal(unstated.kindLabel, "SCORM 2004");
  assert.ok(ids(unstated, "warning").includes("scorm-version-unknown"));
});

test("1.2 version with 2004 namespaces is a mismatch", () => {
  const r = open({ "imsmanifest.xml": scorm2004().replace("2004 4th Edition", "1.2"), "index.html": PAGE });
  assert.ok(ids(r).includes("scorm-namespace-mismatch"));
});

test("the start page: missing, and capitals only", () => {
  assert.ok(ids(open({ "imsmanifest.xml": scorm12() }), "problem").includes("scorm-launch-missing"));
  const caps = open({ "imsmanifest.xml": scorm12(), "Index.html": PAGE });
  assert.ok(ids(caps, "problem").includes("scorm-launch-case"));
  assert.equal(caps.launches[0]!.file, "Index.html");
});

test("the outline: no organization, a missing default, a reference to nothing, a leaf with no reference", () => {
  const none = scorm12().replace(/<organizations[\s\S]*<\/organizations>/, "<organizations/>");
  assert.ok(ids(open({ "imsmanifest.xml": none, "index.html": PAGE })).includes("scorm-no-organization"));
  assert.ok(ids(open({ "imsmanifest.xml": scorm12().replace('default="ORG1"', 'default="NOPE"'), "index.html": PAGE })).includes("scorm-default-missing"));
  assert.ok(ids(open({ "imsmanifest.xml": scorm12({ item: `<item identifier="I1" identifierref="R9"><title>x</title></item>` }), "index.html": PAGE })).includes("scorm-item-ref-missing"));
  assert.ok(ids(open({ "imsmanifest.xml": scorm12({ item: `<item identifier="I1"><title>x</title></item>` }), "index.html": PAGE })).includes("scorm-item-no-ref"));
});

test("identifiers must be unique", () => {
  const r = open({ "imsmanifest.xml": scorm12({ extra: `<resource identifier="R1" type="webcontent" adlcp:scormtype="asset" href="other.html"/>` }), "index.html": PAGE });
  const f = r.findings.find((x) => x.id === "scorm-duplicate-id");
  assert.ok(f);
  assert.match(f.detail, /"R1" is used on line \d+ and again on line \d+/);
});

test("the SCORM type: missing, spelled for the other version, and an asset that is launched", () => {
  const missing = open({ "imsmanifest.xml": scorm12({ resource: `<resource identifier="R1" type="webcontent" href="index.html"/>` }), "index.html": PAGE });
  assert.ok(ids(missing, "warning").includes("scorm-type-missing"));
  const camel = open({ "imsmanifest.xml": scorm12({ resource: `<resource identifier="R1" type="webcontent" adlcp:scormType="sco" href="index.html"/>` }), "index.html": PAGE });
  assert.ok(ids(camel, "warning").includes("scorm-type-case"));
  assert.equal(camel.launches[0]!.tracked, true);
  const lower2004 = open({ "imsmanifest.xml": scorm2004({ resource: `<resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="index.html"/>` }), "index.html": PAGE });
  assert.ok(ids(lower2004, "warning").includes("scorm-type-case"));
  const asset = open({ "imsmanifest.xml": scorm12({ resource: `<resource identifier="R1" type="webcontent" adlcp:scormtype="asset" href="index.html"/>` }), "index.html": PAGE });
  assert.ok(ids(asset, "note").includes("scorm-asset-launched"));
  assert.equal(asset.launches[0]!.tracked, false);
});

test("listed files that are missing, and dependencies on nothing", () => {
  const r = open({
    "imsmanifest.xml": scorm12({ resource: `<resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/><file href="gone.js"/><file href="Pic.png"/><dependency identifierref="SHARED"/></resource>` }),
    "index.html": PAGE,
    "pic.png": "x",
  });
  const f = r.findings.find((x) => x.id === "scorm-file-missing")!;
  assert.match(f.detail, /2 files.*gone\.js, Pic\.png \(the package has pic\.png\)/);
  assert.ok(ids(r).includes("scorm-dependency-missing"));
});

test("xml:base moves where files are looked for", () => {
  const resource = `<resource identifier="R1" type="webcontent" adlcp:scormtype="sco" xml:base="lesson/" href="start.html"><file href="start.html"/></resource>`;
  const r = open({ "imsmanifest.xml": scorm12({ resource }), "lesson/start.html": PAGE });
  assert.equal(r.launches[0]!.file, "lesson/start.html");
  assert.deepEqual(ids(r, "problem"), []);
});

test("parameters are kept on the start address, and pages on another website are notes", () => {
  const item = `<item identifier="I1" identifierref="R1" parameters="?page=2"><title>x</title></item>`;
  assert.equal(open({ "imsmanifest.xml": scorm12({ item }), "index.html": PAGE }).launches[0]!.href, "index.html?page=2");
  const remote = open({ "imsmanifest.xml": scorm12({ resource: `<resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="https://example.org/course/"/>` }) });
  assert.ok(ids(remote, "note").includes("scorm-remote-launch"));
  assert.deepEqual(ids(remote, "problem"), []);
});

test("a passing score out of range", () => {
  const item = `<item identifier="I1" identifierref="R1"><title>x</title><adlcp:masteryscore>0.8</adlcp:masteryscore></item>`;
  assert.ok(!ids(open({ "imsmanifest.xml": scorm12({ item }), "index.html": PAGE })).includes("scorm-mastery-range"));
  const high = item.replace("0.8", "180");
  assert.ok(ids(open({ "imsmanifest.xml": scorm12({ item: high }), "index.html": PAGE })).includes("scorm-mastery-range"));
});

test("a package with several tracked parts", () => {
  const item = `<item identifier="I1" identifierref="R1"><title>One</title></item><item identifier="I2" identifierref="R2"><title>Two</title></item>`;
  const extra = `<resource identifier="R2" type="webcontent" adlcp:scormtype="sco" href="two.html"/>`;
  const r = open({ "imsmanifest.xml": scorm12({ item, extra }), "index.html": PAGE, "two.html": PAGE });
  assert.equal(r.launches.length, 2);
  assert.ok(ids(r, "note").includes("scorm-several-scos"));
});

test("the manifest in a folder, with the wrong capitals, or missing", () => {
  const nested = open({ "My Course/imsmanifest.xml": scorm12(), "My Course/index.html": PAGE });
  assert.ok(ids(nested, "problem").includes("manifest-in-folder"));
  assert.equal(nested.root, "My Course/");
  assert.equal(nested.launches[0]!.file, "My Course/index.html");
  assert.ok(ids(open({ "IMSManifest.xml": scorm12(), "index.html": PAGE }), "problem").includes("manifest-name-case"));
  const none = open({ "index.html": PAGE });
  assert.deepEqual(ids(none, "problem"), ["manifest-missing"]);
  assert.equal(verdict(none), "This is not a course package Package Doctor can open.");
});

test("a manifest that is not valid XML says where", () => {
  const r = open({ "imsmanifest.xml": scorm12().replace("</organization>", ""), "index.html": PAGE });
  const f = r.findings.find((x) => x.id === "xml-malformed")!;
  assert.equal(f.severity, "problem");
  assert.ok(f.line && f.line > 5);
  assert.match(f.detail, /^Line \d+, column \d+: <\/organizations> is here, but the open tag is <organization>/);
});

test("an IMS content package that is not a course: a Brightspace question library", () => {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_1" xmlns:d2l_2p0="http://desire2learn.com/xsd/d2lcp_v2p0" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources><resource identifier="res_question_library" type="webcontent" d2l_2p0:material_type="d2lquestionlibrary" href="questiondb.xml" /></resources>
</manifest>`;
  const r = open({ "imsmanifest.xml": manifest, "questiondb.xml": "<questestinterop/>" });
  assert.equal(r.kind, "content-package");
  const f = r.findings.find((x) => x.id === "not-a-course")!;
  assert.match(f.detail, /question library exported from Brightspace/);
  assert.equal(verdict(r), "This is an IMS content package, not a SCORM, xAPI or cmi5 course.");
});

test("files the manifest does not list are counted in a note; schema files it names are a note", () => {
  const withSchema = scorm12().replace('identifier="M1"', 'identifier="M1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd"');
  const r = open({ "imsmanifest.xml": withSchema, "index.html": PAGE, "extra.js": "1" });
  assert.equal(r.findings.find((f) => f.id === "scorm-unlisted-files")!.severity, "note");
  assert.match(r.findings.find((f) => f.id === "scorm-schema-files")!.detail, /imscp_rootv1p1p2\.xsd/);
});
