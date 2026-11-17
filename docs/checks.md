# What Package Doctor checks

Made from `core/src/findings.ts` by `npm run docs` in `core/`; do not edit it by hand.

Every finding has a stable id, which the report, the JSON output and the tests use. How serious it is:

- **Problem**: an LMS is likely to refuse the package, or the course will not open or not track.
- **Warning**: some LMSs or browsers will have trouble; others will not mind.
- **Note**: worth knowing; nothing is wrong.

None of them blocks anything: Package Doctor reports, and the person decides.

A broken link (`link-broken`) or a link that differs in capitals only (`link-case`) is a problem when the file is one
the course needs to run (a script, style sheet, page or data file) and a warning when it is a picture, sound, video,
font or document.

The test player's findings (`play-...`) come from running the course on this computer, so they cover only the parts
that were opened. A file the course asks for while it runs (`play-missing-file`, `play-file-case`,
`play-root-request`) follows the same rule as a link. A refused value (`play-refused`) is a problem when it is a
completion, a pass or fail, or a score, and a warning otherwise.

## The zip

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `zip-unreadable` | Problem | The file is not a zip that can be opened | Export or download the package again. An LMS only accepts a standard .zip file. |
| `zip-empty` | Problem | The zip is empty | Export the package again; nothing is inside this one. |
| `zip-encrypted` | Problem | Files in the zip are password-protected | Zip the package again without a password. An LMS cannot unpack protected files. |
| `zip-method` | Problem | Files are packed with a method most LMSs cannot unpack | Zip the package again with the standard (Deflate) method. Windows' own Send to > Compressed folder does this. |
| `zip-damaged` | Problem | A file inside the zip is damaged | Download or export the package again; this copy is not whole. |
| `zip-backslash` | Problem | File names in the zip use backslashes | Zip the package again with a different tool. Some LMSs unpack a name such as images\logo.png as one file with a backslash in its name, so the course cannot find it. |
| `zip-unsafe-path` | Problem | A file name points outside the package | Zip the package again from inside its folder. Names that start with / or contain ../ are refused by most LMSs for safety. |
| `zip-duplicate` | Warning | The same file is in the zip twice | Zip the package again. Which copy an LMS keeps is not predictable. |
| `zip-name-encoding` | Warning | File names have accented or other non-English letters | Rename these files with plain letters, digits, - and _ if you can. Some LMSs unpack such names with different characters, and links to them break. |
| `zip-junk` | Note | The zip holds files a computer added on its own | Nothing needs doing. These (such as __MACOSX, .DS_Store and Thumbs.db) are harmless, but can be left out. |
| `zip-nested` | Note | The zip holds other zip files | If one of them is the real course package, upload that one to the LMS instead of this zip. |
| `zip-size` | Note | Package size | Many LMSs limit the size of an upload. If yours refuses this package, the largest files are the place to start. |

## Finding the manifest

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `manifest-missing` | Problem | No course manifest was found | A SCORM package needs imsmanifest.xml, a cmi5 package cmi5.xml and an xAPI package tincan.xml, at the top of the zip. Export the course again as a package for an LMS. |
| `manifest-in-folder` | Problem | The manifest is inside a folder, not at the top of the zip | Open the folder, select everything inside it, and zip that. Zipping the folder itself adds a level the LMS does not look in. |
| `manifest-name-case` | Problem | The manifest's name has the wrong capital letters | Rename the file in all lower-case letters (for example imsmanifest.xml). LMS servers usually tell capitals apart, so they will not find it. |
| `manifest-several` | Note | The package has more than one kind of manifest | Nothing needs doing, but which kind the LMS uses depends on how you add it: as a SCORM package it reads imsmanifest.xml; as xAPI or cmi5 it reads tincan.xml or cmi5.xml. |

