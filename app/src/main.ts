// The Package Doctor window: open a package (button, Ctrl+O or drop), then show what is in it and whether it will run.
// Everything happens on this computer; nothing is uploaded. Accessibility: one heading per section (h2), the report's
// findings under h3 and h4 so a screen reader can move by heading; states always in words; focus goes to the report's
// heading when a package opens, and the status line says the verdict once.

import { counts, formatBytes, openPackageSession, verdict } from "../../core/src/open.ts";
import { noTrackingWords, reportText } from "../../core/src/report.ts";
import { SEVERITY_ORDER, SEVERITY_WORDS, type Severity } from "../../core/src/findings.ts";
import type { OpenedPackage, OutlineNode } from "../../core/src/model.ts";
import { PlaySession, playables, STANDARD_WORDS } from "../../core/src/play/session.ts";
import type { ZipArchive } from "../../core/src/zip.ts";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, badge, copyText, findingItem, h, type Child } from "./dom.ts";
import { icon } from "./icons.ts";
import { openPlayer } from "./player.ts";
import { openChanges, PackageChanges } from "./changes.ts";
import { openWrap } from "./wrap-view.ts";
import { a11yText, a11yView, canCheck, checkAccessibility, filesToCheck, type PackageCheck } from "./a11y.ts";
import { buildTree, type Folder } from "./tree.ts";

/** The program's version, written in by build.mjs from package.json. */
declare const __PD_VERSION__: string;
const VERSION = typeof __PD_VERSION__ === "string" ? __PD_VERSION__ : "";

const main = document.getElementById("main")!;
const shell = document.querySelector<HTMLElement>(".shell")!;
const status = document.getElementById("status")!;
const shellDoc = document.getElementById("shell-doc")!;
const homeButton = document.getElementById("home-button") as HTMLButtonElement;
const openButton = document.getElementById("open-button") as HTMLButtonElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const dropVeil = document.getElementById("drop-veil")!;

homeButton.append(icon("home"), "Start page");
openButton.append(icon("open"), "Open package...");
copyButton.append(icon("copy"), "Copy report");

let current: OpenedPackage | undefined;
/** The open zip, for the test player, and the player's sitting once it has been opened. */
let archive: ZipArchive | undefined;
let playSession: PlaySession | undefined;
/** Each package's accessibility check, once it has run (it runs once per package opened). */
const a11yChecks = new WeakMap<OpenedPackage, PackageCheck>();

/** Fills the Accessibility section: runs the check the first time, and draws it. */
function fillAccessibility(r: OpenedPackage, into: HTMLElement): void {
  const done = a11yChecks.get(r);
  if (done) {
    into.replaceChildren(...a11yView(done, true));
    return;
  }
  if (!archive || !filesToCheck(r, archive).length) {
    into.replaceChildren(h("p", {}, "There are no pages or documents in the package for the accessibility rules to read."));
    return;
  }
  if (!canCheck()) {
    into.replaceChildren(h("p", {}, "The accessibility check runs in the Package Doctor program; this browser preview cannot run it."));
    return;
  }
  into.replaceChildren(h("p", { class: "muted" }, "Checking the pages and documents..."));
  const from = archive;
  checkAccessibility(r, from)
    .then((check) => {
      a11yChecks.set(r, check);
      if (into.isConnected) into.replaceChildren(...a11yView(check, true));
    })
    .catch((e) => {
      if (into.isConnected) into.replaceChildren(h("p", {}, `The accessibility check could not run: ${e instanceof Error ? e.message : String(e)}`));
    });
}

/** The changes being gathered for a new package, once the person has started some. */
let changes: PackageChanges | undefined;

function say(message: string): void {
  // Emptied first, so the same words said twice are still read out.
  status.textContent = "";
  window.setTimeout(() => (status.textContent = message), 50);
}

/** The window's title: the package open, then the program, as Windows shows it on the taskbar. */
function windowTitle(doc?: string): void {
  const title = doc ? `${doc} - OpenStage Package Doctor` : "OpenStage Package Doctor";
  document.title = title;
  if (isTauri()) getCurrentWindow().setTitle(title).catch(() => undefined);
}

/**
 * Before the package's waiting changes would be lost (another package opened, the start page, the window closed):
 * asks, unless every change is in a package already saved. True when it is all right to go on.
 */
