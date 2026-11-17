// What Package Doctor reads out of a package. Everything here is plain data, so a report can be saved as JSON.

import type { Finding } from "./findings.ts";

export type PackageKind = "scorm12" | "scorm2004" | "cmi5" | "xapi" | "content-package" | "aicc" | "unknown";

export interface PackageFile {
  /** Path from the top of the zip, with forward slashes. */
  path: string;
  size: number;
  packedSize: number;
}

/** One place the LMS can start the course: a SCORM item's resource, a cmi5 AU or an xAPI activity. */
export interface LaunchPoint {
  title: string;
  /** Which part of the manifest it comes from, such as "item ITEM-1" or "au https://...". */
  from: string;
  /** The address as the manifest writes it, with any parameters. */
  href: string;
  /** The file in the package that opens, or undefined when the address is on another website. */
  file?: string;
  /** For SCORM: whether the LMS tracks it (sco) or only opens it (asset). */
  tracked?: boolean;
  /** What the LMS hands the course when it starts this point, as the manifest gives it. The test player uses these. */
  start?: StartSettings;
}

/** The manifest's start-up settings for one launch point, as the LMS reads them. */
export interface StartSettings {
  /** The id the LMS knows this part by: a SCORM item's identifier, a cmi5 AU's id, an xAPI activity's id. */
  id: string;
  /** cmi.launch_data (adlcp:datafromlms, adlcp:dataFromLMS) or cmi5's launchParameters. */
  launchData?: string;
  /** SCORM 1.2 adlcp:masteryscore (0 to 100) or cmi5's masteryScore (0 to 1). */
  masteryScore?: number;
  /** SCORM 2004: the primary objective's minNormalizedMeasure, when satisfiedByMeasure is true. */
  scaledPassingScore?: number;
  /** SCORM 2004: adlcp:completionThreshold, when completedByMeasure is not false. */
  completionThreshold?: number;
  /** SCORM 1.2 adlcp:maxtimeallowed, or SCORM 2004's attemptAbsoluteDurationLimit. */
  maxTimeAllowed?: string;
  /** SCORM's time limit action, as written (exit,message and so on). */
  timeLimitAction?: string;
  /** cmi5's moveOn and launchMethod. */
  moveOn?: string;
  launchMethod?: string;
}

/** One tracking setting, in words. */
export interface TrackingSetting {
  /** The part of the course it belongs to: "Course", or an item or AU title. */
  scope: string;
  name: string;
  value: string;
  /** What the setting means for the learner and the LMS. */
  meaning: string;
  /** The manifest's own name for it, such as adlcp:masteryscore. */
  source: string;
}

export interface OutlineNode {
  title: string;
  id: string;
  /** "item", "block", "au", "activity" or "organization". */
  kind: string;
  /** The start page this node launches, if it launches one. */
  launches?: string;
  hidden?: boolean;
  children: OutlineNode[];
}

export interface OpenedPackage {
  fileName: string;
  zipSize: number;
  kind: PackageKind;
  /** The kind in words, such as "SCORM 2004 4th Edition". */
  kindLabel: string;
  /** The manifest's path in the zip, if one was found. */
  manifest?: string;
  title?: string;
  identifier?: string;
  /** The folder inside the zip the manifest is in ("" when it is at the top, as it should be). */
  root: string;
  files: PackageFile[];
  totals: { files: number; size: number; packedSize: number };
  outline: OutlineNode[];
  launches: LaunchPoint[];
  tracking: TrackingSetting[];
  findings: Finding[];
  /** What Package Doctor could not check in this package, in words. */
  limits: string[];
}
