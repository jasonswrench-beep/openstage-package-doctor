// The report as plain text: for the command line, and for the window's Copy report button (to paste into an email to
// an LMS administrator or a colleague).

import { SEVERITY_ORDER, SEVERITY_WORDS } from "./findings.ts";
import type { OpenedPackage, OutlineNode } from "./model.ts";
import { counts, formatBytes, verdict } from "./open.ts";

function outlineLines(nodes: OutlineNode[], depth: number, out: string[]): void {
  for (const n of nodes) {
    const extra = [n.launches ? `opens ${n.launches}` : "", n.hidden ? "hidden" : ""].filter(Boolean).join(", ");
    out.push(`${"  ".repeat(depth)}- ${n.title}${extra ? ` (${extra})` : ""}`);
    outlineLines(n.children, depth + 1, out);
  }
}

export function reportText(r: OpenedPackage): string {
  const out: string[] = [];
  const c = counts(r.findings);
  out.push(`OpenStage Package Doctor report: ${r.fileName}`);
  out.push("");
  out.push(verdict(r));
  out.push(`${c.problem} problem${c.problem === 1 ? "" : "s"}, ${c.warning} warning${c.warning === 1 ? "" : "s"}, ${c.note} note${c.note === 1 ? "" : "s"}.`);
  out.push("");
  out.push("Package");
  out.push(`  Kind: ${r.kindLabel}`);
  if (r.title) out.push(`  Title: ${r.title}`);
  if (r.identifier) out.push(`  Identifier: ${r.identifier}`);
  if (r.manifest) out.push(`  Manifest: ${r.manifest}`);
  out.push(`  Size: ${formatBytes(r.zipSize)} as a zip, ${formatBytes(r.totals.size)} unpacked, ${r.totals.files} files`);
  if (r.launches.length) {
    out.push("");
    out.push("Starts at");
    for (const l of r.launches) out.push(`  ${l.title}: ${l.href}${l.tracked === false ? " (not tracked)" : ""}`);
  }

  for (const severity of SEVERITY_ORDER) {
    const list = r.findings.filter((f) => f.severity === severity);
    if (!list.length) continue;
    out.push("");
    out.push(`${SEVERITY_WORDS[severity]}s (${list.length})`);
    for (const f of list) {
      out.push(`  ${SEVERITY_WORDS[severity]}: ${f.title} [${f.id}]`);
      out.push(`    ${f.detail}`);
      if (f.file) out.push(`    In: ${f.file}${f.line ? `, line ${f.line}` : ""}`);
      out.push(`    What to do: ${f.fix}`);
    }
  }

  out.push("");
  out.push("Tracking settings");
  if (!r.tracking.length) out.push("  None in the manifest. The LMS records what the course itself reports.");
  for (const t of r.tracking) out.push(`  ${t.scope}: ${t.name}: ${t.value} (${t.source})`);

  if (r.outline.length) {
    out.push("");
    out.push("Outline");
    outlineLines(r.outline, 1, out);
  }

  out.push("");
  out.push("Not checked");
  for (const l of r.limits) out.push(`  ${l}`);
  return out.join("\n") + "\n";
}