## Reading the manifest

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `xml-malformed` | Problem | The manifest is not valid XML | An LMS's importer stops at the first mistake. Correct the file at the line shown, or export the package again. |
| `xml-encoding` | Warning | The manifest's characters are saved in an unexpected encoding | Save the manifest as UTF-8. Some LMSs refuse the file or show its titles with wrong characters. |
| `not-a-course` | Warning | This is a content package, but not a SCORM course | Packages like this (a question bank, a course cartridge or a plain content package) go into an LMS through its course or quiz import, not as a SCORM activity. |
| `aicc-package` | Note | This looks like an AICC package | Package Doctor does not open AICC packages yet. Most LMSs that still accept AICC import it through a separate AICC option. |

## SCORM

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `scorm-version-unknown` | Warning | The SCORM version cannot be told from the manifest | The manifest's <schemaversion> should say 1.2, CAM 1.3, 2004 3rd Edition or 2004 4th Edition. Some LMSs guess wrongly without it. |
| `scorm-namespace-mismatch` | Warning | The manifest mixes SCORM 1.2 and SCORM 2004 | Its version says one thing and its adlcp namespace the other. Export the package again for the one version the LMS should treat it as. |
| `scorm-no-organization` | Problem | The manifest has no course outline | A SCORM course needs an <organization> with at least one <item> in <organizations>. Without one the LMS has nothing to launch. |
| `scorm-default-missing` | Problem | The manifest's default outline does not exist | The default attribute on <organizations> must name the identifier of one of its <organization> elements. |
| `scorm-item-ref-missing` | Problem | An item in the outline points to a resource that does not exist | Each item's identifierref must match the identifier of a <resource>. The LMS cannot launch this item. |
| `scorm-item-no-ref` | Problem | An item at the end of the outline launches nothing | Give the item an identifierref that names a <resource>, or remove it. |
| `scorm-resource-no-href` | Problem | A launched resource has no start page | A <resource> that an item launches needs an href naming the page to open. |
| `scorm-launch-missing` | Problem | A start page is not in the package | The course will not open. Add the missing page, or correct the href in the manifest. |
| `scorm-launch-case` | Problem | A start page's name differs from the file in capital letters only | It works on Windows but not on an LMS server that tells capitals apart. Make the manifest and the file name match exactly. |
| `scorm-file-missing` | Warning | Files listed in the manifest are not in the package | Most LMSs import the package anyway, but the course may need these files. Add them, or take them out of the manifest. |
| `scorm-dependency-missing` | Warning | A resource depends on a resource that does not exist | Each <dependency identifierref> must name a <resource> in the manifest. |
| `scorm-duplicate-id` | Problem | Two parts of the manifest share an identifier | Every identifier in the manifest must be different. Many LMSs refuse the package. |
| `scorm-type-missing` | Warning | A launched resource does not say whether it is tracked | Without adlcp:scormtype="sco" (SCORM 1.2) or adlcp:scormType="sco" (SCORM 2004) most LMSs treat it as a plain page and record no score or completion. |
| `scorm-type-case` | Warning | The SCORM type attribute is spelled for the other SCORM version | SCORM 1.2 spells it scormtype and SCORM 2004 scormType. An LMS that reads it exactly will not find it and may record nothing. |
| `scorm-asset-launched` | Note | An item launches a page the LMS does not track | Its resource is an asset, so the LMS records only that it was opened. If the page reports a score, its scormtype should be sco. |
| `scorm-mastery-range` | Warning | A passing score is outside its allowed range | SCORM 1.2's masteryscore is 0 to 100; SCORM 2004's minNormalizedMeasure is -1 to 1 and completionThreshold 0 to 1. |
| `scorm-schema-files` | Note | Schema files the manifest names are not in the package | Most LMSs do not mind. A few strict importers want the .xsd files at the top of the zip; exporting the package again usually puts them back. |
| `scorm-unlisted-files` | Note | Files in the package that the manifest does not list | Nothing needs doing: LMSs unpack and serve every file in the zip. |
| `scorm-remote-launch` | Note | An item launches a page on another website | The LMS must be able to reach that website, and the website must allow the course to talk to the LMS. |
| `scorm-several-scos` | Note | The package has more than one tracked part | Check that your LMS shows a menu for packages of several parts and records each one. |

