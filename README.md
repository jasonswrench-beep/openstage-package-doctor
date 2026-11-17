# OpenStage Package Doctor

Opens a course package without its source file and checks whether it will run. It's for anyone who has inherited a
package from a publisher or a colleague and needs to know what is inside it before it goes into an LMS.

Part of the OpenStage suite. Free and open source under the Apache License 2.0.

## What it does today (0.5.0)

- **Opens** SCORM 1.2, SCORM 2004 (2nd, 3rd and 4th editions), xAPI (`tincan.xml`) and cmi5 packages from a `.zip`,
  and shows:
  - the manifest
  - the course outline
  - where each part starts
  - every file with its size
  - the tracking settings, in plain words: the passing score, completion threshold, attempts, sequencing and so on
- **Checks whether it will run**:
  - the zip itself: damage, passwords, unusual compression, backslashes in names
  - where the manifest is
  - whether the manifest is valid XML and complete
  - every start page
  - every link in the course's pages and style sheets, including names that differ only in capitals, which work on
    Windows but break on most LMS servers

  Each finding says what is wrong, where, and what to do about it. [docs/checks.md](docs/checks.md) lists every check.
- **Checks accessibility** with the suite's own rules (A11Y-1, which follow WCAG 2.1 AA), the same rules OpenStage
  Author and the other tools use: every page in the package with its style sheets, and each Word, PowerPoint and
  captions file. Each finding is a word and a symbol (Fail, Needs review), where it is and what to do, with the
  checks only a person can make and what the check could not do. Most authoring tools build their pages with scripts,
  so the test player also checks a page **as the learner sees it** (Check this page's accessibility). The findings
  warn and never block.
- It tells a SCORM course from other files called `imsmanifest.xml`, such as a question library exported from an LMS.
- **Plays it** in a test player, the way an LMS would, with a log beside it of everything the course tells the LMS:
  - for SCORM 1.2 and 2004, every call to the LMS's API, what the LMS answered, and why it refused a value (a status
    word it does not know, a score out of range, a SCORM 2004 name sent to a SCORM 1.2 LMS)
  - for xAPI and cmi5, every statement and request to a stand-in learning record store, checked against xAPI's rules,
    and for cmi5 against the rules cmi5 adds (the token, the session id, initialized first, the move-on rules)
  - what the LMS would record: completion, pass or fail, score, time, bookmark and saved data, with the manifest's
    passing score and completion threshold applied as an LMS applies them
  - files the course's scripts ask for that are not in the package, and what it loads from other websites

  Leave and relaunch tries resuming, the launch modes try browse and review, and **Copy log** puts the whole log on the
  clipboard. The learner is made up and nothing leaves the computer.
- **Changes it**, always into a new package under a new name; the one you opened is never written to:
  - **makes it smaller**: large photographs (JPEG, WebP) saved again and brought down to a size you choose, MP4 video
    encoded again as H.264 at a height and bit rate you choose (its sound copied as it is), WAV sound made mono at
    22,050 a second, and pages, scripts, style sheets and fonts packed again as tightly as a zip allows. A file keeps
    its name and its kind, so nothing in the course has to change, and it is only replaced if it gets at least a tenth
    smaller. Pictures a script cuts up (sprite sheets and atlases), PNG and GIF pictures, and MP3 sound are left alone.
  - **replaces any file** with one you choose, under the old one's name.
  - **translates** it: the words in its pages (paragraphs, headings, buttons, alt text, tooltips, the page title),
    its captions and the titles the LMS shows go out as an XLIFF 1.2 file for a translation tool, in OpenStage
    Author's own form of XLIFF, or as a Word table for a translator who works in Word. The translation comes back
    in and is checked: a piece whose bold, links or placeholders were changed stays in the original language and is
    listed. Each page's language is set. A pseudo-translation shows, in the test player, which words were reached.
    Words a program keeps inside its scripts and data files (most of a Storyline, Rise or Captivate course) are not
    reached, and the Translate part says how many such files there are.

  The new package can be opened straight away, to check it and play it. A 72 MB course of stock photographs came out
  at 21 MB; a 1080p lesson video went from 7.7 MB to 2.9 MB at 720p.

Nothing is uploaded and nothing is changed: the package is only read, on your computer. No AI is involved.

What's next is in [ROADMAP.md](ROADMAP.md): wrapping a PDF, a video or a folder of pages as a package.

## Using it

- **The program**: double-click `OPEN PACKAGE DOCTOR.bat`. The first run builds it, which takes a few minutes. Then
  open a package with **Open package...**, Ctrl+O, or by dropping a `.zip` on the window. **Copy report** puts the
  whole report on the clipboard, to paste into an email to an LMS administrator. **Play it in the test player**, in
  the report's "Try it" section, runs the course, and **Change the package...**, in "Change it", makes it smaller or
  replaces a file and saves a new package.
- **The command line**: drag a `.zip` onto `CHECK A PACKAGE.bat`, or run:

  ```bash
  node core/src/cli.ts path/to/package.zip
  ```

  Add `--json` for the report as JSON. The exit code is 0 with no problems, 1 with a problem, and 2 if a file could not
  be read.

Needs Node.js 22.18 or later. Building the program needs Rust as well.

## How it is made

- `core/` (TypeScript, no dependencies but fflate): reading zips and manifests, every check, and the test player's
  stand-in LMS and LRS (`core/src/play/`), writing a new zip (`core/src/write.ts`) and choosing what to make smaller
  (`core/src/media/`), and translation (`core/src/translate/`). The window, the command line and the tests all use
  it.
- `app/`: the window, a Tauri program (a Rust shell around a web page), with the suite's look. The Rust side runs the
  suite's accessibility engine (`openstage-a11y`, from openstage-core) on the files the page sends it. The test player's
  service worker serves the course's pages from the open zip on the window's own site, so a SCORM course finds the
  LMS's API there, as it would in an LMS. Pictures and video are made smaller with the window's own codecs
  (WebCodecs, which on Windows use Windows' H.264 encoder): no separate program, and nothing uploaded.
- `docs/`: the list of checks, made from the code.

Run the tests with `RUN TESTS.bat`, or `npm test` in `core/` and in `app/`.

## Licence

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
