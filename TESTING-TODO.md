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

## Already tried on this computer (November 17, 2026)

Read-only, the reports checked by eye:

- OpenStage Author's test lessons in all four formats: no problems; schema files noted as missing.
- OpenScroll's SCORM 1.2 and 2004 exports: no problems.
- A third-party SCORM 1.2 course (72 MB, 412 files): 20 missing pictures in one style sheet and a missing
  `favicon.png`, all real; 0.07 seconds.
- A Brightspace question library export: recognised as a question library, not a SCORM course.
- A 96 MB program archive with 517 backslashed names and a manifest deep in a folder: both reported; 0.1 seconds.
