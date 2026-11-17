// Checks the links in a package's pages (.html, .htm, .xhtml) and style sheets (.css): every picture, script, style
// sheet, frame, media file and page they name must be in the package, spelled with the same capitals, and reachable
// from inside an LMS. Links a script builds while the course runs cannot be seen here; the report says so.

import { finding, RULES, type Finding, type FindingId } from "./findings.ts";
import { FileIndex, folderOf, isExternal, resolveIn, splitReference } from "./paths.ts";

export const PAGE_EXTENSIONS = /\.(html?|xhtml?)$/i;
export const STYLE_EXTENSIONS = /\.css$/i;
/** Bigger pages than this are not read for links; the report says which were left out. */
export const LINK_SCAN_LIMIT = 10 * 1024 * 1024;
/** This many missing files linked from one file, and from nowhere else, are reported as one finding about that file. */
export const MERGE_FROM = 4;

/** Elements whose link the browser loads into the page (so http on an https LMS is blocked), rather than navigates to. */
const LOADED = new Set(["img", "script", "link", "iframe", "frame", "source", "video", "audio", "track", "embed", "object", "input", "image"]);

interface Ref {
  ref: string;
  line: number;
  loaded: boolean;
}

/** Files a course needs in order to run. A missing one of these is a problem; any other missing file is a warning. */
export const NEEDED_TO_RUN = /\.(m?js|css|html?|xhtml?|json|xml|swf|wasm)$/i;

interface Hit {
  id: FindingId;
  target: string;
  detail: (places: string) => string;
  file: string;
  line: number;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Replaces a stretch of text with spaces, keeping its line breaks, so later line numbers stay right. */
function blank(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

export function cssRefs(css: string, firstLine = 1): Ref[] {
  const out: Ref[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  const lines = lineCounter(text, firstLine);
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (ref) out.push({ ref, line: lines(m.index!), loaded: true });
  }
  for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    const ref = (m[1] ?? m[2] ?? "").trim();
    if (ref) out.push({ ref, line: lines(m.index!), loaded: true });
  }
  return out;
}

function lineCounter(text: string, firstLine: number): (index: number) => number {
  let lastIndex = 0;
  let lastLine = firstLine;
  return (index: number) => {
    if (index < lastIndex) { lastIndex = 0; lastLine = firstLine; }
    for (let i = lastIndex; i < index; i++) if (text.charCodeAt(i) === 10) lastLine++;
    lastIndex = index;
    return lastLine;
  };
}

export function htmlRefs(html: string): { refs: Ref[]; base?: string } {
  const refs: Ref[] = [];
  // Comments go first. Script bodies are blanked too, keeping the <script> tag itself, so its src is still read.
  let text = html.replace(/<!--[\s\S]*?-->/g, blank);
  text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_m, open: string, body: string, close: string) => open + blank(body) + close);
  const styles: { body: string; at: number }[] = [];
  text = text.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, open: string, body: string, close: string, offset: number) => {
    styles.push({ body, at: offset + open.length });
    return open + blank(body) + close;
  });
  const lines = lineCounter(text, 1);
  let base: string | undefined;
  for (const tag of text.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)(\s[^<>]*?)?\/?>/g)) {
    const name = tag[1]!.toLowerCase();
    const attrs = tag[2];
    if (!attrs) continue;
    const line = lines(tag.index!);
    for (const a of attrs.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const attr = a[1]!.toLowerCase();
      const value = (a[2] ?? a[3] ?? a[4] ?? "").trim();
      if (!value) continue;
      if (attr === "style") {
        for (const r of cssRefs(value, line)) refs.push(r);
        continue;
      }
      if (name === "base" && attr === "href") { base = value; continue; }
      const loaded = LOADED.has(name);
      if (attr === "src" || attr === "poster" || attr === "background" || (attr === "data" && name === "object")) {
        refs.push({ ref: value, line, loaded: true });
      } else if (attr === "href" || attr === "xlink:href") {
        // A <link> other than a style sheet or an icon (preconnect, canonical...) is not a file the page needs.
        if (name === "link" && !/\b(stylesheet|icon|preload|modulepreload|manifest)\b/i.test(attrs)) continue;
        refs.push({ ref: value, line, loaded: loaded && name !== "a" });
      } else if (attr === "srcset") {
        for (const part of value.split(",")) {
          const url = part.trim().split(/\s+/)[0];
          if (url) refs.push({ ref: url, line, loaded: true });
        }
      }
    }
  }
  for (const s of styles) for (const r of cssRefs(s.body, lineAt(text, s.at))) refs.push(r);
  return base === undefined ? { refs } : { refs, base };
}

