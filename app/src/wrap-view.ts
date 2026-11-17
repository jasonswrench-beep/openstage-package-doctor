// Make a course package: wraps a PDF, a video or a folder of web pages so an LMS can import it, with a start page, the
// tracking for the chosen standard and the manifest (core/src/wrap). The new package can be opened at once, to check
// it and play it in the test player like any other.
// Accessibility: one heading, then three groups, each a fieldset with a legend; choices are radio buttons with their
// meaning in words; what was chosen is said in words; the outcome goes to the status line.

import { formatBytes } from "../../core/src/open.ts";
import type { WrapStandard } from "../../core/src/wrap/manifests.ts";
import { titleFromName, VIDEO_TYPES, wrapPackage, type WrapKind } from "../../core/src/wrap/wrap.ts";
import { saveFile } from "./changes.ts";
import { h } from "./dom.ts";
import { LANGUAGES } from "./translate.ts";

export interface WrapHost {
  main: HTMLElement;
  say(message: string): void;
  back(): void;
  open(bytes: Uint8Array, name: string): void;
}

/** What is to be wrapped, when it comes from somewhere other than the pickers (a zip of web pages, say). */
export interface WrapStart {
  kind: WrapKind;
  name: string;
  files: Map<string, Uint8Array>;
}

const STANDARDS: [WrapStandard, string, string][] = [
  ["scorm12", "SCORM 1.2", "Works in almost every LMS. The usual choice."],
  ["scorm2004", "SCORM 2004 (4th edition)", "For an LMS that asks for SCORM 2004."],
  ["cmi5", "cmi5", "For an LMS that supports cmi5; it records to the LMS's learning record store."],
  ["xapi", "xAPI (Tin Can)", "For a learning record store or an LMS that launches xAPI packages."],
];

function radios<T extends string>(name: string, choices: [T, string, string][], value: T, change: (v: T) => void): HTMLElement[] {
  return choices.map(([v, label, detail]) => {
    const input = h("input", { type: "radio", name, value: v, id: `${name}-${v}` }) as HTMLInputElement;
    input.checked = v === value;
    input.addEventListener("change", () => input.checked && change(v));
    return h("div", { class: "option" }, h("label", { class: "option-label", for: `${name}-${v}` }, input, " ", h("strong", {}, label)), h("p", { class: "muted option-detail" }, detail));
  });
}

