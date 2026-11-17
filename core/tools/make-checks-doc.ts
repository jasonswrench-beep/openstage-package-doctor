// Writes docs/checks.md from the catalogue in src/findings.ts, so the documented checks are always the ones the code
// runs. A test fails when the file is out of date: run `npm run docs` in core/ after changing a finding's words.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RULES, SEVERITY_WORDS } from "../src/findings.ts";

const GROUPS: [string, string][] = [
  ["zip-", "The zip"],
  ["manifest-", "Finding the manifest"],
  ["xml-", "Reading the manifest"],
  ["not-a-course", "Reading the manifest"],
  ["aicc-", "Reading the manifest"],
  ["scorm-", "SCORM"],
  ["cmi5-", "cmi5"],
  ["xapi-", "xAPI (tincan.xml)"],
  ["link", "Links in the pages"],
];

export function checksDoc(): string {
  const out: string[] = [
    "# What Package Doctor checks",
    "",
    "Made from `core/src/findings.ts` by `npm run docs` in `core/`; do not edit it by hand.",
    "",
    "Every finding has a stable id, which the report, the JSON output and the tests use. How serious it is:",
    "",
    "- **Problem**: an LMS is likely to refuse the package, or the course will not open or not track.",
    "- **Warning**: some LMSs or browsers will have trouble; others will not mind.",
    "- **Note**: worth knowing; nothing is wrong.",
    "",
    "None of them blocks anything: Package Doctor reports, and the person decides.",
    "",
    "A broken link (`link-broken`) or a link that differs in capitals only (`link-case`) is a problem when the file is one",
    "the course needs to run (a script, style sheet, page or data file) and a warning when it is a picture, sound, video,",
    "font or document.",
  ];
  let current = "";
  for (const [id, rule] of Object.entries(RULES)) {
    const group = GROUPS.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "Other";
    if (group !== current) {
      out.push("", `## ${group}`, "", "| Id | Severity | Finding | What to do |", "| --- | --- | --- | --- |");
      current = group;
    }
    const cell = (s: string) => s.replace(/\|/g, "\\|");
    out.push(`| \`${id}\` | ${SEVERITY_WORDS[rule.severity]} | ${cell(rule.title)} | ${cell(rule.fix)} |`);
  }
  return out.join("\n") + "\n";
}

export const DOC_PATH = fileURLToPath(new URL("../../docs/checks.md", import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(DOC_PATH, checksDoc());
  console.log(`Wrote ${DOC_PATH}`);
}
