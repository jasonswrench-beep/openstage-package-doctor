// The accessibility check in the window: picks the package's pages, style sheets and documents out of the zip, sends
// them to the program's Rust side, which runs the suite's engine (openstage-a11y, A11Y-1), and draws the report the
// way A11Y-1 section 4 says: each status as a word with its symbol, never a colour alone; each finding with where it
// is and what to do; the checks only a person can make; and what the check could not do. Findings warn and never
// block, and nothing here changes Package Doctor's own verdict.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { OpenedPackage } from "../../core/src/model.ts";
import type { ZipArchive } from "../../core/src/zip.ts";
import { h } from "./dom.ts";

// ---- the A11Y-1 report, as the engine writes it (the members the window uses)

export type A11yStatus = "pass" | "fail" | "needs-review" | "not-tested" | "not-applicable";

export interface A11yWhere {
  file?: string;
  id?: string;
  element?: string;
  line?: number;
  page?: number;
  slide?: number;
  object?: string;
  scheme?: string;
}

export interface A11yFinding {
  rule: string;
  status: A11yStatus;
  wcag: string[];
  where: A11yWhere;
  key: string;
  message: string;
  fix: string;
  count: number;
}

export interface A11yRuleResult {
  rule: string;
  title: string;
  status: A11yStatus;
  wcag: string[];
  checked: number;
  fail: number;
  needsReview: number;
  reason?: string;
}

export interface A11yReport {
  input: { name: string; kind: string; files: number };
  summary: { fail: number; needsReview: number; checklist: number };
  rules: A11yRuleResult[];
  findings: A11yFinding[];
  checklist: { rule: string; title: string; wcag: string[]; message: string }[];
  limits: string[];
}

export interface PackageCheck {
  pages: A11yReport | null;
  documents: { path: string; report: A11yReport }[];
  limits: string[];
}

/** A11Y-1's status words and symbols (section 4.1). */
export const STATUS: Record<A11yStatus, { word: string; symbol: string }> = {
  pass: { word: "Pass", symbol: "✓" },
  fail: { word: "Fail", symbol: "✗" },
  "needs-review": { word: "Needs review", symbol: "?" },
  "not-tested": { word: "Not tested", symbol: "○" },
  "not-applicable": { word: "Not applicable", symbol: "–" },
};

const KIND_WORDS: Record<string, string> = { site: "Pages", html: "Page", docx: "Word document", pptx: "PowerPoint file", vtt: "Captions file", epub: "EPUB book" };

/** The kinds of file the engine reads, and the style sheets the pages need. PDFs are counted, not read. */
const SENT = /\.(html?|xhtml|css|docx|pptx|vtt|epub)$/i;

/** Whether this window can run the check: it needs the program's Rust side, which a browser preview does not have. */
export function canCheck(): boolean {
  return isTauri();
}

/** The message the Rust side reads (a11y.rs, unpack_message): a 4-byte length, a JSON head, then the files' bytes. */
export function packMessage(name: string, root: string, files: [string, Uint8Array][]): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ name, root, files: files.map(([p, b]) => [p, b.length]) }));
  const total = 4 + head.length + files.reduce((n, [, b]) => n + b.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let at = 4 + head.length;
  for (const [, b] of files) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** The package's files the check reads: under its root, of the kinds the engine reads, PDFs as empty placeholders. */
export function filesToCheck(report: OpenedPackage, archive: ZipArchive): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (const e of archive.entries) {
    if (e.isDirectory || e.encrypted || !e.path.startsWith(report.root)) continue;
    if (/\.pdf$/i.test(e.path)) out.push([e.path, new Uint8Array()]);
    else if (SENT.test(e.path)) {
      try {
        out.push([e.path, archive.read(e)]);
      } catch {
        // A damaged file is already a finding in the report; the check goes on without it.
      }
    }
  }
  return out;
}

export async function checkAccessibility(report: OpenedPackage, archive: ZipArchive): Promise<PackageCheck> {
  const body = packMessage(report.fileName, report.root, filesToCheck(report, archive));
  return invoke<PackageCheck>("check_accessibility", body);
}

// ---- drawing it

