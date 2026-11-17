# Roadmap

From the OpenStage Package Doctor Development List (November 15, 2026), in build order. Size: S is a few days of
build-session work, M is one to two weeks.

| # | Item | Why | Size | State |
| --- | --- | --- | --- | --- |
| 1 | Open SCORM 1.2, SCORM 2004, xAPI and cmi5 zips: manifest, file tree, sizes, tracking settings | The base every other item works on | S | **Done in 0.1.0** |
| 2 | A will-it-run check: manifest validity, missing files, broken links | The most common reason an inherited package fails in an LMS | S | **Done in 0.1.0** |
| 3 | A local test player with a tracking log | Shows what the LMS will receive before anything is uploaded | S | **Done in 0.2.0** |
| 4 | Compress media and replace any file inside the zip | LMS upload limits bite, and fixing one video should not need the source | M | Next |
| 5 | Accessibility preflight on C2 | The same report Author and Scroll give, for packages made anywhere | S | `openstage-a11y` (tag `a11y-v0.1.0`) is published |
| 6 | Extract all text to XLIFF or .docx and put translations back (C6) | Translate a package with no source file | M | Waits on C6 moving into openstage-core, or borrows Author's |
| 7 | Wrap a PDF, a video or an HTML folder as a package | Small, and often what instructors actually need | S | Author's manifest writers (`player/src/*-manifest.ts`) are the start |

## Left from item 3

- SCORM 2004 sequencing rules are not run. The player follows a course's continue, previous and choice requests from
  one part to the next, and lists every part to launch by hand; rules that skip, hide or repeat parts need an LMS.
- A course that opens itself in a new window (some SCORM 1.2 courses do) is not followed there.
- Statements with attachments (multipart/mixed) are refused with a note that they were not checked.
- AICC packages are not played.
- The log is copied, not saved to a file; saving comes with saving the report.

## Left from items 1 and 2

- The suite's menu row (File, Help) and Ctrl+K command search from the design guide. With two commands, both on the
  navy bar, the window does not have one yet; it comes with item 3 or 4, when there are more commands.
- Opening a package from the command line or by double-clicking a `.zip` (a file association), as well as by the
  picker and by dropping.
- A `.zip` is read into memory whole. Packages of several gigabytes would need reading from disk in pieces.
- Saving the report to a file (today: Copy report, or `--json` on the command line).
- Reading AICC packages (today: recognised and named, not opened).
