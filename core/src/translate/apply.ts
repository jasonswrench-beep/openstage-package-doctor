// Puts a translation back: each file with translated words is rebuilt with them in place, and a page's language is set
// to the new one. The result is a set of replaced files, which write.ts makes into a new package; the package that was
// opened is never changed. A piece of text that cannot be put back safely stays in the original language and is
// listed (xliff.ts matchTranslations says why).

import type { Extraction } from "./extract.ts";
import type { Item } from "./inline.ts";

export interface Applied {
  /** Path to the file's new bytes, for every file with something translated. */
  files: Map<string, Uint8Array>;
  /** How many files changed. */
  changed: number;
}

export function applyTranslations(extraction: Extraction, translations: ReadonlyMap<string, Item[]>, language: string): Applied {
  const files = new Map<string, Uint8Array>();
  for (const f of extraction.files) {
    if (!f.units.some((u) => translations.has(u.id))) continue;
    files.set(f.path, f.rebuild(translations, f.kind === "page" ? language : undefined));
  }
  return { files, changed: files.size };
}