export function statusBadge(status: A11yStatus): HTMLElement {
  const s = STATUS[status];
  return h("span", { class: `a11y-status a11y-status--${status}` }, h("span", { "aria-hidden": "true" }, s.symbol), ` ${s.word}`);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "0 failures, 2 to review, 3 checks for a person", as A11Y-1's summary line has it. */
export function summaryWords(r: A11yReport): string {
  return `${plural(r.summary.fail, "failure", "failures")}, ${r.summary.needsReview} to review, ${plural(r.summary.checklist, "check", "checks")} for a person`;
}

function whereWords(w: A11yWhere): string {
  const parts: string[] = [];
  if (w.file) parts.push(w.file);
  if (w.line) parts.push(`line ${w.line}`);
  if (w.page) parts.push(`page ${w.page}`);
  if (w.slide) parts.push(`slide ${w.slide}`);
  if (w.object) parts.push(w.object);
  if (w.id) parts.push(`the element with id "${w.id}"`);
  else if (w.element) parts.push(w.element);
  if (w.scheme === "dark") parts.push("in dark mode");
  return parts.join(", ");
}

const SHOWN = 200;

function reportPart(title: string, r: A11yReport): HTMLElement {
  const titles = new Map(r.rules.map((x) => [x.rule, x.title]));
  const findings = [...r.findings].sort((a, b) => (a.status === b.status ? 0 : a.status === "fail" ? -1 : 1));
  const part = h("div", { class: "a11y-part" }, h("h3", {}, title), h("p", { class: "lead" }, summaryWords(r) + "."));
  if (findings.length) {
    // One entry per rule and status, so a screen reader moving by heading hears each kind of problem once; its places
    // are listed under it, each with its own words (two colours, a link's text), and what to do is said once.
    const groups = new Map<string, A11yFinding[]>();
    for (const f of findings) {
      const key = `${f.status} ${f.rule}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    let shown = 0;
    const items: HTMLElement[] = [];
    for (const list of groups.values()) {
      const f = list[0]!;
      const places = list.reduce((n, x) => n + x.count, 0);
      const sameWords = list.every((x) => x.message === f.message);
      const room = Math.max(0, SHOWN - shown);
      shown += Math.min(room, list.length);
      items.push(
        h(
          "li",
          { class: `finding a11y-finding a11y-finding--${f.status}` },
          h("h4", {}, statusBadge(f.status), " ", titles.get(f.rule) ?? f.rule, h("span", { class: "muted" }, ` (${plural(places, "place", "places")})`)),
          // When every place has the same words, they are said once, above the places.
          sameWords ? h("p", {}, f.message) : null,
          h(
            "ul",
            { class: "a11y-places" },
            ...list.slice(0, room).map((x) => h("li", {}, sameWords ? null : `${x.message} `, whereWords(x.where) ? h("span", { class: sameWords ? "" : "where" }, sameWords ? "" : "In ", h("code", {}, whereWords(x.where)), x.count > 1 ? `, and ${x.count - 1} more like it` : "", sameWords ? "" : ".") : null)),
            list.length > room ? h("li", { class: "muted" }, `And ${list.length - room} more; Copy report lists them all.`) : null,
          ),
          h("p", { class: "fix" }, h("strong", {}, "What to do: "), f.fix),
          h("p", { class: "check-id" }, `Rule: ${f.rule} · WCAG ${f.wcag.join(", ")}`),
        ),
      );
    }
    part.append(h("ul", { class: "findings", role: "list" }, ...items));
  } else part.append(h("p", {}, "No failures and nothing to review."));
  if (r.checklist.length) {
    part.append(h("h4", {}, "Checks for a person"), h("p", { class: "muted" }, "No program can judge these; someone has to look."), h("ul", { class: "plain" }, ...r.checklist.map((c) => h("li", {}, h("strong", {}, c.title), `: ${c.message} (WCAG ${c.wcag.join(", ")})`))));
  }
  if (r.limits.length) part.append(h("h4", {}, "What this check could not do"), h("ul", { class: "plain" }, ...r.limits.map((l) => h("li", {}, l))));
  part.append(
    h(
      "details",
      { class: "group" },
      h("summary", {}, `Every rule (${r.rules.length})`),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h("caption", { class: "visually-hidden" }, `Every rule's result for ${title}`),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Rule"), h("th", { scope: "col" }, "Result"), h("th", { scope: "col" }, "WCAG"), h("th", { scope: "col" }, "Looked at"))),
          h(
            "tbody",
            {},
            ...r.rules.map((x) =>
              h("tr", {}, h("th", { scope: "row" }, x.title), h("td", {}, statusBadge(x.status), x.reason ? h("span", { class: "muted" }, ` ${x.reason}`) : null), h("td", {}, x.wcag.join(", ")), h("td", {}, String(x.checked))),
            ),
          ),
        ),
      ),
    ),
  );
  return part;
}

/** The accessibility section's contents for a finished check. `stored` is true for the report's check of the files as
 *  they are stored, which says how to check a page as the learner sees it. */