## cmi5

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `cmi5-namespace` | Warning | cmi5.xml does not use the cmi5 namespace | Its <courseStructure> should have xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd". An LMS may not recognise the course. |
| `cmi5-no-course` | Problem | cmi5.xml has no <course> | Export the course again as a cmi5 package. |
| `cmi5-no-au` | Problem | cmi5.xml has no assignable unit | A cmi5 course needs at least one <au>, the part the LMS launches. |
| `cmi5-id` | Problem | An identifier in cmi5.xml is not a web address | cmi5 requires the course, block and AU ids to be IRIs, such as https://example.org/course/1. |
| `cmi5-duplicate-id` | Problem | Two parts of cmi5.xml share an id | Every course, block and AU id must be different. |
| `cmi5-no-url` | Problem | An AU has no URL | Each <au> needs a <url> naming the page to launch. |
| `cmi5-launch-missing` | Problem | An AU's start page is not in the package | The course will not open. Add the page, or correct the <url>. |
| `cmi5-launch-case` | Problem | An AU's start page differs from the file in capital letters only | Make cmi5.xml and the file name match exactly; LMS servers usually tell capitals apart. |
| `cmi5-moveon` | Problem | An AU's moveOn value is not one cmi5 allows | moveOn must be Passed, Completed, CompletedAndPassed, CompletedOrPassed or NotApplicable. |
| `cmi5-mastery` | Problem | An AU's masteryScore is not between 0 and 1 | cmi5's masteryScore is a fraction: 0.8 means 80 percent. |
| `cmi5-launchmethod` | Problem | An AU's launchMethod is not one cmi5 allows | launchMethod must be AnyWindow or OwnWindow. |
| `cmi5-remote-launch` | Note | An AU launches a page on another website | The LMS must be able to reach that website when a learner launches it. |

## xAPI (tincan.xml)

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `xapi-namespace` | Warning | tincan.xml does not use the tincan namespace | Its <tincan> should have xmlns="http://projecttincan.com/tincan.xsd". An LMS may not recognise the course. |
| `xapi-no-activity` | Problem | tincan.xml has no activity | Export the course again as an xAPI package. |
| `xapi-no-launch` | Problem | No activity in tincan.xml says which page to launch | One <activity> needs a <launch> naming the start page. |
| `xapi-launch-missing` | Problem | The start page in tincan.xml is not in the package | The course will not open. Add the page, or correct the <launch>. |
| `xapi-launch-case` | Problem | The start page differs from the file in capital letters only | Make tincan.xml and the file name match exactly; LMS servers usually tell capitals apart. |
| `xapi-id` | Warning | An activity id in tincan.xml is not a web address | xAPI activity ids should be IRIs, such as https://example.org/course/1. Some LMSs and learning record stores refuse other ids. |
| `xapi-remote-launch` | Note | The course launches a page on another website | The LMS must be able to reach that website when a learner launches it. |

## Links in the pages

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `link-broken` | Problem | A page links to a file that is not in the package | The file will be missing in the LMS. Add it, or correct the link. |
| `link-case` | Problem | A link differs from its file in capital letters only | It works on Windows but breaks on an LMS server that tells capitals apart. Make the link and the file name match exactly. |
| `link-outside` | Problem | A link points outside the package | A link with ../ that climbs above the package's top folder reaches nothing once the package is in an LMS. Put the file inside the package. |
| `link-local-disk` | Problem | A link points to a file on someone's computer | Links such as file:///C:/... or C:\... only worked on the computer that made the course. Put the file in the package and link to it from there. |
| `link-root` | Warning | A link starts with / | In an LMS a link starting with / points at the LMS's own website, not the package. Make it relative (images/logo.png, not /images/logo.png). |
| `link-backslash` | Warning | A link uses backslashes | Write links with forward slashes (images/logo.png). Some browsers do not follow backslashes. |
| `link-insecure` | Warning | A page loads a file from a website over http | LMSs are on https, and browsers block http pictures, scripts and frames inside https pages. Change the address to https if the website offers it. |
| `links-scripted` | Note | Some links are made by scripts and were not checked | Package Doctor reads the links in the pages and style sheets. Files a course's scripts load as it runs are only found by running it. |