async function mayForgetChanges(doing: string, yes: string): Promise<boolean> {
  if (!changes?.unsaved || !current) return true;
  const n = changes.changes.size;
  const one = n === 1;
  const them = one ? "it" : "them";
  return ask(
    one ? "Forget the change waiting to be saved?" : `Forget the ${n} changes waiting to be saved?`,
    `${one ? "The change" : `The ${n} changes`} to ${current.fileName} ${one ? "is" : "are"} not in a saved package yet. ${doing} forgets ${them}. To keep ${them}, choose Keep, then Save as a new package in Change the package.`,
    yes,
    "Keep",
  );
}

/** Opens bytes as a package, once any waiting changes may be forgotten. */
async function openBytesAsked(bytes: Uint8Array, name: string): Promise<void> {
  if (await mayForgetChanges(`Opening ${name}`, "Forget and open")) openBytes(bytes, name);
}

function welcome(): void {
  current = undefined;
  archive = undefined;
  playSession = undefined;
  changes = undefined;
  shellDoc.textContent = "";
  homeButton.hidden = true;
  windowTitle();
  copyButton.disabled = true;
  const button = h("button", { type: "button", class: "button button--primary button--large" }, icon("open"), "Open a package...");
  button.addEventListener("click", () => fileInput.click());
  const wrapButton = h("button", { type: "button", class: "button" }, "Make a package from a PDF, a video or a folder...");
  wrapButton.addEventListener("click", () => {
    homeButton.hidden = false;
    openWrap({ main, say, back: () => welcome(), open: (bytes, name) => void openBytesAsked(bytes, name) });
  });
  main.replaceChildren(
    h(
      "section",
      { class: "welcome", "aria-labelledby": "welcome-title" },
      h("h1", { id: "welcome-title" }, "Open a course package"),
      h("p", {}, "A SCORM 1.2, SCORM 2004, xAPI or cmi5 package, as a .zip file. Package Doctor shows what is inside it and checks whether it will run in an LMS."),
      button,
      h("p", { class: "muted" }, "Or drop a .zip anywhere in this window. Ctrl+O also opens one."),
      h("p", { class: "muted" }, "The package is read on this computer and nothing is changed or uploaded."),
      h("h2", {}, "No package yet?"),
      h("p", {}, "Wrap a PDF, a video or a folder of web pages as a SCORM, cmi5 or xAPI package an LMS can import."),
      wrapButton,
      h("p", { class: "muted welcome-foot" }, `OpenStage Package Doctor${VERSION ? ` ${VERSION}` : ""}. Apache License 2.0. Part of the OpenStage suite.`),
    ),
  );
}

/** Opens a package that is already in memory: a file just read, or a package Package Doctor has just written. */
function openBytes(bytes: Uint8Array, name: string): void {
  const opened = openPackageSession(bytes, name);
  archive = opened.archive;
  playSession = undefined;
  changes = undefined;
  show(opened.report);
}

