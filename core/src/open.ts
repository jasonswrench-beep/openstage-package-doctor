// Opens a package and checks whether it will run: the zip, the manifest, the start pages and the links in its pages.

import { readCmi5, readTincan } from "./cmi5.ts";
import { finding, SEVERITY_ORDER, type Finding } from "./findings.ts";
import { checkLinks, LINK_SCAN_LIMIT, PAGE_EXTENSIONS, STYLE_EXTENSIONS } from "./links.ts";
import type { OpenedPackage, PackageFile } from "./model.ts";
import { FileIndex, folderOf } from "./paths.ts";
import { readScorm } from "./scorm.ts";
import { decodeXmlBytes, parseXml, XmlError } from "./xml.ts";
import { ZipArchive, ZipError, type ZipEntry } from "./zip.ts";

const MANIFEST_NAMES = ["imsmanifest.xml", "cmi5.xml", "tincan.xml"] as const;
type ManifestName = (typeof MANIFEST_NAMES)[number];
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._[^/]*$)/i;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function list(names: string[], max = 3): string {
  return names.slice(0, max).join(", ") + (names.length > max ? `, and ${names.length - max} more` : "");
}

/** A package once opened: what was read from it, and the zip itself for the tools that work on its files. */
export interface PackageSession {
  report: OpenedPackage;
  archive?: ZipArchive;
}

export function openPackage(bytes: Uint8Array, fileName: string): OpenedPackage {
  return openPackageSession(bytes, fileName).report;
}

