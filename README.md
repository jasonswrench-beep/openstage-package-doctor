# OpenStage Package Doctor

Opens a course package without its source file and checks whether it will run. It's for anyone who has inherited a
package from a publisher or a colleague and needs to know what is inside it before it goes into an LMS.

Part of the OpenStage suite. Free and open source under the Apache License 2.0.

## What it does today (0.1.0)

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
- It tells a SCORM course from other files called `imsmanifest.xml`, such as a question library exported from an LMS.

Nothing is uploaded and nothing is changed: the package is only read, on your computer. No AI is involved.

What's next is in [ROADMAP.md](ROADMAP.md): a local test player with a tracking log, media compression and file
replacement, an accessibility preflight, translation and wrapping a PDF or video as a package.

## Using it

- **The program**: double-click `OPEN PACKAGE DOCTOR.bat`. The first run builds it, which takes a few minutes. Then
  open a package with **Open package...**, Ctrl+O, or by dropping a `.zip` on the window. **Copy report** puts the
  whole report on the clipboard, to paste into an email to an LMS administrator.
- **The command line**: drag a `.zip` onto `CHECK A PACKAGE.bat`, or run:

  ```bash
  node core/src/cli.ts path/to/package.zip
  ```

  Add `--json` for the report as JSON. The exit code is 0 with no problems, 1 with a problem, and 2 if a file could not
  be read.

Needs Node.js 22.18 or later. Building the program needs Rust as well.

## How it is made

- `core/` (TypeScript, no dependencies but fflate): reading zips and manifests, and every check. The window, the
  command line and the tests all use it.
- `app/`: the window, a Tauri program (a Rust shell around a web page), with the suite's look.
- `docs/`: the list of checks, made from the code.

Run the tests with `RUN TESTS.bat`, or `npm test` in `core/` and in `app/`.

## Licence

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