async function openFile(file: File): Promise<void> {
  if (!(await mayForgetChanges(`Opening ${file.name}`, "Forget and open"))) {
    say(`${file.name} was not opened. The changes are still waiting.`);
    return;
  }
  say(`Opening ${file.name}...`);
  main.setAttribute("aria-busy", "true");
  try {
    openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (e) {
    homeButton.hidden = false;
    main.replaceChildren(
      h("section", { class: "welcome" }, h("h1", { tabindex: "-1", id: "report-title" }, `${file.name} could not be opened`), h("p", {}, e instanceof Error ? e.message : String(e))),
    );
    document.getElementById("report-title")?.focus();
    say(`${file.name} could not be opened.`);
  } finally {
    main.removeAttribute("aria-busy");
  }
}

function show(r: OpenedPackage, focusSection?: string): void {
  current = r;
  copyButton.disabled = false;
  homeButton.hidden = false;
  shellDoc.textContent = r.fileName;
  windowTitle(r.fileName);
  const c = counts(r.findings);
  const state: Severity | "ok" = c.problem ? "problem" : c.warning ? "warning" : "ok";
  const stateWord = c.problem ? "Problems found" : c.warning ? "Warnings only" : "No problems found";
  const sections: { id: string; label: string; node: HTMLElement }[] = [];
  const section = (id: string, label: string, ...children: Child[]) => {
    const node = h("section", { class: "panel", id, "aria-labelledby": `${id}-h` }, h("h2", { id: `${id}-h` }, label), ...children);
    sections.push({ id, label, node });
  };

  // Will it run?
  const groups = SEVERITY_ORDER.filter((s) => r.findings.some((f) => f.severity === s)).map((s) => {
    const list = r.findings.filter((f) => f.severity === s);
    const heading = h("h3", {}, badge(s), ` ${SEVERITY_WORDS[s]}s (${list.length})`);
    const items = h("ul", { class: "findings", role: "list" }, ...list.map((f) => findingItem(f)));
    if (s === "note") return h("details", { class: "group" }, h("summary", {}, heading), items);
    return h("div", { class: "group" }, heading, items);
  });
  section("check", "Will it run?", h("p", { class: "lead" }, verdict(r)), ...groups);

  // Accessibility, checked with the suite's rules; it fills in when the check is done.
  const a11yBody = h("div", {});
  section("a11y", "Accessibility", a11yBody);
  fillAccessibility(r, a11yBody);

  // Package details and where it starts.
  const facts: [string, string][] = [
    ["Kind", r.kindLabel],
    ...(r.title ? [["Title", r.title] as [string, string]] : []),
    ...(r.identifier ? [["Identifier", r.identifier] as [string, string]] : []),
    ...(r.manifest ? [["Manifest", r.manifest] as [string, string]] : []),
    ["Size", `${formatBytes(r.zipSize)} as a zip, ${formatBytes(r.totals.size)} unpacked`],
    ["Files", String(r.totals.files)],
  ];
  section(
    "package",
    "Package",
    h("dl", { class: "facts" }, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    r.launches.length
      ? h(
          "div",
          {},
          h("h3", {}, r.launches.length === 1 ? "Starts at" : `Starts at (${r.launches.length} places)`),
          h(
            "ul",
            { class: "plain" },
            ...r.launches.map((l) =>
              h("li", {}, h("strong", {}, l.title), ": ", h("code", {}, l.href), l.tracked === false ? " (not tracked: an asset)" : "", l.file === undefined && !/^[a-z]+:/i.test(l.href) ? " (missing)" : ""),
            ),
          ),
        )
      : null,
  );

  // Trying it in the test player.
  const play = playables(r);
  if (play.standard && archive) {
    const button = h("button", { type: "button", class: "button button--primary" }, icon("play"), "Play it in the test player");
    const choose = play.playable.length > 1 ? h("select", { id: "play-part" }, ...play.playable.map((p) => h("option", { value: String(p.index) }, `${p.index + 1}. ${p.title}${p.tracked ? "" : " (asset)"}`))) : null;
    button.addEventListener("click", () => {
      playSession ??= new PlaySession(r, archive!, location.origin);
      void openPlayer(playSession, { main, say, archive, back: () => show(r, "play") }, choose ? Number(choose.value) : 0);
    });
    const earlier = playSession?.findings() ?? [];
    const runs = playSession?.log.filter((e) => e.kind === "launch").length ?? 0;
    section(
      "play",
      "Try it",
      h("p", {}, `Plays the course here as a ${STANDARD_WORDS[play.standard]} LMS would, and logs everything it tells the LMS: what an LMS would record, and what it would refuse. Nothing is uploaded.`),
      play.playable.length === 0 ? h("p", {}, "There is nothing to play: no start page is in the package.") : h("div", { class: "play-start" }, choose ? h("label", { class: "field" }, "Part ", choose) : null, button),
      play.skipped.length ? h("ul", { class: "plain" }, ...play.skipped.map((s) => h("li", {}, h("strong", {}, s.title), ` cannot be played here. ${s.why}`))) : null,
      runs ? h("p", { class: "muted" }, `So far the test player has launched it ${runs === 1 ? "once" : `${runs} times`} and found ${earlier.length === 0 ? "nothing" : earlier.length === 1 ? "one thing" : `${earlier.length} things`} to look at. They are listed beside the course in the player.`) : null,
    );
  }

  // Wrapping it: a zip of web pages that is not a course package yet.
  const pages = r.files.filter((f) => /\.html?$/i.test(f.path));
  if (archive && (r.kind === "unknown" || r.kind === "content-package") && pages.length) {
    const button = h("button", { type: "button", class: "button button--primary" }, "Wrap it as a course package...");
    button.addEventListener("click", () => {
      const files = new Map<string, Uint8Array>();
      for (const e of archive!.entries) {
        if (e.isDirectory || e.encrypted) continue;
        try {
          files.set(e.path, archive!.read(e));
        } catch {
          // a damaged file is left out; the report already says so
        }
      }
      openWrap({ main, say, back: () => show(r, "wrap"), open: (bytes, name) => void openBytesAsked(bytes, name) }, { kind: "site", name: r.fileName.replace(/\.zip$/i, ""), files });
    });
    section("wrap", "Wrap it", h("p", {}, `This zip has ${pages.length} web page${pages.length === 1 ? "" : "s"} but is not a course package an LMS can import. Package Doctor can wrap it as one: a SCORM, cmi5 or xAPI package that starts at the page you choose and tells the LMS when the learner has finished.`), h("div", { class: "play-start" }, button));
  }

  // Changing it.
  if (archive && r.files.length) {
    const button = h("button", { type: "button", class: "button" }, "Change the package...");
    button.addEventListener("click", () => {
      changes ??= new PackageChanges(r, archive!);
      openChanges(changes, { main, say, back: () => show(r, "change"), open: (bytes, name) => void openBytesAsked(bytes, name) });
    });
    const waiting = changes?.changes.size ?? 0;
    section(
      "change",
      "Change it",
      h("p", {}, "Make the package smaller (photographs, video, sound and text files), or replace any file in it. The changes are saved as a new package; this one is never changed."),
      h("div", { class: "play-start" }, button),
      waiting ? h("p", { class: "muted" }, `${waiting} change${waiting === 1 ? " is" : "s are"} waiting to be saved.`) : null,
    );
  }

  // Tracking settings.
  section(
    "tracking",
    "Tracking settings",
    r.tracking.length
      ? h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("caption", { class: "visually-hidden" }, "Tracking settings from the manifest"),
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Part"), h("th", { scope: "col" }, "Setting"), h("th", { scope: "col" }, "Value"), h("th", { scope: "col" }, "What it means"))),
            h(
              "tbody",
              {},
              ...r.tracking.map((t) =>
                h("tr", {}, h("td", {}, t.scope), h("th", { scope: "row" }, t.name), h("td", {}, t.value), h("td", {}, t.meaning, " ", h("span", { class: "muted" }, `(${t.source})`))),
              ),
            ),
          ),
        )
      : h("p", {}, noTrackingWords(r)),
  );

  // Outline.
  if (r.outline.length) section("outline", "Course outline", outlineList(r.outline));

  // Files.
  section("files", "Files", h("p", {}, `${r.totals.files} files, ${formatBytes(r.totals.size)} unpacked.`), filesTree(r));

  // Not checked.
  section("limits", "Not checked", h("ul", { class: "plain" }, ...r.limits.map((l) => h("li", {}, l))));

  const title = h("h1", { id: "report-title", tabindex: "-1" }, r.title ?? r.fileName);
  main.replaceChildren(
    h(
      "div",
      { class: "report" },
      h(
        "div",
        { class: "report-head" },
        title,
        h("p", { class: "muted" }, `${r.kindLabel} · ${r.fileName}`),
        h(
          "div",
          { class: `verdict verdict--${state}` },
          icon(state === "ok" ? "ok" : state),
          h("div", {}, h("strong", {}, stateWord), h("span", {}, `${c.problem} problem${c.problem === 1 ? "" : "s"}, ${c.warning} warning${c.warning === 1 ? "" : "s"}, ${c.note} note${c.note === 1 ? "" : "s"}`)),
        ),
        h("nav", { "aria-label": "Sections of the report", class: "toc" }, h("ul", { role: "list" }, ...sections.map((s) => h("li", {}, h("a", { href: `#${s.id}` }, s.label))))),
      ),
      ...sections.map((s) => s.node),
    ),
  );
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  if (focusSection) {
    // Back from the test player: to where the person left the report.
    const heading = document.getElementById(`${focusSection}-h`);
    heading?.setAttribute("tabindex", "-1");
    heading?.scrollIntoView();
    heading?.focus();
    say("Back to the report.");
    return;
  }
  title.focus();
  say(`Opened ${r.fileName}. ${verdict(r)}`);
}

