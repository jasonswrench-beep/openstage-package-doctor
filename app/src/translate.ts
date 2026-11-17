// The Translate part of Change the package: the package's words out to a translator, as XLIFF (for a translation tool)
// or a Word table, and the translation back in as changes, saved with the rest as a new package. A pseudo-translation
// shows in the test player which words were reached and which were not, before anyone translates anything.
// Accessibility: ordinary fields with labels and a list of common languages; the outcome in words in a status region
// and the status line; each piece of text that could not be put back is listed with why.

import { extractPackage, type Extraction } from "../../core/src/translate/extract.ts";
import { itemsFromMarked, readDocxTable, writeDocxTable } from "../../core/src/translate/docx.ts";
import { applyTranslations } from "../../core/src/translate/apply.ts";
import { plainText, TranslationError } from "../../core/src/translate/inline.ts";
import { checkLanguage, matchTranslations, pseudoItems, readXliff, writeXliff, type ReadUnit } from "../../core/src/translate/xliff.ts";
import { formatBytes } from "../../core/src/open.ts";
import { saveFile, type PackageChanges } from "./changes.ts";
import { h } from "./dom.ts";

const LANGUAGES: [string, string][] = [
  ["ar", "Arabic"], ["zh-CN", "Chinese (simplified)"], ["zh-TW", "Chinese (traditional)"], ["cs", "Czech"], ["da", "Danish"], ["nl", "Dutch"],
  ["en", "English"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["fi", "Finnish"], ["fr", "French"], ["fr-CA", "French (Canada)"],
  ["de", "German"], ["el", "Greek"], ["he", "Hebrew"], ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"], ["it", "Italian"],
  ["ja", "Japanese"], ["ko", "Korean"], ["nb", "Norwegian"], ["pl", "Polish"], ["pt-BR", "Portuguese (Brazil)"], ["pt-PT", "Portuguese (Portugal)"],
  ["ro", "Romanian"], ["ru", "Russian"], ["es", "Spanish"], ["es-MX", "Spanish (Mexico)"], ["sv", "Swedish"], ["th", "Thai"], ["tr", "Turkish"],
  ["uk", "Ukrainian"], ["vi", "Vietnamese"],
];

function baseName(fileName: string): string {
  return fileName.replace(/\.zip$/i, "");
}

export function translatePanel(state: PackageChanges, host: { say(message: string): void; changed(): void }): HTMLElement {
  const r = state.report;
  let extraction: Extraction | undefined;
  const extract = (): Extraction => (extraction ??= extractPackage(r, (p) => state.current(p)));
  const ex = extract();
  const count = ex.files.reduce((n, f) => n + f.units.length, 0);
  const words = ex.files.reduce((n, f) => n + f.units.reduce((m, u) => m + plainText(u.items).split(/\s+/).filter(Boolean).length, 0), 0);

  const listId = "translate-languages";
  const datalist = h("datalist", { id: listId }, ...LANGUAGES.map(([tag, name]) => h("option", { value: tag }, name)));
  const from = h("input", { type: "text", id: "translate-from", class: "text-input text-input--short", list: listId, value: ex.sourceLanguage ?? "en", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const to = h("input", { type: "text", id: "translate-to", class: "text-input text-input--short", list: listId, value: state.language ?? "", placeholder: "such as es or fr-CA", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const outcome = h("div", { role: "status" });

  const languages = (): [string, string] | null => {
    try {
      checkLanguage(from.value.trim(), "course's language");
      checkLanguage(to.value.trim(), "language to translate into");
      if (from.value.trim().toLowerCase() === to.value.trim().toLowerCase()) throw new TranslationError("The two languages are the same. Choose the language to translate into.");
      return [from.value.trim(), to.value.trim()];
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      outcome.replaceChildren(h("p", {}, message));
      host.say(message);
      (to.value.trim() ? from : to).focus();
      return null;
    }
  };

  const xliffButton = h("button", { type: "button", class: "button" }, "Save as XLIFF for a translation tool...");
  const docxButton = h("button", { type: "button", class: "button" }, "Save as a Word table...");
  const pseudoButton = h("button", { type: "button", class: "button" }, "Try a pseudo-translation");
  const backButton = h("button", { type: "button", class: "button button--primary" }, "Open the translated file...");
  const pick = h("input", { type: "file", accept: ".xlf,.xliff,.docx", hidden: true }) as HTMLInputElement;
  const disable = count === 0;
  for (const b of [xliffButton, docxButton, pseudoButton, backButton]) b.disabled = disable;

  xliffButton.addEventListener("click", async () => {
    const langs = languages();
    if (!langs) return;
    const text = writeXliff(r.fileName, extract(), langs[0], langs[1]);
    const name = await saveFile(new TextEncoder().encode(text), `${baseName(r.fileName)} (${langs[1]}).xlf`, { description: "XLIFF translation file", mime: "application/xliff+xml", ending: ".xlf" });
    if (name) {
      outcome.replaceChildren(h("p", {}, `Saved ${name}: ${count} pieces of text, about ${words} words, from ${langs[0]} into ${langs[1]}. Give it to the translator; when it comes back, open it with Open the translated file.`));
      host.say(`Saved ${name}.`);
    }
  });
  docxButton.addEventListener("click", async () => {
    const langs = languages();
    if (!langs) return;
    const bytes = writeDocxTable(r.fileName, extract(), langs[0], langs[1]);
    const name = await saveFile(bytes, `${baseName(r.fileName)} (${langs[1]}).docx`, { description: "Word document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ending: ".docx" });
    if (name) {
      outcome.replaceChildren(h("p", {}, `Saved ${name}: a table of ${count} pieces of text, about ${words} words. The translator writes in its Translation column and saves it as a Word file; then open it with Open the translated file.`));
      host.say(`Saved ${name}.`);
    }
  });

  /** Puts matched translations into the changes, one change per file. */
  const put = (translations: Map<string, import("../../core/src/translate/inline.ts").Item[]>, language: string, label: string): number => {
    const e = extract();
    for (const [path, c] of state.changes) if (c.translated) state.changes.delete(path);
    const applied = applyTranslations(e, translations, language);
    for (const [path, data] of applied.files) {
      const f = e.files.find((x) => x.path === path)!;
      const done = f.units.filter((u) => translations.has(u.id)).length;
      state.changes.set(path, { path, data, how: `${label} into ${language}: ${done} of ${f.units.length} pieces of text.`, before: state.size(path), translated: language });
    }
    state.language = language;
    host.changed();
    return applied.changed;
  };

  pseudoButton.addEventListener("click", () => {
    const langs = languages();
    if (!langs) return;
    const e = extract();
    const translations = new Map(e.files.flatMap((f) => f.units.map((u) => [u.id, pseudoItems(u.items)] as const)));
    const files = put(translations, langs[1], "Pseudo-translated");
    outcome.replaceChildren(
      h("p", {}, `Every piece of text that can be translated here is now accented, longer and in ⟦brackets⟧, in ${files} file${files === 1 ? "" : "s"}. Save it as a new package, open it and play it: any words still plain are words this does not reach, and text that runs out of its box shows what a longer language will do.`),
    );
    host.say("Pseudo-translation made. Save it as a new package and play it to see which words were reached.");
  });

  backButton.addEventListener("click", () => pick.click());
  pick.addEventListener("change", async () => {
    const file = pick.files?.[0];
    pick.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const e = extract();
    const units = e.files.flatMap((f) => f.units);
    try {
      let read: Map<string, ReadUnit>;
      let language: string | undefined;
      if (/\.docx$/i.test(file.name)) {
        const table = readDocxTable(bytes);
        language = table.targetLanguage;
        read = new Map();
        for (const [id, text] of table.rows) {
          const u = units.find((x) => x.id === id);
          if (u) read.set(id, { source: u.items, target: itemsFromMarked(text, u.items) });
        }
      } else {
        const x = readXliff(new TextDecoder().decode(bytes));
        language = x.targetLanguage;
        read = x.units;
      }
      language = language || to.value.trim();
      checkLanguage(language, "translation");
      to.value = language;
      const m = matchTranslations(units, read);
      if (!m.translated) {
        const message = `${file.name} has no translations Package Doctor can put back${m.kept.length ? `: ${m.kept.length} could not go back` : m.unknown ? ": its pieces of text are not this package's" : " yet"}.`;
        outcome.replaceChildren(h("p", {}, message));
        host.say(message);
        return;
      }
      const files = put(m.translations, language, "Translated");
      outcome.replaceChildren(
        ...([
        h("p", {}, h("strong", {}, `${m.translated} of ${units.length} pieces of text translated into ${language}`), `, in ${files} file${files === 1 ? "" : "s"}. ${m.untranslated ? `${m.untranslated} had no translation yet and stay in the original language. ` : ""}Nothing is saved until you choose Save as a new package.`),
        m.kept.length
          ? h(
              "div",
              {},
              h("p", {}, `${m.kept.length} could not be put back safely and stay in the original language:`),
              h("ul", { class: "plain" }, ...m.kept.slice(0, 50).map((k) => h("li", {}, h("code", {}, k.id), ` "${k.text.slice(0, 80)}": ${k.why}.`))),
              m.kept.length > 50 ? h("p", { class: "muted" }, `And ${m.kept.length - 50} more.`) : null,
            )
          : null,
        m.unknown ? h("p", { class: "muted" }, `${m.unknown} pieces of text in the file are not in this package and were left out.`) : null,
        ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => x !== null),
      );
      host.say(`${m.translated} pieces of text translated into ${language}${m.kept.length ? `; ${m.kept.length} could not be put back` : ""}.`);
    } catch (err) {
      const message = err instanceof TranslationError ? err.message : `${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}`;
      outcome.replaceChildren(h("p", {}, message));
      host.say(message);
    }
  });

  const reached = ex.files.length
    ? `${count} pieces of text, about ${words} words, in ${ex.files.length} file${ex.files.length === 1 ? "" : "s"}: ${[
        ex.files.some((f) => f.kind === "page") ? "the pages" : "",
        ex.files.some((f) => f.kind === "captions") ? "captions" : "",
        ex.files.some((f) => f.kind === "manifest") ? "the titles the LMS shows" : "",
      ].filter(Boolean).join(", ")}.`
    : "No words were found in the pages, captions or manifest.";

  return h(
    "section",
    { class: "panel", "aria-labelledby": "translate-h" },
    h("h2", { id: "translate-h" }, "Translate"),
    h("p", {}, `Words that can be translated here: ${reached}`),
    ex.notReached.length ? h("div", {}, h("p", {}, "Not reached here:"), h("ul", { class: "plain" }, ...ex.notReached.map((n) => h("li", {}, n)))) : null,
    h("p", { class: "muted" }, "The XLIFF file is OpenStage's own form of XLIFF 1.2, the same as OpenStage Author writes, and any translation tool can read it. The Word table is for a translator who works in Word. Either way the translation comes back here and is checked: a piece whose tags or placeholders were changed stays in the original language and is listed."),
    h(
      "div",
      { class: "play-start" },
      h("label", { class: "field", for: "translate-from" }, "The course is in"),
      from,
      h("label", { class: "field", for: "translate-to" }, "Translate into"),
      to,
      datalist,
    ),
    h("div", { class: "play-start" }, xliffButton, docxButton, pseudoButton),
    h("div", { class: "play-start" }, backButton, pick),
    outcome,
    h("p", { class: "muted" }, `The package's own size does not change much with a translation: the pages are ${formatBytes(ex.files.reduce((n, f) => n + (state.current(f.path)?.length ?? 0), 0))} in all.`),
  );
}
