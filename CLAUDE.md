# OpenStage Package Doctor

A small standalone tool in the OpenStage suite. It opens any course package (SCORM 1.2, SCORM 2004, xAPI, cmi5)
without its source file, checks whether it will run, and in later versions plays it with a tracking log and repairs
it. It brings new people into the suite through OpenStage Hub. Apache 2.0.

The build order is the **OpenStage Package Doctor Development List** (November 15, 2026), copied into `ROADMAP.md`.
Anything not on `ROADMAP.md` is agreed with the user first.

## Layout

- `core/`: TypeScript, run directly by Node (22.18 or later, type stripping), bundled into the window by esbuild.
  Reading the zip (`zip.ts`), XML (`xml.ts`), the three manifests (`scorm.ts`, `cmi5.ts`), links (`links.ts`), putting
  it together (`open.ts`), the text report (`report.ts`) and the command line (`cli.ts`). Every finding's words are in
  `findings.ts`. The test player's parts are in `core/src/play/`: the stand-in SCORM 1.2 and 2004 LMSs
  (`scorm12.ts`, `scorm2004.ts`), the stand-in LRS (`lrs.ts`), cmi5's launch and rules (`cmi5.ts`), and the sitting
  that serves the files and keeps the log (`session.ts`). They are as strict as the standards, so a value one LMS
  accepts and another refuses shows as refused, with the reason. Writing a new package is `write.ts` (files not
  changed are copied exactly as stored); `media/shrink.ts` chooses what to make smaller and `media/wav.ts` does WAV
  sound. Translation is `translate/`: `inline.ts` and `xliff.ts` are OpenStage Author's XLIFF 1.2 form (its
  `tools/xliff.py`), ported to TypeScript so both programs write the same thing; `extract.ts` finds the words in any
  package's pages, captions and manifest and rebuilds each file byte for byte except the words (in its own
  encoding); `docx.ts` is the Word table; `apply.ts` puts a translation back.
- `app/`: the Tauri window. `src/main.ts` draws the report and `src/player.ts` the test player. The Rust side
  (`src-tauri/`) is the window and one command, `check_accessibility` (`src-tauri/src/a11y.rs`): the page sends it
  the package's pages, style sheets and documents in one message (`src/a11y.ts`, `packMessage`), and it runs the
  suite's engine, `openstage-a11y` at tag `a11y-v0.1.0`, on them in memory with the engine's public parts (its own
  folder check reads only from disk). `cargo test` in `src-tauri` tests it; RUN TESTS.bat runs it too. The test
  player's "Check this page's accessibility" sends the page as it is now, without its scripts. `src/player-sw.ts` is a service worker (scope `/play/`) that hands each request a
  course makes to the window over a BroadcastChannel; the window answers from the zip. This keeps the course on the
  window's own site, which SCORM needs (the course looks for `window.API` in the windows above it), with no Rust.
  `src/changes.ts` is the Change the package view and `src/shrink.ts` makes pictures and MP4 video smaller with the
  browser's own codecs (WebCodecs), reading MP4 with mp4box.js and writing it with mp4-muxer. No ffmpeg: it is LGPL
  or GPL. Saving uses the window's Save As box (`showSaveFilePicker`); WebView2 will not save into system folders
  such as AppData.
- `branding/OpenStage_Package_Doctor.svg` is the program's icon (the author's, November 17, 2026). `app/web/logo.svg`
  is a copy of it, and `app/src-tauri/icons/` is made from it with `npx tauri icon` (then delete the android and ios
  folders it adds).
- `docs/checks.md` is generated from `core/src/findings.ts` (`npm run docs` in `core/`); a test fails when it is stale.

## Rules

- **Package Doctor reads; it does not change a package** until the items that repair one (compression, file
  replacement, translation). Even then it writes a new zip and never overwrites the one that was opened.
- **Warn, never block.** No finding stops anything; the person decides. This is the suite's settled rule for
  accessibility (C2) and holds here for every check.
- **Severity is honest.** A *problem* is something an LMS is likely to refuse, or that stops the course opening or
  tracking. A missing picture is a *warning*, not a problem. Say what was not checked (the report's "Not checked").
- **Plain words.** Every finding has a title, what was found in this package, where, and what to do. No jargon a
  faculty member would need to look up, but the manifest's own names are given where they help someone fix it.
- **Wording**: no tool is described as an alternative to a named product or compared with one. Naming a product where
  a user needs the name (an LMS, the program that made a package) is fine.
- **AI stays optional.** Nothing here needs a model.
- **Accessibility of the window itself**: everything works by keyboard and with a screen reader, focus is always
  visible, states are words and never colour alone, the report is navigable by headings. The suite's look is
  `app/src/openstage-ui.css` (a copy of the master in OpenStage Author's `design/`); Package Doctor's own colours are in
  `app/src/app.css`, and `app/src/colors.test.ts` measures their contrast.
- **Tests**: every check has a test that builds the package it is about (`core/test/helpers.ts` makes zips, broken ones
  included). No binary fixtures, and never a real person's course in the repository (`samples/` is ignored).
- **Licences**: permissive dependencies only (MIT, BSD, Apache 2.0, ISC). No GPL or AGPL code, linked or copied.
  Record what is adopted in `NOTICE`.

## Shared pieces (openstage-core)

- C2, the accessibility rule engine (`openstage-a11y`, tag `a11y-v0.1.0`), is used for item 5, unchanged. Its status
  words and report are A11Y-1 section 4; Package Doctor shows them as they are and never turns them into its own
  problem, warning and note. A change to the rules is made in openstage-core.
- C6, the translation layer, is used for item 6 by borrowing Author's form of XLIFF (the author's choice,
  2026-11-17), not by sharing code: it is still inside Author (Python) and OpenExplainer (TypeScript, a different form
  of inline tags), and not scheduled for the core. When C6 moves to openstage-core, `core/src/translate/inline.ts`
  and `xliff.ts` are what move, and Package Doctor uses the core's copy. CORE-REQUESTS.md says so.
- A format or rule change that another tool shares is made in openstage-core first.

## Names OpenStage Hub expects

Hub's catalog (`brands/openstage/apps.json`) lists this program as repository
`jasonswrench-beep/openstage-package-doctor`, program file `openstage-package-doctor.exe`, the NSIS quiet switch
`/P`, signer "Jason Wrench". The program file and switch match `app/src-tauri/tauri.conf.json`. This repository is
`openstage-pd`, so the name in the catalog and the repository's name must be brought together before Hub can list it.
