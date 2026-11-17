// The command line: node src/cli.ts <package.zip> [more.zip ...] [--json]
// Prints each package's report. The exit code is 0 when no package has a problem, 1 when one does, and 2 when a file
// could not be read at all. Nothing is changed: Package Doctor only reads.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { counts, openPackage } from "./open.ts";
import { reportText } from "./report.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const paths = args.filter((a) => !a.startsWith("--"));
if (!paths.length) {
  console.error("Usage: node src/cli.ts <package.zip> [more.zip ...] [--json]");
  process.exit(2);
}

let exit = 0;
const reports = [];
for (const path of paths) {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    console.error(`${path}: could not be read (${e instanceof Error ? e.message : e}).`);
    exit = 2;
    continue;
  }
  const report = openPackage(bytes, basename(path));
  if (counts(report.findings).problem && exit === 0) exit = 1;
  if (json) reports.push(report);
  else process.stdout.write(reportText(report) + (paths.length > 1 ? "\n" + "-".repeat(72) + "\n\n" : ""));
}
if (json) process.stdout.write(JSON.stringify(paths.length === 1 ? reports[0] : reports, null, 2) + "\n");
process.exit(exit);