## What the test player saw

| Id | Severity | Finding | What to do |
| --- | --- | --- | --- |
| `play-no-api` | Problem | The course never started talking to the LMS | It did not call LMSInitialize (SCORM 1.2) or Initialize (SCORM 2004), so an LMS would record nothing. Usually the course did not find the LMS's API: it should look for window.API (SCORM 1.2) or window.API_1484_11 (SCORM 2004) in the windows above it. Check that it was published for this version of SCORM. |
| `play-refused` | Warning | The LMS refused something the course sent | The value breaks SCORM's rules for that field, so a strict LMS does not keep it; a lenient one may. The detail names the field, the value and the rule. It is fixed in the course's publishing settings or its tracking code. |
| `play-no-finish` | Problem | The course did not tell the LMS it was finished | It was closed without calling LMSFinish (SCORM 1.2) or Terminate (SCORM 2004). Many LMSs then keep nothing from the session, or leave the attempt open. The course should call it when the learner leaves, including when the window is simply closed. |
| `play-no-status` | Warning | The course did not report completion | The session ended without the course setting cmi.core.lesson_status (SCORM 1.2) or cmi.completion_status (SCORM 2004), so the LMS shows the course as not attempted or unknown. That is right if the learner left early; if the course was finished, check its completion settings. |
| `play-missing-file` | Problem | The course asked for a file that is not in the package | The file will be missing in the LMS too. It was found by running the course: a script or a page asked for it. Add the file to the package, or correct whatever asks for it. |
| `play-file-case` | Problem | The course asked for a file with different capitals | The test player served it, as Windows would, but an LMS server that tells capitals apart will not. Make the name the course asks for and the file's name match exactly. |
| `play-root-request` | Problem | The course asked for a file from the top of the website | An address starting with / points at the LMS's own website, not the package, so the file is not found there. Make the address relative (images/logo.png, not /images/logo.png). |
| `play-external` | Note | The course loads files from other websites | These must be reachable from the learner's computer, and a school's network or the LMS's settings may block them. Over http rather than https, browsers block them inside an LMS. |
| `play-no-statement` | Problem | The course sent nothing to the learning record store | No statement arrived, so nothing about the learner is recorded. Check that the course reads the endpoint, auth and actor from its address, as an LMS launches it, and that it was published for xAPI or cmi5. |
| `play-statement-refused` | Problem | The learning record store refused a statement | The statement breaks xAPI's rules, so a real LRS refuses it too and the record is lost. The detail gives the rule. It is fixed in the course's publishing settings or its tracking code. |
| `play-lrs-refused` | Warning | The learning record store refused a request | The course asked for or sent something the LRS could not accept, such as a saved place (a State document). The detail gives the reason. The course may carry on, but what it asked for is not kept. |
| `play-cmi5-fetch` | Problem | The course did not fetch its cmi5 token | A cmi5 course must first POST to the fetch address in its launch address to get the token it signs its records with. Without it, nothing it sends is accepted. Check that the course was published for cmi5. |
| `play-cmi5-rule` | Problem | A statement breaks a cmi5 rule | A cmi5 LMS must reject a statement that breaks its rules, or does not count it toward the course. The detail names the rule. It is fixed in the course's publishing settings or its tracking code. |