export function a11yView(check: PackageCheck, stored = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  const all = [...(check.pages ? [check.pages] : []), ...check.documents.map((d) => d.report)];
  const fails = all.reduce((n, r) => n + r.summary.fail, 0);
  const review = all.reduce((n, r) => n + r.summary.needsReview, 0);
  out.push(
    h(
      "p",
      { class: "lead" },
      all.length ? `${plural(fails, "failure", "failures")} and ${review} to review, in ${plural(all.length, "part", "parts")} checked.` : "Nothing in the package is a kind of file the accessibility rules read.",
    ),
    h("p", { class: "muted" }, "Checked with the OpenStage accessibility rules (A11Y-1, which follow WCAG 2.1 AA). They warn and never block: what to change is your call."),
  );
  if (stored && check.pages) {
    out.push(h("p", { class: "muted" }, "These are the pages as they are stored. Most authoring tools build their pages with scripts as they open, so the stored page can differ from what a learner sees. To check a page as the learner sees it, play the course in the test player and choose Check this page's accessibility."));
  }
  if (check.pages) out.push(reportPart(`${KIND_WORDS.site} (${check.pages.input.files})`, check.pages));
  for (const d of check.documents) out.push(reportPart(`${KIND_WORDS[d.report.input.kind] ?? d.report.input.kind}: ${d.path}`, d.report));
  if (check.limits.length) out.push(h("h3", {}, "Not checked"), h("ul", { class: "plain" }, ...check.limits.map((l) => h("li", {}, l))));
  return out;
}

/** The check as text, for Copy report. */
export function a11yText(check: PackageCheck): string {
  const lines = ["", "ACCESSIBILITY (OpenStage accessibility rules, A11Y-1, WCAG 2.1 AA; they warn and never block)"];
  const parts: [string, A11yReport][] = [...(check.pages ? [[`Pages (${check.pages.input.files})`, check.pages] as [string, A11yReport]] : []), ...check.documents.map((d) => [`${KIND_WORDS[d.report.input.kind] ?? d.report.input.kind}: ${d.path}`, d.report] as [string, A11yReport])];
  for (const [title, r] of parts) {
    const titles = new Map(r.rules.map((x) => [x.rule, x.title]));
    lines.push("", `${title}: ${summaryWords(r)}`);
    for (const f of r.findings) {
      const s = STATUS[f.status];
      lines.push(`  ${s.symbol} ${s.word}: ${titles.get(f.rule) ?? f.rule}. ${f.message}`, `      In ${whereWords(f.where)}${f.count > 1 ? ` (and ${f.count - 1} more)` : ""}. What to do: ${f.fix} [${f.rule}; WCAG ${f.wcag.join(", ")}]`);
    }
    for (const c of r.checklist) lines.push(`  For a person: ${c.title}. ${c.message}`);
    for (const l of r.limits) lines.push(`  Not done: ${l}`);
  }
  for (const l of check.limits) lines.push(`Not checked: ${l}`);
  return lines.join("\n") + "\n";
}

// ---- the page as it is now, in the test player

/**
 * The pages showing in the test player's frame, as they are now: the course's page and any frames inside it from the
 * package, each as its current HTML without its scripts. A page that a script builds is checked as the learner sees
 * it, not as it is stored. `base` is the address the package is served under (PlaySession.base).
 */
export function snapshotPages(frame: HTMLIFrameElement, base: string): [string, Uint8Array][] {
  const prefix = new URL(base).pathname + "pkg/";
  const out: [string, Uint8Array][] = [];
  const seen = new Set<string>();
  const visit = (win: Window | null, depth: number) => {
    let doc: Document;
    try {
      if (!win) return;
      doc = win.document;
    } catch {
      return; // a frame from another website: not the package's, and not readable
    }
    const path = decodeURIComponent(new URL(doc.URL).pathname);
    if (!path.startsWith(prefix) || seen.has(path)) return;
    seen.add(path);
    const copy = doc.documentElement.cloneNode(true) as HTMLElement;
    for (const s of copy.querySelectorAll("script")) s.remove();
    out.push([path.slice(prefix.length), new TextEncoder().encode(`<!doctype html>\n${copy.outerHTML}`)]);
    if (depth < 4) for (const inner of doc.querySelectorAll("iframe, frame")) visit((inner as HTMLIFrameElement).contentWindow, depth + 1);
  };
  visit(frame.contentWindow, 0);
  return out;
}

/** Checks the pages as they are now, with the package's style sheets. */
export async function checkSnapshot(name: string, pages: [string, Uint8Array][], archive: ZipArchive): Promise<PackageCheck> {
  const sheets: [string, Uint8Array][] = [];
  for (const e of archive.entries) {
    if (e.isDirectory || e.encrypted || !/\.css$/i.test(e.path)) continue;
    try {
      sheets.push([e.path, archive.read(e)]);
    } catch {
      // left out; the page is still checked
    }
  }
  return invoke<PackageCheck>("check_accessibility", packMessage(name, "", [...pages, ...sheets]));
}
