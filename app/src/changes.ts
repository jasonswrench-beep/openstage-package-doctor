// Changing a package: making it smaller, and replacing any file in it. Nothing here touches the zip that was opened.
// The changes are gathered here, and saved together as a new zip under a new name (core/src/write.ts), which can then
// be opened and checked like any other.
// Accessibility: the view is a section with its own heading and one heading per part; options are ordinary check boxes
// with their effect in words; the work's progress is a progress bar with its words beside it, and the status line
// says when it starts and ends (not every file, which would drown a screen reader).

import { formatBytes } from "../../core/src/open.ts";
import type { OpenedPackage } from "../../core/src/model.ts";
import { DEFAULT_SHRINK, KIND_WORDS, shrinkCandidates, worthKeeping, type ShrinkOptions, type ShrinkResult } from "../../core/src/media/shrink.ts";
import { shrinkWav } from "../../core/src/media/wav.ts";
import { writePackage } from "../../core/src/write.ts";
import type { ZipArchive } from "../../core/src/zip.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";
import { shrinkPicture, shrinkVideo, type Shrunk } from "./shrink.ts";

export interface ChangesHost {
  main: HTMLElement;
  say(message: string): void;
  back(): void;
  /** Opens a package from bytes, as if it had been opened from a file. */
  open(bytes: Uint8Array, name: string): void;
}

/** One change waiting to be saved. */
interface Change {
  path: string;
  data: Uint8Array;
  /** What was done, in words. */
  how: string;
  /** The file's size before. */
  before: number;
}

/** The changes for the package now open. They stay while the person goes back and forth to the report. */
export class PackageChanges {
  readonly report: OpenedPackage;
  readonly archive: ZipArchive;
  readonly changes = new Map<string, Change>();
  options: ShrinkOptions = { ...DEFAULT_SHRINK };
  results: ShrinkResult[] = [];
  savedAs = "";
  private saved?: Uint8Array;

  constructor(report: OpenedPackage, archive: ZipArchive) {
    this.report = report;
    this.archive = archive;
  }

  size(path: string): number {
    return this.report.files.find((f) => f.path === path)?.size ?? 0;
  }

  write(): Uint8Array {
    const replace = new Map([...this.changes].map(([p, c]) => [p, c.data]));
    return writePackage(this.archive, replace, { repackText: this.options.text }).bytes;
  }

  rememberSaved(bytes: Uint8Array, name: string): void {
    this.saved = bytes;
    this.savedAs = name;
  }
  get savedBytes(): Uint8Array | undefined {
    return this.saved;
  }
}

function baseName(fileName: string): string {
  return fileName.replace(/\.zip$/i, "");
}

/** Saves bytes with the window's Save As box, or as a download where it has none. Returns the name, or "" if not saved. */
async function saveZip(bytes: Uint8Array, suggested: string): Promise<string> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: suggested, types: [{ description: "Course package (zip)", accept: { "application/zip": [".zip"] } }] });
      const writable = await handle.createWritable();
      await writable.write(bytes as BlobPart);
      await writable.close();
      return handle.name;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "";
      // Some windows have the box but refuse it; fall through to a download.
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = h("a", { href: url, download: suggested });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return suggested;
}