function outlineList(nodes: OutlineNode[]): HTMLElement {
  return h(
    "ul",
    { class: "outline" },
    ...nodes.map((n) =>
      h(
        "li",
        {},
        h("span", { class: "outline-title" }, n.title),
        n.launches ? h("span", { class: "muted" }, " opens ", h("code", {}, n.launches)) : null,
        n.hidden ? h("span", { class: "muted" }, " (hidden from the menu)") : null,
        n.children.length ? outlineList(n.children) : null,
      ),
    ),
  );
}

function filesTree(r: OpenedPackage): HTMLElement {
  const root = buildTree(r.files);
  const starts = new Set(r.launches.map((l) => l.file).filter(Boolean));
  const fileRow = (path: string, name: string, size: number, packed: number) =>
    h(
      "li",
      { class: "file" },
      icon("file"),
      h("span", { class: "file-name" }, name),
      path === r.manifest ? h("span", { class: "tag" }, "manifest") : null,
      starts.has(path) ? h("span", { class: "tag" }, "start page") : null,
      h("span", { class: "file-size" }, formatBytes(size), packed < size ? h("span", { class: "muted" }, ` (${formatBytes(packed)} packed)`) : null),
    );
  const folderList = (folder: Folder): HTMLElement =>
    h(
      "ul",
      { class: "tree", role: "list" },
      ...folder.folders.map((sub) => {
        const details = h(
          "details",
          {},
          h("summary", {}, icon("folder"), h("span", { class: "file-name" }, sub.name), h("span", { class: "file-size" }, `${sub.fileCount} file${sub.fileCount === 1 ? "" : "s"}, ${formatBytes(sub.size)}`)),
        );
        // A folder's contents are drawn when it is first opened, so a package of thousands of files opens at once.
        details.addEventListener("toggle", () => {
          if (details.open && details.childElementCount === 1) details.append(folderList(sub));
        }, { once: false });
        return h("li", { class: "folder" }, details);
      }),
      ...folder.files.map((f) => fileRow(f.path, f.path.slice(f.path.lastIndexOf("/") + 1), f.size, f.packedSize)),
    );
  return folderList(root);
}

