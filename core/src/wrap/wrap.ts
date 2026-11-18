// Wraps a PDF, a video or a folder of web pages as a course package an LMS can import: the file or folder, a start
// page that shows it, the tracking script (runtime.ts) and the manifest for the chosen standard (manifests.ts). The
// start page is plain, accessible HTML: its language and title set, a main landmark, the video's captions as a track,
// a link to open the document on its own, and a real button for "I have finished". Nothing of the original is changed;
// a folder's own pages are shown in a frame inside the start page, as they are.

import { zipSync, strToU8 } from "fflate";
import { manifestFor, MANIFEST_NAME, type WrapStandard } from "./manifests.ts";
import { runtimeScript, type RuntimeConfig } from "./runtime.ts";

export type WrapKind = "pdf" | "video" | "site";

export interface WrapInput {
  kind: WrapKind;
  title: string;
  description?: string;
  language: string;
  standard: WrapStandard;
  complete: RuntimeConfig["complete"];
  /** The files to wrap, by path: one PDF or video, or a folder's files (paths inside the folder). */
  files: Map<string, Uint8Array>;
  /** The PDF or video, or the folder's start page. */
  main: string;
  /** A WebVTT captions file for a video, among `files`. */
  captions?: { path: string; language: string; label: string };
  /** An address (IRI) that identifies the course for cmi5 and xAPI. Made up if not given. */
  courseId?: string;
}

export interface Wrapped {
  bytes: Uint8Array;
  /** The page that opens, and every file, as they are in the new package. */
  start: string;
  files: string[];
}

const START = "index.html";
const SCRIPT = "openstage-tracking.js";
const SITE = "site/";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A path for an address in a page: each part encoded, the slashes kept. */
const href = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime" };

function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A title from a file name: no ending, separators as spaces. */
export function titleFromName(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const words = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Course";
}

const STYLE = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body { font: 16px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #ffffff; display: flex; flex-direction: column; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid #c9ced6; }
    h1 { font-size: 20px; margin: 0; flex: 1 1 auto; }
    main { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; padding: 12px 16px; gap: 10px; }
    main.full { padding: 0; }
    iframe { flex: 1 1 auto; width: 100%; min-height: 420px; border: 1px solid #c9ced6; }
    main.full iframe { border: 0; }
    video { width: 100%; max-height: 80vh; background: #000000; color: #ffffff; }
    video a { color: #9ecbff; }
    a { color: #0b4fb3; }
    button { font: inherit; padding: 6px 16px; border: 2px solid #1d4f8f; border-radius: 6px; background: #1d4f8f; color: #ffffff; cursor: pointer; }
    button:disabled { background: #ffffff; color: #1d4f8f; cursor: default; }
    :focus-visible { outline: 3px solid #0b3fb3; outline-offset: 2px; }
    #openstage-status:empty { display: none; }
    #openstage-status { margin: 0; font-size: 14px; color: #3d3d3d; }
    @media (forced-colors: active) { button { border-color: ButtonText; } }`;

function startPage(input: WrapInput, main: string, lang: string): string {
  const title = esc(input.title);
  const finish = input.complete === "button" ? `\n    <button type="button" id="openstage-finish">I have finished</button>` : "";
  const status = `<p id="openstage-status" role="status"></p>`;
  let body: string;
  if (input.kind === "pdf") {
    body = `<main>
    <p>The document is below. If it does not show, <a href="${href(main)}" target="_blank" rel="noopener">open the document on its own</a> or download it from there.</p>
    <iframe src="${href(main)}" title="${title} (the document)"></iframe>
    ${status}
  </main>`;
  } else if (input.kind === "video") {
    const type = VIDEO_TYPES[main.slice(main.lastIndexOf(".") + 1).toLowerCase()] ?? "video/mp4";
    const track = input.captions ? `\n      <track kind="captions" src="${href(input.captions.path)}" srclang="${esc(input.captions.language)}" label="${esc(input.captions.label)}" default>` : "";
    body = `<main>
    <video controls preload="metadata" aria-label="${title}">
      <source src="${href(main)}" type="${type}">${track}
      <p>This browser cannot play the video. <a href="${href(main)}">Download the video</a>.</p>
    </video>
    ${status}
  </main>`;
  } else {
    body = `<main class="full">
    <iframe src="${href(main)}" title="${title}"></iframe>
  </main>
  ${status.replace("<p ", '<p style="padding: 0 16px" ')}`;
  }
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${STYLE}
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>${finish}
  </header>
  ${body}
  <script src="${SCRIPT}"></script>
</body>
</html>
`;
}

/** Already packed, so stored rather than deflated again. */
const PACKED = /\.(jpe?g|png|gif|webp|mp3|m4a|mp4|m4v|webm|ogv|mov|pdf|zip|woff2|docx|pptx|xlsx)$/i;

export function wrapPackage(input: WrapInput): Wrapped {
  if (!input.files.has(input.main)) throw new Error(`${input.main} is not among the files to wrap.`);
  if (!input.title.trim()) throw new Error("The package needs a title.");
  const courseId = input.courseId || `urn:uuid:${uuid()}`;
  const out = new Map<string, Uint8Array>();
  // A folder goes in a folder of its own, so its files never meet the package's own (its index.html, say).
  const place = (p: string) => (input.kind === "site" ? SITE + p : p.slice(p.lastIndexOf("/") + 1));
  for (const [path, bytes] of input.files) out.set(place(path), bytes);
  const main = place(input.main);
  const captions = input.captions ? { ...input.captions, path: place(input.captions.path) } : undefined;
  if (out.has(START) || out.has(SCRIPT)) throw new Error(`A file to wrap is called ${START} or ${SCRIPT}, which the package needs for itself. Rename it first.`);
  const wrapInput = { ...input, captions };
  out.set(START, strToU8(startPage(wrapInput, main, input.language)));
  out.set(SCRIPT, strToU8(runtimeScript({ standard: input.standard, complete: input.complete, title: input.title, language: input.language, courseId })));
  const files = [...out.keys()];
  const manifest = manifestFor(input.standard, {
    title: input.title,
    description: input.description?.trim() || `${input.title}, wrapped as a course package.`,
    language: input.language,
    start: START,
    files,
    courseId,
  });
  out.set(MANIFEST_NAME[input.standard], strToU8(manifest));
  const zipped = zipSync(Object.fromEntries([...out].map(([p, b]) => [p, [b, { level: PACKED.test(p) ? 0 : 9 }]])) as Parameters<typeof zipSync>[0]);
  return { bytes: zipped, start: START, files: [...out.keys()] };
}