export function openChanges(state: PackageChanges, host: ChangesHost): void {
  const r = state.report;
  let running = false;
  let stop = false;

  const title = h("h1", { id: "changes-title", tabindex: "-1" }, "Change the package");
  const backButton = h("button", { type: "button", class: "button" }, "Back to the report");
  backButton.addEventListener("click", () => {
    if (running) stop = true;
    host.back();
  });

  // ---- make it smaller
  const o = state.options;
  const box = (label: string, detail: string, checked: boolean, change: (v: boolean) => void, ...extra: (HTMLElement | string)[]) => {
    const input = h("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener("change", () => {
      change(input.checked);
      drawSummary();
    });
    // The check box's label is only its name; the figures beside it have names of their own.
    return h("div", { class: "option" }, h("div", { class: "option-label" }, h("label", {}, input, " ", h("strong", {}, label)), ...extra), h("p", { class: "muted option-detail" }, detail));
  };
  const number = (value: number, min: number, max: number, step: number, label: string, change: (v: number) => void) => {
    const input = h("input", { type: "number", min: String(min), max: String(max), step: String(step), value: String(value), class: "number", "aria-label": label }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= min && v <= max) change(v);
      else input.value = String(value);
      drawSummary();
    });
    return input;
  };
  const options = h(
    "fieldset",
    { class: "options" },
    h("legend", {}, "What to make smaller"),
    box("Photographs (JPEG and WebP)", "Saved again a little smaller, and made smaller if wider or taller than the limit. PNG and GIF pictures, and pictures a script cuts up (a sprite sheet or atlas), are left as they are.", o.pictures, (v) => (o.pictures = v), ": no wider or taller than ", number(o.maxSide, 320, 8000, 10, "Largest width or height of a photograph, in pixels", (v) => (o.maxSide = v)), " pixels, quality ", number(Math.round(o.quality * 100), 40, 100, 1, "Photograph quality, from 40 to 100", (v) => (o.quality = v / 100))),
    box("Video (MP4)", "Encoded again as H.264, with its sound copied as it is. This takes a while: about as long as the video lasts, often less.", o.video, (v) => (o.video = v), ": no taller than ", number(o.videoHeight, 240, 2160, 2, "Largest video height, in pixels", (v) => (o.videoHeight = v)), " pixels, about ", number(o.videoBitrate / 1e6, 0.3, 20, 0.1, "Video bit rate, in megabits a second", (v) => (o.videoBitrate = Math.round(v * 1e6))), " megabits a second"),
    box("Sound (WAV)", "One channel at 22,050 samples a second, a quarter of the size. Speech stays clear; music loses its top notes. MP3 and other packed sound is left as it is.", o.sound, (v) => (o.sound = v)),
    box("Pages, scripts, style sheets and fonts", "Packed again as tightly as a zip allows. Nothing in them changes. This happens when the package is saved.", o.text, (v) => (o.text = v)),
  );
  const summary = h("p", {});
  const shrinkButton = h("button", { type: "button", class: "button button--primary" }, "Make it smaller");
  const stopButton = h("button", { type: "button", class: "button", hidden: true }, "Stop");
  const bar = h("progress", { max: "1", value: "0", hidden: true, "aria-label": "How far along" }) as HTMLProgressElement;
  const barWords = h("span", { id: "shrink-progress-words", class: "muted" });
  const results = h("div", {});

  function drawSummary(): void {
    const list = shrinkCandidates(r, o);
    const total = list.reduce((n, c) => n + c.size, 0);
    summary.textContent = list.length
      ? `${list.length} file${list.length === 1 ? "" : "s"} to try, ${formatBytes(total)} in all. A file is only replaced if the new one is at least a tenth smaller.`
      : o.text
        ? "No pictures, videos or sounds to try with these choices. Text files are still packed again when the package is saved."
        : "Nothing to try with these choices.";
    shrinkButton.disabled = running || list.length === 0;
  }

  function drawResults(): void {
    if (!state.results.length) {
      results.replaceChildren();
      return;
    }
    const kept = state.results.filter((x) => x.kept);
    const saved = kept.reduce((n, x) => n + x.before - x.after, 0);
    results.replaceChildren(
      h("h3", {}, "What was made smaller"),
      h("p", {}, `${kept.length} of ${state.results.length} files made smaller, saving ${formatBytes(saved)}.`),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "File"), h("th", { scope: "col" }, "Kind"), h("th", { scope: "col" }, "Before"), h("th", { scope: "col" }, "After"), h("th", { scope: "col" }, "Result"))),
          h(
            "tbody",
            {},
            ...state.results.map((x) =>
              h("tr", {}, h("th", { scope: "row" }, h("code", {}, x.path)), h("td", {}, KIND_WORDS[x.kind]), h("td", {}, formatBytes(x.before)), h("td", {}, x.after ? formatBytes(x.after) : "—"), h("td", {}, h("strong", {}, x.kept ? "Smaller. " : "Left as it was. "), x.note)),
            ),
          ),
        ),
      ),
    );
  }

  shrinkButton.addEventListener("click", async () => {
    const list = shrinkCandidates(r, o).filter((c) => !state.changes.has(c.path));
    if (!list.length) return;
    running = true;
    stop = false;
    shrinkButton.disabled = true;
    stopButton.hidden = false;
    bar.hidden = false;
    state.results = state.results.filter((x) => !list.some((c) => c.path === x.path));
    const entries = new Map(state.archive.entries.map((e) => [e.path, e]));
    const total = list.reduce((n, c) => n + c.size, 0);
    let done = 0;
    host.say(`Making ${list.length} file${list.length === 1 ? "" : "s"} smaller. This can take a while.`);
    for (const c of list) {
      if (stop) break;
      barWords.textContent = `${c.path} (${formatBytes(c.size)})`;
      let result: Shrunk;
      try {
        const bytes = state.archive.read(entries.get(c.path)!);
        if (c.kind === "picture") result = await shrinkPicture(c.path, bytes, o);
        else if (c.kind === "sound") {
          const data = shrinkWav(bytes);
          result = { data, note: data ? "One channel at 22,050 samples a second." : "Already this small, or not a WAV this can read." };
        } else result = await shrinkVideo(bytes, o, (f) => (bar.value = (done + f * c.size) / total), () => stop);
      } catch (e) {
        result = { data: null, note: e instanceof Error ? e.message : String(e) };
      }
      const after = result.data?.length ?? 0;
      const kept = result.data !== null && worthKeeping(c.size, after);
      const note = result.data && !kept ? `${result.note} It saved less than a tenth, so the original is kept.` : result.note;
      state.results.push({ path: c.path, kind: c.kind, before: c.size, after, kept, note });
      if (kept) state.changes.set(c.path, { path: c.path, data: result.data!, how: `Made smaller: ${result.note}`, before: c.size });
      done += c.size;
      bar.value = done / total;
      drawResults();
      drawChanges();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    running = false;
    stopButton.hidden = true;
    bar.hidden = true;
    barWords.textContent = "";
    drawSummary();
    drawChanges();
    const kept = state.results.filter((x) => x.kept);
    host.say(stop ? `Stopped. ${kept.length} files were made smaller before that.` : `Done. ${kept.length} of ${state.results.length} files made smaller, saving ${formatBytes(kept.reduce((n, x) => n + x.before - x.after, 0))}. Nothing is saved until you choose Save as a new package.`);
  });
  stopButton.addEventListener("click", () => {
    stop = true;
    host.say("Stopping after the file in hand.");
  });

  // ---- replace a file
  const paths = r.files.filter((f) => !f.path.endsWith("/")).map((f) => f.path);
  const listId = "package-file-list";
  const which = h("input", { type: "text", id: "replace-which", list: listId, class: "text-input", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const datalist = h("datalist", { id: listId }, ...paths.map((p) => h("option", { value: p })));
  const pickNew = h("input", { type: "file", hidden: true }) as HTMLInputElement;
  const replaceButton = h("button", { type: "button", class: "button" }, "Choose the new file...");
  const replaceNote = h("p", { class: "muted", id: "replace-note", "aria-live": "polite" });
  replaceButton.addEventListener("click", () => {
    const path = which.value.trim();
    if (!paths.includes(path)) {
      replaceNote.textContent = path ? `${path} is not a file in this package. Type part of a name and pick it from the list.` : "First type or pick the file in the package to replace.";
      which.focus();
      return;
    }
    pickNew.click();
  });
  pickNew.addEventListener("change", async () => {
    const file = pickNew.files?.[0];
    pickNew.value = "";
    if (!file) return;
    const path = which.value.trim();
    const data = new Uint8Array(await file.arrayBuffer());
    const oldExt = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const newExt = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
    state.changes.set(path, { path, data, how: `Replaced with ${file.name} (${formatBytes(data.length)}).`, before: state.size(path) });
    state.results = state.results.filter((x) => x.path !== path);
    drawChanges();
    drawResults();
    const warn = oldExt !== newExt ? ` Note: ${file.name} is a .${newExt || "(no ending)"} file, and it takes the name ${path}. The course will treat it as a .${oldExt} file, so it may not work if the two kinds differ.` : "";
    replaceNote.textContent = `${path} will be replaced with ${file.name} when the package is saved.${warn}`;
    host.say(`${path} will be replaced.${warn}`);
    which.value = "";
  });

  // ---- the changes, and saving
  const changesList = h("ul", { class: "changes", role: "list" });
  const changesHeading = h("h2", { id: "changes-list-h" }, "Changes to save");
  const sizeLine = h("p", {});
  const saveButton = h("button", { type: "button", class: "button button--primary" }, icon("save"), "Save as a new package...");
  const savedLine = h("div", { class: "saved", "aria-live": "polite" });

  function drawChanges(): void {
    const list = [...state.changes.values()];
    changesHeading.textContent = `Changes to save (${list.length})`;
    changesList.replaceChildren(
      ...(list.length
        ? list.map((c) => {
            const undo = h("button", { type: "button", class: "button button--small" }, "Undo");
            undo.setAttribute("aria-label", `Undo the change to ${c.path}`);
            undo.addEventListener("click", () => {
              state.changes.delete(c.path);
              state.results = state.results.filter((x) => x.path !== c.path);
              drawChanges();
              drawResults();
              drawSummary();
              host.say(`The change to ${c.path} is undone.`);
            });
            return h("li", { class: "change" }, h("div", {}, h("code", {}, c.path), h("p", { class: "muted" }, `${c.how} ${formatBytes(c.before)} before, ${formatBytes(c.data.length)} after.`)), undo);
          })
        : [h("li", { class: "muted" }, o.text ? "No files changed yet. Saving now would only pack the text files more tightly." : "No changes yet.")]),
    );
    const before = r.files.reduce((n, f) => n + f.size, 0);
    const after = before + list.reduce((n, c) => n + c.data.length - c.before, 0);
    sizeLine.textContent = `Unpacked, the package is ${formatBytes(before)} now and will be about ${formatBytes(after)}. The zip itself is ${formatBytes(r.zipSize)} now; its new size is known once it is saved.`;
    saveButton.disabled = running || (list.length === 0 && !o.text);
  }

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    host.say("Writing the new package...");
    let bytes: Uint8Array;
    try {
      bytes = state.write();
    } catch (e) {
      host.say(e instanceof Error ? e.message : String(e));
      saveButton.disabled = false;
      return;
    }
    const suggested = `${baseName(r.fileName)} (changed).zip`;
    const name = await saveZip(bytes, suggested);
    saveButton.disabled = false;
    if (!name) {
      host.say("Not saved.");
      return;
    }
    state.rememberSaved(bytes, name);
    const openButton = h("button", { type: "button", class: "button" }, "Open the new package to check it");
    openButton.addEventListener("click", () => host.open(bytes, name));
    savedLine.replaceChildren(h("p", {}, h("strong", {}, `Saved as ${name}, `), `${formatBytes(bytes.length)} (the opened package was ${formatBytes(r.zipSize)}). ${r.fileName} is unchanged.`), openButton);
    host.say(`Saved as ${name}, ${formatBytes(bytes.length)}.`);
  });

  host.main.replaceChildren(
    h(
      "section",
      { class: "changes-view", "aria-labelledby": "changes-title" },
      h("div", { class: "player-head" }, title, h("p", { class: "muted" }, `Nothing here changes ${r.fileName}. The changes are saved together as a new package, under a new name.`), h("div", { class: "player-tools" }, backButton)),
      h(
        "section",
        { class: "panel", "aria-labelledby": "shrink-h" },
        h("h2", { id: "shrink-h" }, "Make it smaller"),
        options,
        summary,
        h("div", { class: "play-start" }, shrinkButton, stopButton, bar, barWords),
        results,
      ),
      h(
        "section",
        { class: "panel", "aria-labelledby": "replace-h" },
        h("h2", { id: "replace-h" }, "Replace a file"),
        h("p", {}, "The new file takes the old one's name and place, so the course finds it where it found the old one. Choose one of the same kind: a picture for a picture, a page for a page."),
        h("div", { class: "play-start" }, h("label", { class: "field", for: "replace-which" }, "File in the package"), which, datalist, replaceButton, pickNew),
        replaceNote,
      ),
      h("section", { class: "panel", "aria-labelledby": "changes-list-h" }, changesHeading, changesList, sizeLine, h("div", { class: "play-start" }, saveButton), savedLine),
    ),
  );
  drawSummary();
  drawResults();
  drawChanges();
  if (state.savedAs && state.savedBytes) {
    const bytes = state.savedBytes;
    const openButton = h("button", { type: "button", class: "button" }, "Open the new package to check it");
    openButton.addEventListener("click", () => host.open(bytes, state.savedAs));
    savedLine.replaceChildren(h("p", {}, `Last saved as ${state.savedAs}.`), openButton);
  }
  title.focus();
  host.say("Change the package. Nothing is changed until you save a new package.");
}