// The start page, from any view.
homeButton.addEventListener("click", async () => {
  if (!(await mayForgetChanges("Going to the start page", "Forget and go to the start page"))) return;
  welcome();
  const heading = document.getElementById("welcome-title");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
  say("The start page.");
});

// Closing the window with changes waiting: asked first. Nothing else stops the window closing.
if (isTauri()) {
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await mayForgetChanges("Closing Package Doctor", "Forget and close"))) event.preventDefault();
  });
}

// Focus never sits under the bar or the status line (WCAG 2.4.11). The style sheet's scroll padding does it where the
// browser scrolls to the focus itself; this covers focus that lands without a scroll.
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el === main || el.closest("dialog")) return;
  window.requestAnimationFrame(() => {
    const box = el.getBoundingClientRect();
    const top = getComputedStyle(shell).position === "sticky" ? shell.getBoundingClientRect().bottom + 8 : 8;
    const bottom = window.innerHeight - status.getBoundingClientRect().height - 8;
    if (box.height > bottom - top) return;
    if (box.bottom > bottom) window.scrollBy(0, box.bottom - bottom);
    else if (box.top < top) window.scrollBy(0, box.top - top);
  });
});

// Opening: the button, Ctrl+O, and dropping a file.
openButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openFile(file);
});
copyButton.addEventListener("click", async () => {
  if (!current) return;
  const check = a11yChecks.get(current);
  await copyText(reportText(current, VERSION || undefined) + (check ? a11yText(check) : ""));
  say("The report is copied. Paste it into an email or a document.");
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    fileInput.click();
  }
});
// Outside boxes for typing, the browser's own menu (Back, Reload, Print) never shows, as in the rest of the suite.
// Selected text can still be copied with Ctrl+C.
document.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
});

let dragDepth = 0;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropVeil.hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropVeil.hidden = true;
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropVeil.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) void openFile(file);
});

welcome();
