# What Package Doctor asks of openstage-core

The shared pieces Package Doctor uses, and what it needs from the core. The core takes on what the author schedules.

## R1. C6, the translation layer

**Where it stands (2026-11-17).** C6 is in OpenStage Author (`tools/xliff.py`, Python) and OpenExplainer
(`src/translate/`, TypeScript), each its own code, and not scheduled for the core. The two write XLIFF 1.2 with
different inline tags: Author `bpt`, `ept` and `ph` whose content is the literal tag; OpenExplainer `g` and `x`.

**What Package Doctor did (0.5.0).** On the author's word it borrowed Author's form: `core/src/translate/inline.ts`
and `xliff.ts` port Author's `to_items`, `items_to_xml`, `items_from_element`, `canon` and `_markup_problem`, with the
same file layout (one `file`, a `group` per source file, `trans-unit` with `xml:space="preserve"` and `restype`, a
developer note), the same tag check on import, and the same refusal of a file with a document type. A file written
by either program reads the same in a translation tool.

**What it asks.** When C6 moves into the core:

1. One form of XLIFF 1.2 for the suite, written down (an XLIFF profile in `specs/`), with Author's inline tags as the
   starting point, since two tools now write them.
2. The inline part as a TypeScript package with no dependencies (items, to and from XLIFF, the tag and placeholder
   check), which Package Doctor would use in place of its `inline.ts` and `xliff.ts`. Its own `extract.ts` (words in
   any package's pages, captions and manifest), `docx.ts` (a Word table for translators) and `apply.ts` stay here,
   unless other tools want them too.
3. The Word table (`docx.ts`) is offered to the core as well: Author's review document has no table to translate in
   and reads nothing back.