export function openWrap(host: WrapHost, from?: WrapStart): void {
  let kind: WrapKind | undefined = from?.kind;
  let files = from?.files ?? new Map<string, Uint8Array>();
  let main = "";
  let captions: string | undefined;
  let standard: WrapStandard = "scorm12";
  let complete: "open" | "button" | "end" = "button";

  const title = h("h1", { id: "wrap-title", tabindex: "-1" }, "Make a course package");
  const backButton = h("button", { type: "button", class: "button" }, from ? "Back to the report" : "Back");
  backButton.addEventListener("click", () => host.back());

  // ---- 1. what to wrap
  const pickPdf = h("input", { type: "file", accept: ".pdf,application/pdf", hidden: true }) as HTMLInputElement;
  const pickVideo = h("input", { type: "file", accept: Object.keys(VIDEO_TYPES).map((e) => `.${e}`).join(","), hidden: true }) as HTMLInputElement;
  const pickFolder = h("input", { type: "file", hidden: true, multiple: true }) as HTMLInputElement;
  pickFolder.setAttribute("webkitdirectory", "");
  const pickCaptions = h("input", { type: "file", accept: ".vtt,text/vtt", hidden: true }) as HTMLInputElement;
  const chosen = h("p", { "aria-live": "polite" });
  const startRow = h("div", { class: "play-start", hidden: true });
  const startSelect = h("select", { id: "wrap-start" });
  const captionsRow = h("div", { class: "play-start", hidden: true });
  const captionsWords = h("span", { class: "muted" }, "None chosen.");
  const pdfButton = h("button", { type: "button", class: "button" }, "Choose a PDF...");
  const videoButton = h("button", { type: "button", class: "button" }, "Choose a video...");
  const folderButton = h("button", { type: "button", class: "button" }, "Choose a folder of web pages...");
  const captionsButton = h("button", { type: "button", class: "button" }, "Choose a captions file (WebVTT)...");
  pdfButton.addEventListener("click", () => pickPdf.click());
  videoButton.addEventListener("click", () => pickVideo.click());
  folderButton.addEventListener("click", () => pickFolder.click());
  captionsButton.addEventListener("click", () => pickCaptions.click());

  const titleInput = h("input", { type: "text", id: "wrap-name", class: "text-input" }) as HTMLInputElement;
  const listId = "wrap-languages";
  const languageInput = h("input", { type: "text", id: "wrap-language", class: "text-input text-input--short", list: listId, value: "en", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const descriptionInput = h("input", { type: "text", id: "wrap-description", class: "text-input" }) as HTMLInputElement;
  const completeGroup = h("div", {});
  const makeButton = h("button", { type: "button", class: "button button--primary", disabled: true }, "Make the package...");
  const outcome = h("div", { role: "status" });

  function drawComplete(): void {
    const choices: ["open" | "button" | "end", string, string][] = [
      ["open", "As soon as it is opened", "The LMS records it as completed when the learner opens it."],
      ["button", "When the learner presses I have finished", "The start page has an I have finished button; the LMS records it as completed when it is pressed."],
    ];
    if (kind === "video") choices.push(["end", "When the video has been watched to the end", "Completed when the learner reaches the last part of the video. A learner who leaves early carries on where they stopped (SCORM)."]);
    if (!choices.some(([v]) => v === complete)) complete = kind === "video" ? "end" : "button";
    completeGroup.replaceChildren(...radios("wrap-complete", choices, complete, (v) => (complete = v)));
  }

  function choose(k: WrapKind, map: Map<string, Uint8Array>, name: string): void {
    kind = k;
    files = map;
    captions = undefined;
    captionsWords.textContent = "None chosen.";
    const total = [...map.values()].reduce((n, b) => n + b.length, 0);
    if (k === "site") {
      const pages = [...map.keys()].filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
      main = pages.find((p) => /^index\.html?$/i.test(p)) ?? pages[0] ?? "";
      startSelect.replaceChildren(...pages.map((p) => h("option", { value: p }, p)));
      startSelect.value = main;
      startRow.hidden = pages.length === 0;
      chosen.textContent = pages.length ? `${name}: ${map.size} files, ${formatBytes(total)}, ${pages.length} web page${pages.length === 1 ? "" : "s"}.` : `${name} has no web pages (.html) in it, so there is nothing to start at.`;
    } else {
      main = [...map.keys()][0]!;
      startRow.hidden = true;
      chosen.textContent = `${main}, ${formatBytes(total)}.`;
    }
    captionsRow.hidden = k !== "video";
    if (!titleInput.value || titleInput.dataset.auto === "yes") {
      titleInput.value = titleFromName(name);
      titleInput.dataset.auto = "yes";
    }
    drawComplete();
    makeButton.disabled = !main;
    outcome.replaceChildren();
    host.say(chosen.textContent);
  }

  const one = async (input: HTMLInputElement, k: WrapKind) => {
    const f = input.files?.[0];
    input.value = "";
    if (f) choose(k, new Map([[f.name, new Uint8Array(await f.arrayBuffer())]]), f.name);
  };
  pickPdf.addEventListener("change", () => void one(pickPdf, "pdf"));
  pickVideo.addEventListener("change", () => void one(pickVideo, "video"));
  pickFolder.addEventListener("change", async () => {
    const list = [...(pickFolder.files ?? [])];
    pickFolder.value = "";
    if (!list.length) return;
    const map = new Map<string, Uint8Array>();
    const top = (list[0]!.webkitRelativePath || list[0]!.name).split("/")[0] ?? "folder";
    for (const f of list) {
      const rel = (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
      if (/(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/i.test(rel)) continue;
      map.set(rel, new Uint8Array(await f.arrayBuffer()));
    }
    choose("site", map, top);
  });
  pickCaptions.addEventListener("change", async () => {
    const f = pickCaptions.files?.[0];
    pickCaptions.value = "";
    if (!f || kind !== "video") return;
    for (const p of [...files.keys()]) if (p !== main) files.delete(p);
    files.set(f.name, new Uint8Array(await f.arrayBuffer()));
    captions = f.name;
    captionsWords.textContent = `${f.name}, in the language below.`;
    host.say(`Captions: ${f.name}.`);
  });
  startSelect.addEventListener("change", () => (main = startSelect.value));
  titleInput.addEventListener("input", () => (titleInput.dataset.auto = "no"));

  makeButton.addEventListener("click", async () => {
    if (!kind || !main) return;
    const language = languageInput.value.trim();
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) {
      outcome.replaceChildren(h("p", {}, `"${language}" is not a language tag. Use one such as en, en-US or fr.`));
      languageInput.focus();
      return;
    }
    if (!titleInput.value.trim()) {
      outcome.replaceChildren(h("p", {}, "The package needs a title: the name the LMS shows."));
      titleInput.focus();
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = wrapPackage({
        kind,
        title: titleInput.value.trim(),
        description: descriptionInput.value,
        language,
        standard,
        complete,
        files,
        main,
        captions: captions ? { path: captions, language, label: LANGUAGES.find(([t]) => t.toLowerCase() === language.toLowerCase())?.[1] ?? language } : undefined,
      }).bytes;
    } catch (e) {
      outcome.replaceChildren(h("p", {}, e instanceof Error ? e.message : String(e)));
      return;
    }
    const name = await saveFile(bytes, `${titleInput.value.trim().replace(/[\\/:*?"<>|]+/g, " ")}.zip`);
    if (!name) {
      host.say("Not saved.");
      return;
    }
    const openButton = h("button", { type: "button", class: "button" }, "Open it to check it and play it");
    openButton.addEventListener("click", () => host.open(bytes, name));
    outcome.replaceChildren(h("p", {}, h("strong", {}, `Saved as ${name}`), `, ${formatBytes(bytes.length)}, a ${STANDARDS.find(([s]) => s === standard)![1]} package.`), openButton);
    host.say(`Saved as ${name}.`);
  });

  host.main.replaceChildren(
    h(
      "section",
      { class: "changes-view", "aria-labelledby": "wrap-title" },
      h("div", { class: "player-head" }, title, h("p", { class: "muted" }, "Wraps a PDF, a video or a folder of web pages so an LMS can import it and record that the learner finished it. The files themselves are not changed."), h("div", { class: "player-tools" }, backButton)),
      h(
        "fieldset",
        { class: "panel options" },
        h("legend", {}, "What to wrap"),
        from ? null : h("div", { class: "play-start" }, pdfButton, videoButton, folderButton, pickPdf, pickVideo, pickFolder),
        chosen,
        h("div", {}, startRow),
        captionsRow,
      ),
      h(
        "fieldset",
        { class: "panel options" },
        h("legend", {}, "About it"),
        h("div", { class: "play-start" }, h("label", { class: "field", for: "wrap-name" }, "Title"), titleInput),
        h("div", { class: "play-start" }, h("label", { class: "field", for: "wrap-language" }, "Language"), languageInput, h("datalist", { id: listId }, ...LANGUAGES.map(([t, n]) => h("option", { value: t }, n)))),
        h("div", { class: "play-start" }, h("label", { class: "field", for: "wrap-description" }, "Description (optional)"), descriptionInput),
      ),
      h(
        "fieldset",
        { class: "panel options" },
        h("legend", {}, "For the LMS"),
        ...radios("wrap-standard", STANDARDS, standard, (v) => (standard = v)),
        h("fieldset", { class: "options options--inner" }, h("legend", {}, "When it counts as finished"), completeGroup),
      ),
      h("div", { class: "panel" }, h("div", { class: "play-start" }, makeButton), outcome),
    ),
  );
  startRow.append(h("label", { class: "field", for: "wrap-start" }, "Start page"), startSelect);
  captionsRow.append(captionsButton, pickCaptions, captionsWords);
  drawComplete();
  if (from) choose(from.kind, from.files, from.name);
  title.focus();
  host.say("Make a course package.");
}
