import { test } from "node:test";
import assert from "node:assert/strict";
import { a11yText, packMessage, summaryWords, type PackageCheck } from "./a11y.ts";

test("the message to the Rust side is a length, a JSON head and the files' bytes in order", () => {
  const enc = new TextEncoder();
  const msg = packMessage("course.zip", "course/", [["course/index.html", enc.encode("<p>hi</p>")], ["course/a.css", enc.encode("p{}")]]);
  const n = new DataView(msg.buffer).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(msg.subarray(4, 4 + n)));
  assert.deepEqual(head, { name: "course.zip", root: "course/", files: [["course/index.html", 9], ["course/a.css", 3]] });
  assert.equal(new TextDecoder().decode(msg.subarray(4 + n)), "<p>hi</p>p{}");
});

test("the report text gives each finding's status as a word, where it is and what to do", () => {
  const check: PackageCheck = {
    pages: {
      input: { name: "course.zip", kind: "site", files: 2 },
      summary: { fail: 1, needsReview: 0, checklist: 1 },
      rules: [{ rule: "alt-missing", title: "Pictures with no description", status: "fail", wcag: ["1.1.1"], checked: 3, fail: 1, needsReview: 0 }],
      findings: [{ rule: "alt-missing", status: "fail", wcag: ["1.1.1"], where: { file: "index.html", line: 9 }, key: "k", message: "This picture has no description.", fix: "Describe it.", count: 2 }],
      checklist: [{ rule: "reading-order", title: "Check the reading order", wcag: ["1.3.2"], message: "Read it in order." }],
      limits: [],
    },
    documents: [],
    limits: ["The PDF in the package was not checked."],
  };
  assert.equal(summaryWords(check.pages!), "1 failure, 0 to review, 1 check for a person");
  const text = a11yText(check);
  assert.match(text, /✗ Fail: Pictures with no description\. This picture has no description\./);
  assert.match(text, /In index\.html, line 9 \(and 1 more\)\. What to do: Describe it\. \[alt-missing; WCAG 1\.1\.1\]/);
  assert.match(text, /For a person: Check the reading order/);
  assert.match(text, /Not checked: The PDF in the package was not checked\./);
});
