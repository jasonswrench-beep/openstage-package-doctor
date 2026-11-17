// Every finding Package Doctor can report, with its words. The id is stable: tests, the report file and the
// documentation (docs/checks.md) name findings by it. Severity says how likely the finding is to stop the package:
//
//   problem  An LMS is likely to refuse the package, or the course will not open or not track.
//   warning  Some LMSs or browsers will have trouble; others will not mind.
//   note     Worth knowing; nothing is wrong.
//
// None of these blocks anything. Package Doctor reports and the person decides.

export type Severity = "problem" | "warning" | "note";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** What was found, in this package. */
  detail: string;
  /** What to do about it. */
  fix: string;
  /** The file inside the package the finding is about, as a path from the zip's top. */
  file?: string;
  line?: number;
}

interface Rule {
  severity: Severity;
  title: string;
  fix: string;
}

export const RULES = {
  // The zip itself
  "zip-unreadable": { severity: "problem", title: "The file is not a zip that can be opened", fix: "Export or download the package again. An LMS only accepts a standard .zip file." },
  "zip-empty": { severity: "problem", title: "The zip is empty", fix: "Export the package again; nothing is inside this one." },
  "zip-encrypted": { severity: "problem", title: "Files in the zip are password-protected", fix: "Zip the package again without a password. An LMS cannot unpack protected files." },
  "zip-method": { severity: "problem", title: "Files are packed with a method most LMSs cannot unpack", fix: "Zip the package again with the standard (Deflate) method. Windows' own Send to > Compressed folder does this." },
  "zip-damaged": { severity: "problem", title: "A file inside the zip is damaged", fix: "Download or export the package again; this copy is not whole." },
  "zip-backslash": { severity: "problem", title: "File names in the zip use backslashes", fix: "Zip the package again with a different tool. Some LMSs unpack a name such as images\\logo.png as one file with a backslash in its name, so the course cannot find it." },
  "zip-unsafe-path": { severity: "problem", title: "A file name points outside the package", fix: "Zip the package again from inside its folder. Names that start with / or contain ../ are refused by most LMSs for safety." },
  "zip-duplicate": { severity: "warning", title: "The same file is in the zip twice", fix: "Zip the package again. Which copy an LMS keeps is not predictable." },
  "zip-name-encoding": { severity: "warning", title: "File names have accented or other non-English letters", fix: "Rename these files with plain letters, digits, - and _ if you can. Some LMSs unpack such names with different characters, and links to them break." },
  "zip-junk": { severity: "note", title: "The zip holds files a computer added on its own", fix: "Nothing needs doing. These (such as __MACOSX, .DS_Store and Thumbs.db) are harmless, but can be left out." },
  "zip-nested": { severity: "note", title: "The zip holds other zip files", fix: "If one of them is the real course package, upload that one to the LMS instead of this zip." },
  "zip-size": { severity: "note", title: "Package size", fix: "Many LMSs limit the size of an upload. If yours refuses this package, the largest files are the place to start." },

  // Finding the manifest
  "manifest-missing": { severity: "problem", title: "No course manifest was found", fix: "A SCORM package needs imsmanifest.xml, a cmi5 package cmi5.xml and an xAPI package tincan.xml, at the top of the zip. Export the course again as a package for an LMS." },
  "manifest-in-folder": { severity: "problem", title: "The manifest is inside a folder, not at the top of the zip", fix: "Open the folder, select everything inside it, and zip that. Zipping the folder itself adds a level the LMS does not look in." },
  "manifest-name-case": { severity: "problem", title: "The manifest's name has the wrong capital letters", fix: "Rename the file in all lower-case letters (for example imsmanifest.xml). LMS servers usually tell capitals apart, so they will not find it." },
  "manifest-several": { severity: "note", title: "The package has more than one kind of manifest", fix: "Nothing needs doing, but which kind the LMS uses depends on how you add it: as a SCORM package it reads imsmanifest.xml; as xAPI or cmi5 it reads tincan.xml or cmi5.xml." },
  "xml-malformed": { severity: "problem", title: "The manifest is not valid XML", fix: "An LMS's importer stops at the first mistake. Correct the file at the line shown, or export the package again." },
  "xml-encoding": { severity: "warning", title: "The manifest's characters are saved in an unexpected encoding", fix: "Save the manifest as UTF-8. Some LMSs refuse the file or show its titles with wrong characters." },
  "not-a-course": { severity: "warning", title: "This is a content package, but not a SCORM course", fix: "Packages like this (a question bank, a course cartridge or a plain content package) go into an LMS through its course or quiz import, not as a SCORM activity." },
  "aicc-package": { severity: "note", title: "This looks like an AICC package", fix: "Package Doctor does not open AICC packages yet. Most LMSs that still accept AICC import it through a separate AICC option." },

  // SCORM
  "scorm-version-unknown": { severity: "warning", title: "The SCORM version cannot be told from the manifest", fix: "The manifest's <schemaversion> should say 1.2, CAM 1.3, 2004 3rd Edition or 2004 4th Edition. Some LMSs guess wrongly without it." },
  "scorm-namespace-mismatch": { severity: "warning", title: "The manifest mixes SCORM 1.2 and SCORM 2004", fix: "Its version says one thing and its adlcp namespace the other. Export the package again for the one version the LMS should treat it as." },
  "scorm-no-organization": { severity: "problem", title: "The manifest has no course outline", fix: "A SCORM course needs an <organization> with at least one <item> in <organizations>. Without one the LMS has nothing to launch." },
  "scorm-default-missing": { severity: "problem", title: "The manifest's default outline does not exist", fix: "The default attribute on <organizations> must name the identifier of one of its <organization> elements." },
  "scorm-item-ref-missing": { severity: "problem", title: "An item in the outline points to a resource that does not exist", fix: "Each item's identifierref must match the identifier of a <resource>. The LMS cannot launch this item." },
  "scorm-item-no-ref": { severity: "problem", title: "An item at the end of the outline launches nothing", fix: "Give the item an identifierref that names a <resource>, or remove it." },
  "scorm-resource-no-href": { severity: "problem", title: "A launched resource has no start page", fix: "A <resource> that an item launches needs an href naming the page to open." },
  "scorm-launch-missing": { severity: "problem", title: "A start page is not in the package", fix: "The course will not open. Add the missing page, or correct the href in the manifest." },
  "scorm-launch-case": { severity: "problem", title: "A start page's name differs from the file in capital letters only", fix: "It works on Windows but not on an LMS server that tells capitals apart. Make the manifest and the file name match exactly." },
  "scorm-file-missing": { severity: "warning", title: "Files listed in the manifest are not in the package", fix: "Most LMSs import the package anyway, but the course may need these files. Add them, or take them out of the manifest." },
  "scorm-dependency-missing": { severity: "warning", title: "A resource depends on a resource that does not exist", fix: "Each <dependency identifierref> must name a <resource> in the manifest." },
  "scorm-duplicate-id": { severity: "problem", title: "Two parts of the manifest share an identifier", fix: "Every identifier in the manifest must be different. Many LMSs refuse the package." },
  "scorm-type-missing": { severity: "warning", title: "A launched resource does not say whether it is tracked", fix: "Without adlcp:scormtype=\"sco\" (SCORM 1.2) or adlcp:scormType=\"sco\" (SCORM 2004) most LMSs treat it as a plain page and record no score or completion." },
  "scorm-type-case": { severity: "warning", title: "The SCORM type attribute is spelled for the other SCORM version", fix: "SCORM 1.2 spells it scormtype and SCORM 2004 scormType. An LMS that reads it exactly will not find it and may record nothing." },
  "scorm-asset-launched": { severity: "note", title: "An item launches a page the LMS does not track", fix: "Its resource is an asset, so the LMS records only that it was opened. If the page reports a score, its scormtype should be sco." },
  "scorm-mastery-range": { severity: "warning", title: "A passing score is outside its allowed range", fix: "SCORM 1.2's masteryscore is 0 to 100; SCORM 2004's minNormalizedMeasure is -1 to 1 and completionThreshold 0 to 1." },
  "scorm-schema-files": { severity: "note", title: "Schema files the manifest names are not in the package", fix: "Most LMSs do not mind. A few strict importers want the .xsd files at the top of the zip; exporting the package again usually puts them back." },
  "scorm-unlisted-files": { severity: "note", title: "Files in the package that the manifest does not list", fix: "Nothing needs doing: LMSs unpack and serve every file in the zip." },
  "scorm-remote-launch": { severity: "note", title: "An item launches a page on another website", fix: "The LMS must be able to reach that website, and the website must allow the course to talk to the LMS." },
  "scorm-several-scos": { severity: "note", title: "The package has more than one tracked part", fix: "Check that your LMS shows a menu for packages of several parts and records each one." },

  // cmi5
  "cmi5-namespace": { severity: "warning", title: "cmi5.xml does not use the cmi5 namespace", fix: "Its <courseStructure> should have xmlns=\"https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd\". An LMS may not recognise the course." },
  "cmi5-no-course": { severity: "problem", title: "cmi5.xml has no <course>", fix: "Export the course again as a cmi5 package." },
  "cmi5-no-au": { severity: "problem", title: "cmi5.xml has no assignable unit", fix: "A cmi5 course needs at least one <au>, the part the LMS launches." },
  "cmi5-id": { severity: "problem", title: "An identifier in cmi5.xml is not a web address", fix: "cmi5 requires the course, block and AU ids to be IRIs, such as https://example.org/course/1." },
  "cmi5-duplicate-id": { severity: "problem", title: "Two parts of cmi5.xml share an id", fix: "Every course, block and AU id must be different." },
  "cmi5-no-url": { severity: "problem", title: "An AU has no URL", fix: "Each <au> needs a <url> naming the page to launch." },
  "cmi5-launch-missing": { severity: "problem", title: "An AU's start page is not in the package", fix: "The course will not open. Add the page, or correct the <url>." },
  "cmi5-launch-case": { severity: "problem", title: "An AU's start page differs from the file in capital letters only", fix: "Make cmi5.xml and the file name match exactly; LMS servers usually tell capitals apart." },
  "cmi5-moveon": { severity: "problem", title: "An AU's moveOn value is not one cmi5 allows", fix: "moveOn must be Passed, Completed, CompletedAndPassed, CompletedOrPassed or NotApplicable." },
  "cmi5-mastery": { severity: "problem", title: "An AU's masteryScore is not between 0 and 1", fix: "cmi5's masteryScore is a fraction: 0.8 means 80 percent." },
  "cmi5-launchmethod": { severity: "problem", title: "An AU's launchMethod is not one cmi5 allows", fix: "launchMethod must be AnyWindow or OwnWindow." },
  "cmi5-remote-launch": { severity: "note", title: "An AU launches a page on another website", fix: "The LMS must be able to reach that website when a learner launches it." },

  // xAPI (tincan.xml)
  "xapi-namespace": { severity: "warning", title: "tincan.xml does not use the tincan namespace", fix: "Its <tincan> should have xmlns=\"http://projecttincan.com/tincan.xsd\". An LMS may not recognise the course." },
  "xapi-no-activity": { severity: "problem", title: "tincan.xml has no activity", fix: "Export the course again as an xAPI package." },
  "xapi-no-launch": { severity: "problem", title: "No activity in tincan.xml says which page to launch", fix: "One <activity> needs a <launch> naming the start page." },
  "xapi-launch-missing": { severity: "problem", title: "The start page in tincan.xml is not in the package", fix: "The course will not open. Add the page, or correct the <launch>." },
  "xapi-launch-case": { severity: "problem", title: "The start page differs from the file in capital letters only", fix: "Make tincan.xml and the file name match exactly; LMS servers usually tell capitals apart." },
  "xapi-id": { severity: "warning", title: "An activity id in tincan.xml is not a web address", fix: "xAPI activity ids should be IRIs, such as https://example.org/course/1. Some LMSs and learning record stores refuse other ids." },
  "xapi-remote-launch": { severity: "note", title: "The course launches a page on another website", fix: "The LMS must be able to reach that website when a learner launches it." },

  // Links inside the course's pages
  // These two are problems when the file is one the course needs to run (a script, style sheet, page or data file),
  // and warnings when it is a picture, sound, video, font or document: the course still runs without those.
  "link-broken": { severity: "problem", title: "A page links to a file that is not in the package", fix: "The file will be missing in the LMS. Add it, or correct the link." },
  "link-case": { severity: "problem", title: "A link differs from its file in capital letters only", fix: "It works on Windows but breaks on an LMS server that tells capitals apart. Make the link and the file name match exactly." },
  "link-outside": { severity: "problem", title: "A link points outside the package", fix: "A link with ../ that climbs above the package's top folder reaches nothing once the package is in an LMS. Put the file inside the package." },
  "link-local-disk": { severity: "problem", title: "A link points to a file on someone's computer", fix: "Links such as file:///C:/... or C:\\... only worked on the computer that made the course. Put the file in the package and link to it from there." },
  "link-root": { severity: "warning", title: "A link starts with /", fix: "In an LMS a link starting with / points at the LMS's own website, not the package. Make it relative (images/logo.png, not /images/logo.png)." },
  "link-backslash": { severity: "warning", title: "A link uses backslashes", fix: "Write links with forward slashes (images/logo.png). Some browsers do not follow backslashes." },
  "link-insecure": { severity: "warning", title: "A page loads a file from a website over http", fix: "LMSs are on https, and browsers block http pictures, scripts and frames inside https pages. Change the address to https if the website offers it." },
  "links-scripted": { severity: "note", title: "Some links are made by scripts and were not checked", fix: "Package Doctor reads the links in the pages and style sheets. Files a course's scripts load as it runs are only found by running it." },
} satisfies Record<string, Rule>;

export type FindingId = keyof typeof RULES;

export function finding(id: FindingId, detail: string, at: { file?: string; line?: number } = {}, severity?: Severity): Finding {
  const rule: Rule = RULES[id];
  const f: Finding = { id, severity: severity ?? rule.severity, title: rule.title, detail, fix: rule.fix };
  if (at.file !== undefined) f.file = at.file;
  if (at.line !== undefined) f.line = at.line;
  return f;
}

export const SEVERITY_WORDS: Record<Severity, string> = { problem: "Problem", warning: "Warning", note: "Note" };
export const SEVERITY_ORDER: Severity[] = ["problem", "warning", "note"];
