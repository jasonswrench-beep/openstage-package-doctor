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
- [ ] Translation: open an XLIFF file from Package Doctor in a real translation tool (OmegaT, Weblate, memoQ),
      translate it there, and bring it back: does every piece go back, with its bold and links?
- [ ] Translation: fill in the Word table in Word, as a translator would (tracked changes on and off), and bring it
      back. Look at the table in Word too: is it easy to work in?
- [ ] Translation of a real hand-made course, played afterwards in the test player in the new language.
- [ ] Wrapped packages in a real LMS (SCORM Cloud, Moodle, Canvas, Brightspace), in all four standards: does it
      import, does the start page show the PDF or video, and does the LMS record completed by each rule?
- [ ] A wrapped package's start page with a screen reader and by keyboard: the video's controls and captions, the
      document's frame and link, the I have finished button and what it says after.
- [ ] Make a course package with a screen reader: the three groups, the choices read with their meaning.
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

Making a package, in the built program, the browser preview and the tests:

- A PDF wrapped in each of the four standards opens with no problems or warnings. The tracking script, run in the
  tests against the test player's strict stand-ins, keeps every rule for SCORM 1.2, SCORM 2004, cmi5 and xAPI: started,
  completed and left, with nothing refused.
- In the preview: a PDF wrapped as cmi5, opened and played: the fetch, the launch data and initialized, completed and
  terminated in order, the move-on rule met, no findings. A zip of plain web pages wrapped from its report as SCORM
  2004: its pages shown in the frame, completed on I have finished, exit normal.
- In the built program, with the real file picker and Save As box: a 36-second lesson video wrapped as SCORM 1.2,
  done at the end; it plays on the start page in the test player, incomplete until watched.

Translation, in the browser preview and the tests:

- A small hand-made SCORM 1.2 course (two pages, captions, a manifest): 17 pieces of text, about 96 words, found;
  saved as XLIFF and as a Word table (Word opens the table: one table, 18 rows). A made-up translation came back:
  13 pieces went back, and the 4 whose tags had been changed stayed in English and were listed; the new package
  played in the test player with its pages in the new language (`lang="es"`), title, heading and alt text translated.
- Every page, captions file and manifest of the three real samples comes back byte for byte when nothing is
  translated. The third-party course: 51 pieces of text, mostly its help pages; its slides' words are in 34 script
  and data files, which are not reached and are counted. OpenStage Author's lesson: only its title (its words are in
  its player's data).

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