export function openPackageSession(bytes: Uint8Array, fileName: string): PackageSession {
  const report: OpenedPackage = {
    fileName,
    zipSize: bytes.length,
    kind: "unknown",
    kindLabel: "Not a course package",
    root: "",
    files: [],
    totals: { files: 0, size: 0, packedSize: 0 },
    outline: [],
    launches: [],
    tracking: [],
    findings: [],
    limits: [],
  };
  const findings = report.findings;

  let archive: ZipArchive;
  try {
    archive = new ZipArchive(bytes);
  } catch (e) {
    const message = e instanceof ZipError ? e.message : "The file could not be read as a zip.";
    findings.push(finding("zip-unreadable", message));
    return { report };
  }

  // The zip itself.
  const entries = archive.entries.filter((e) => !e.isDirectory);
  const byPath = new Map<string, ZipEntry>();
  const duplicates: string[] = [];
  for (const e of entries) {
    if (byPath.has(e.path)) duplicates.push(e.path);
    else byPath.set(e.path, e);
  }
  report.files = [...byPath.values()].map((e): PackageFile => ({ path: e.path, size: e.size, packedSize: e.packedSize }));
  report.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  report.totals = {
    files: report.files.length,
    size: report.files.reduce((s, f) => s + f.size, 0),
    packedSize: report.files.reduce((s, f) => s + f.packedSize, 0),
  };
  if (!entries.length) {
    findings.push(finding("zip-empty", archive.entries.length ? "It holds only empty folders." : "It holds no files."));
    return { report, archive };
  }

  const encrypted = entries.filter((e) => e.encrypted).map((e) => e.path);
  if (encrypted.length) findings.push(finding("zip-encrypted", `${encrypted.length} of ${entries.length} files: ${list(encrypted)}.`));
  const oddMethod = entries.filter((e) => e.method !== 0 && e.method !== 8);
  if (oddMethod.length) {
    const names: Record<number, string> = { 9: "Deflate64", 12: "BZIP2", 14: "LZMA", 93: "Zstandard", 95: "XZ", 98: "PPMd" };
    const methods = [...new Set(oddMethod.map((e) => names[e.method] ?? `method ${e.method}`))];
    findings.push(finding("zip-method", `${oddMethod.length} files are packed with ${methods.join(" and ")}: ${list(oddMethod.map((e) => e.path))}.`));
  }
  const backslashed = archive.entries.filter((e) => e.rawName.includes("\\")).map((e) => e.rawName);
  if (backslashed.length) findings.push(finding("zip-backslash", `${backslashed.length} names, such as ${list(backslashed, 2)}.`));
  const unsafe = archive.entries.filter((e) => e.path.startsWith("/") || /^[a-z]:/i.test(e.path) || e.path.split("/").includes("..")).map((e) => e.rawName);
  if (unsafe.length) findings.push(finding("zip-unsafe-path", `${list(unsafe)}.`));
  if (duplicates.length) findings.push(finding("zip-duplicate", `${list([...new Set(duplicates)])}.`));
  const badNames = entries.filter((e) => e.nonAsciiName && !e.utf8Name).map((e) => e.path);
  if (badNames.length) findings.push(finding("zip-name-encoding", `${badNames.length} names are stored without the zip's UTF-8 marker, such as ${list(badNames, 2)}.`));
  const junk = entries.filter((e) => JUNK.test(e.path)).map((e) => e.path);
  if (junk.length) findings.push(finding("zip-junk", `${junk.length} file${junk.length === 1 ? "" : "s"}, such as ${list(junk, 2)}.`));
  const zips = entries.filter((e) => /\.zip$/i.test(e.path)).map((e) => e.path);
  if (zips.length) findings.push(finding("zip-nested", `${list(zips)}.`));

  const files = new FileIndex(byPath.keys());
  const readText = (path: string, limit = Infinity): string | undefined => {
    const e = byPath.get(path);
    if (!e || e.encrypted || e.size > limit) return undefined;
    try {
      return new TextDecoder("utf-8").decode(archive.read(e));
    } catch {
      return undefined;
    }
  };
  const damaged: string[] = [];

  // The manifest: the shallowest one, preferring imsmanifest.xml, then cmi5.xml, then tincan.xml.
  const candidates = report.files
    .filter((f) => !JUNK.test(f.path))
    .map((f) => ({ path: f.path, base: f.path.slice(f.path.lastIndexOf("/") + 1), depth: f.path.split("/").length - 1 }))
    .filter((c) => (MANIFEST_NAMES as readonly string[]).includes(c.base.toLowerCase()));
  if (!candidates.length) {
    const aicc = report.files.filter((f) => /\.(au|crs|des|cst)$/i.test(f.path));
    if (aicc.length >= 2) {
      report.kind = "aicc";
      report.kindLabel = "AICC package";
      findings.push(finding("aicc-package", `It has the AICC course files ${list(aicc.map((f) => f.path))}.`));
    } else {
      const pages = report.files.filter((f) => PAGE_EXTENSIONS.test(f.path)).length;
      findings.push(finding("manifest-missing", pages ? `The zip has ${pages} web page${pages === 1 ? "" : "s"} but no imsmanifest.xml, cmi5.xml or tincan.xml.` : "The zip has no imsmanifest.xml, cmi5.xml or tincan.xml."));
    }
  } else {
    const depth = Math.min(...candidates.map((c) => c.depth));
    const shallow = candidates.filter((c) => c.depth === depth);
    const rank = (c: { base: string }) => MANIFEST_NAMES.indexOf(c.base.toLowerCase() as ManifestName);
    shallow.sort((a, b) => rank(a) - rank(b));
    const chosen = shallow[0]!;
    report.manifest = chosen.path;
    report.root = folderOf(chosen.path);
    if (depth > 0) findings.push(finding("manifest-in-folder", `It is at ${chosen.path}. The rest of this report reads the package from the folder ${report.root}.`, { file: chosen.path }));
    if (chosen.base !== chosen.base.toLowerCase()) findings.push(finding("manifest-name-case", `It is called ${chosen.base}; it must be ${chosen.base.toLowerCase()}.`, { file: chosen.path }));
    const kinds = [...new Set(shallow.map((c) => c.base.toLowerCase()))];
    if (kinds.length > 1) findings.push(finding("manifest-several", `Found: ${kinds.join(", ")}. This report reads ${chosen.base.toLowerCase()}.`));

    const entry = byPath.get(chosen.path)!;
    let raw: Uint8Array | undefined;
    try {
      raw = archive.read(entry);
    } catch (e) {
      damaged.push(chosen.path);
      if (!entry.encrypted) findings.push(finding("zip-damaged", e instanceof Error ? e.message : `${chosen.path} could not be unpacked.`, { file: chosen.path }));
    }
    const which = chosen.base.toLowerCase() as ManifestName;
    report.kindLabel = which === "imsmanifest.xml" ? "SCORM or IMS package (manifest unreadable)" : which === "cmi5.xml" ? "cmi5 (course structure unreadable)" : "xAPI (tincan.xml unreadable)";
    report.kind = which === "imsmanifest.xml" ? "unknown" : which === "cmi5.xml" ? "cmi5" : "xapi";
    if (raw) {
      const decoded = decodeXmlBytes(raw);
      if (decoded.encodingProblem) findings.push(finding("xml-encoding", decoded.encodingProblem, { file: chosen.path }));
      try {
        const root = parseXml(decoded.text);
        if (which === "imsmanifest.xml") {
          const read = readScorm(root, chosen.path, files);
          Object.assign(report, { kind: read.kind, kindLabel: read.kindLabel, title: read.title, identifier: read.identifier, outline: read.outline, launches: read.launches, tracking: read.tracking });
          findings.push(...read.findings);
          if (read.kind === "scorm12" || read.kind === "scorm2004") {
            const unlisted = report.files.filter((f) => f.path.startsWith(report.root) && !read.listed.has(f.path) && !JUNK.test(f.path) && !/\.(xsd|dtd)$/i.test(f.path));
            if (unlisted.length) findings.push(finding("scorm-unlisted-files", `${unlisted.length} of ${report.files.length} files, such as ${list(unlisted.map((f) => f.path), 2)}.`, { file: chosen.path }));
          }
        } else {
          const read = which === "cmi5.xml" ? readCmi5(root, chosen.path, files) : readTincan(root, chosen.path, files);
          report.kindLabel = which === "cmi5.xml" ? "cmi5" : "xAPI (tincan.xml)";
          Object.assign(report, { title: read.title, identifier: read.identifier, outline: read.outline, launches: read.launches, tracking: read.tracking });
          findings.push(...read.findings);
        }
      } catch (e) {
        if (!(e instanceof XmlError)) throw e;
        findings.push(finding("xml-malformed", `Line ${e.line}, column ${e.column}: ${e.message}`, { file: chosen.path, line: e.line }));
      }
    }
  }

  // Links in the pages and style sheets.
  const linkCheck = checkLinks(
    // Only the package's own folder: what is outside it (when the manifest is in a folder) is not part of the course.
    report.files.map((f) => f.path).filter((p) => !JUNK.test(p) && p.startsWith(report.root)),
    (path) => {
      const text = readText(path, LINK_SCAN_LIMIT);
      if (text === undefined) {
        const e = byPath.get(path);
        if (e && !e.encrypted && e.size <= LINK_SCAN_LIMIT) damaged.push(path);
      }
      return text;
    },
    files,
  );
  findings.push(...linkCheck.findings);
  for (const path of damaged) {
    if (!findings.some((f) => f.id === "zip-damaged" && f.file === path)) {
      const e = byPath.get(path)!;
      let message = `${path} could not be unpacked.`;
      try { archive.read(e); } catch (err) { if (err instanceof Error) message = err.message; }
      if (e.method === 0 || e.method === 8) findings.push(finding("zip-damaged", message, { file: path }));
    }
  }
  const scripts = report.files.filter((f) => /\.m?js$/i.test(f.path) && f.path.startsWith(report.root)).length;
  if (scripts) findings.push(finding("links-scripted", `The package has ${scripts} script file${scripts === 1 ? "" : "s"}. Links were read in ${linkCheck.pagesRead} page${linkCheck.pagesRead === 1 ? "" : "s"} and ${linkCheck.styleSheetsRead} style sheet${linkCheck.styleSheetsRead === 1 ? "" : "s"}.`));

  const largest = [...report.files].sort((a, b) => b.size - a.size).slice(0, 3);
  findings.push(
    finding(
      "zip-size",
      `${formatBytes(report.zipSize)} as a zip, ${formatBytes(report.totals.size)} unpacked, in ${report.totals.files} file${report.totals.files === 1 ? "" : "s"}. The largest: ${largest.map((f) => `${f.path} (${formatBytes(f.size)})`).join(", ")}.`,
    ),
  );

  const tooBig = report.files.filter((f) => (PAGE_EXTENSIONS.test(f.path) || STYLE_EXTENSIONS.test(f.path)) && f.size > LINK_SCAN_LIMIT);
  if (tooBig.length) report.limits.push(`Pages or style sheets over ${formatBytes(LINK_SCAN_LIMIT)} were not read for links: ${list(tooBig.map((f) => f.path))}.`);
  report.limits.push("Links that a course's scripts build while it runs are not checked here; playing the course in the test player finds the ones its scripts ask for.");
  report.limits.push("Whether an LMS accepts the package's size is not checked here, because each LMS sets its own limit.");
  report.limits.push("This check reads the package. The final test is importing it into your LMS and launching it there.");

  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return { report, archive };
}

export function counts(findings: Finding[]): Record<"problem" | "warning" | "note", number> {
  const c = { problem: 0, warning: 0, note: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

/** One sentence for the top of a report. */
export function verdict(report: OpenedPackage): string {
  const c = counts(report.findings);
  if (report.kind === "content-package") return "This is an IMS content package, not a SCORM, xAPI or cmi5 course.";
  if (report.kind === "aicc") return "This is an AICC package, which Package Doctor does not open yet.";
  if (report.kind === "unknown" && !report.manifest) return "This is not a course package Package Doctor can open.";
  if (c.problem) return `${c.problem} problem${c.problem === 1 ? "" : "s"} will probably stop this package working in an LMS.`;
  if (c.warning) return `No problems found, but ${c.warning} warning${c.warning === 1 ? "" : "s"} may cause trouble in some LMSs.`;
  return "No problems found. The package should import and launch.";
}
