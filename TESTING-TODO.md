# Tests only a person can run

The automated tests (`RUN TESTS.bat`) build every package they check. These need a person, real packages or a real LMS.

## Before the first release

- [ ] Open packages made by other programs (Storyline, Rise, Captivate, iSpring, H5P, Lectora, an LMS's own export)
      and read each report: is every problem real, and is anything an LMS refused missing from it?
- [ ] For each problem Package Doctor reports, try one such package in a real LMS (Moodle, Canvas, Brightspace) and
      check that the LMS did refuse it or the course did fail. Correct a severity that turns out wrong.
- [ ] A keyboard-only pass of the window: open a package, move through the report, open folders, copy the report.
- [ ] A screen reader pass (NVDA): the verdict is read when a package opens, headings make sense, folders and the
      notes group announce open and closed.
- [ ] Windows high-contrast mode: every state still shows.
- [ ] The installer (`npx tauri build` in `app/`) on a second computer, and its `/P` quiet switch from OpenStage Hub.
- [ ] A package of 1 GB or more: how long it takes to open, and how much memory it uses.
- [ ] The test player with courses from other programs (Storyline, Rise, Captivate, iSpring, Lectora) in all four
      formats: does each one start, track and resume as it does in a real LMS, and is every refusal one a real LMS
      makes too? Note any the player refuses that LMSs accept, and decide whether the stand-in is too strict.
- [ ] The test player with a course that plays video: seeking backward and forward, and memory use while it plays.
- [ ] Make it smaller on courses from other programs, then play the new package and look: are pictures and video
      still right, does a course with a sprite sheet still draw correctly, and does the LMS take the new zip?
- [ ] Make it smaller on a long video (20 minutes or more): how long it takes, memory use, and whether picture and
      sound stay together to the end.
- [ ] Save as a new package with a screen reader: the Save As box, and the status line saying where it was saved.
- [ ] The accessibility check on courses from other programs, both as stored and as the learner sees it: are the
      failures real, and is anything an accessibility checker (or a person) finds missing?
- [ ] The accessibility section with a screen reader: one heading per rule, each status read as a word.
- [ ] The test player with a screen reader (NVDA): the status line says when the course starts, finishes and is
      refused; the summary and the log can be reached and scrolled by keyboard.

## Already tried on this computer (November 17, 2026)

Read-only, the reports checked by eye:

- OpenStage Author's test lessons in all four formats: no problems; schema files noted as missing.
- OpenScroll's SCORM 1.2 and 2004 exports: no problems.
- A third-party SCORM 1.2 course (72 MB, 412 files): 20 missing pictures in one style sheet and a missing
  `favicon.png`, all real; 0.07 seconds.
- A Brightspace question library export: recognised as a question library, not a SCORM course.
- A 96 MB program archive with 517 backslashed names and a manifest deep in a folder: both reported; 0.1 seconds.

The accessibility check, in the built program:

- OpenStage Author's SCORM 2004 lesson: as stored, one failure (no main element) and the Word document passes; as the
  learner sees it in the test player, no failures, because the player builds the main element as the page opens.
- The third-party SCORM 1.2 course: 11 pages, 22 failures and 53 to review as stored, among them pictures with no
  description and pages that do not say their language.

Change the package, in the built program and in the browser preview:

- The third-party SCORM 1.2 course (72.1 MB): its four stock photographs (11 to 15 MB each, up to 7,360 pixels wide)
  came down to 120 to 490 KB at 1,920 pixels; saved as a new package of 20.9 MB in about 16 seconds in all. The new
  package opens with the same two warnings as the original and plays the same in the test player.
- A 36-second 1080p lesson video from OpenStage Studio (H.264 and AAC, 7.7 MB): 1280 by 720 at 1.3 megabits a
  second, 2.9 MB, the same 1,070 frames and length, its sound kept; the words on screen are sharp. Saved through the
  window's Save As box. A fragmented MP4 recorded by the browser came out right too.
- Replacing a file: a name not in the package is caught, a file of another kind is warned about, Undo works.

The test player, in the built program and in the browser preview:

- OpenStage Author's test lesson in SCORM 2004, cmi5 and xAPI: plays, tracks, resumes after Leave and relaunch, and
  nothing is refused. (A cmi5 lesson's last statement arriving just after a relaunch is accepted, as an LMS would.)
- The third-party SCORM 1.2 course: plays. Six files its scripts ask for are not in the package (a video, a slide
  deck, audio, two PDFs and a JSON file), a value outside SCORM 1.2 (`lrn.item.lastaccess`) is refused, and it loads
  content from YouTube and, over http, from h5p.org.