/** Text that looks like a template's or a script's placeholder rather than a real address. */
function isPlaceholder(ref: string): boolean {
  return /\{\{|\}\}|\$\{|<%|%>|^\s*javascript:|^\s*#|^about:|^\[|\+\s*['"]|['"]\s*\+/i.test(ref);
}

export interface LinkCheck {
  findings: Finding[];
  pagesRead: number;
  styleSheetsRead: number;
  skipped: string[];
}

export function checkLinks(paths: string[], read: (path: string) => string | undefined, files: FileIndex): LinkCheck {
  const hits: Hit[] = [];
  let pagesRead = 0;
  let styleSheetsRead = 0;
  const skipped: string[] = [];

  for (const path of paths) {
    const isPage = PAGE_EXTENSIONS.test(path);
    const isStyle = STYLE_EXTENSIONS.test(path);
    if (!isPage && !isStyle) continue;
    const text = read(path);
    if (text === undefined) { skipped.push(path); continue; }
    let refs: Ref[];
    let folder = folderOf(path);
    if (isPage) {
      const found = htmlRefs(text);
      refs = found.refs;
      if (found.base && !isExternal(found.base)) folder = resolveIn(folder, found.base.endsWith("/") ? found.base : folderOf(found.base)).path;
      pagesRead++;
    } else {
      refs = cssRefs(text);
      styleSheetsRead++;
    }

    for (const { ref, line, loaded } of refs) {
      if (isPlaceholder(ref) || ref.startsWith("data:") || ref.startsWith("blob:")) continue;
      const at = { file: path, line };
      if (/^file:/i.test(ref) || /^[a-z]:[\\/]/i.test(ref) || ref.startsWith("\\\\")) {
        hits.push({ id: "link-local-disk", target: ref, detail: (p) => `${ref}, linked from ${p}.`, ...at });
        continue;
      }
      if (isExternal(ref)) {
        if (loaded && /^http:/i.test(ref)) hits.push({ id: "link-insecure", target: ref, detail: (p) => `${ref}, loaded by ${p}.`, ...at });
        continue;
      }
      const { file } = splitReference(ref);
      if (!file) continue;
      if (file.includes("\\")) hits.push({ id: "link-backslash", target: ref, detail: (p) => `${ref}, in ${p}.`, ...at });
      if (file.startsWith("/")) {
        hits.push({ id: "link-root", target: ref, detail: (p) => `${ref}, in ${p}.`, ...at });
        continue;
      }
      const resolved = resolveIn(folder, file);
      if (resolved.outside) {
        hits.push({ id: "link-outside", target: ref, detail: (p) => `${ref}, in ${p}.`, ...at });
        continue;
      }
      const look = files.lookup(resolved.path);
      if (look.found === "missing") {
        hits.push({ id: "link-broken", target: resolved.path, detail: (p) => `${resolved.path} is missing. It is linked from ${p}.`, ...at });
      } else if (look.found === "case") {
        hits.push({ id: "link-case", target: resolved.path, detail: (p) => `${p} links to ${resolved.path}; the package has ${look.path}.`, ...at });
      }
    }
  }

  // One finding per kind and target, naming the first few places it is linked from.
  const groups = new Map<string, Hit[]>();
  for (const h of hits) {
    const key = `${h.id}\u0000${h.target}`;
    const list = groups.get(key);
    if (list) list.push(h);
    else groups.set(key, [h]);
  }
  // Then, when one file has several such links and nothing else links to them (a style sheet full of pictures
  // that were never copied), those become a single finding about that file.
  const severityOf = (h: Hit) => ((h.id === "link-broken" || h.id === "link-case") && !NEEDED_TO_RUN.test(h.target) ? "warning" : RULES[h.id].severity);
  const byFile = new Map<string, Hit[][]>();
  const single: Hit[][] = [];
  for (const list of groups.values()) {
    const files = new Set(list.map((h) => h.file));
    if (files.size !== 1) { single.push(list); continue; }
    const key = `${list[0]!.id}\u0000${severityOf(list[0]!)}\u0000${list[0]!.file}`;
    const lists = byFile.get(key);
    if (lists) lists.push(list);
    else byFile.set(key, [list]);
  }
  const findings: Finding[] = [];
  for (const lists of byFile.values()) {
    if (lists.length < MERGE_FROM) { single.push(...lists); continue; }
    const first = lists[0]![0]!;
    const targets = lists.map((l) => l[0]!.target);
    const names = targets.slice(0, 5).join(", ") + (targets.length > 5 ? `, and ${targets.length - 5} more` : "");
    const detail =
      first.id === "link-broken" ? `${first.file} links to ${targets.length} files that are not in the package: ${names}.`
      : first.id === "link-case" ? `${first.file} links to ${targets.length} files whose names differ from the package's in capitals: ${names}.`
      : `${first.file} has ${targets.length} links like this: ${names}.`;
    findings.push(finding(first.id, detail, { file: first.file, line: first.line }, severityOf(first)));
  }
  for (const list of single) {
    const first = list[0]!;
    const places = list.slice(0, 3).map((h) => `${h.file} line ${h.line}`);
    const more = list.length > 3 ? ` and ${list.length - 3} more place${list.length - 3 === 1 ? "" : "s"}` : "";
    findings.push(finding(first.id, first.detail(places.join(", ") + more), { file: first.file, line: first.line }, severityOf(first)));
  }
  return { findings, pagesRead, styleSheetsRead, skipped };
}
