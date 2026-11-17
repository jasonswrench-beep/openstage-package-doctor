// Reads cmi5.xml (the cmi5 course structure) and tincan.xml (the xAPI package file most LMSs that take xAPI packages read).

import { finding, type Finding } from "./findings.ts";
import type { LaunchPoint, OutlineNode, TrackingSetting } from "./model.ts";
import { FileIndex, folderOf, isExternal, resolveIn, splitReference } from "./paths.ts";
import { allText, attr, kid, kids, type XmlElement } from "./xml.ts";

export const CMI5_NS = "https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd";
export const TINCAN_NS = "http://projecttincan.com/tincan.xsd";

export interface StructureRead {
  title?: string;
  identifier?: string;
  outline: OutlineNode[];
  launches: LaunchPoint[];
  tracking: TrackingSetting[];
  findings: Finding[];
}

/** A cmi5 or xAPI title: the <langstring> in English if there is one, else the first, else the element's own text. */
function langText(el: XmlElement | undefined): string {
  if (!el) return "";
  const strings = kids(el, "langstring");
  if (!strings.length) return allText(el);
  const english = strings.find((s) => /^en\b/i.test(attr(s, "lang") ?? ""));
  return allText(english ?? strings[0]);
}

const IRI = /^[a-z][a-z0-9+.-]*:\S+$/i;

const MOVE_ON: Record<string, string> = {
  Passed: "The learner must pass",
  Completed: "The learner must complete it",
  CompletedAndPassed: "The learner must complete it and pass",
  CompletedOrPassed: "The learner must complete it or pass",
  NotApplicable: "Nothing: it counts as satisfied as soon as the course is registered",
};

export function readCmi5(root: XmlElement, manifestPath: string, files: FileIndex): StructureRead {
  const findings: Finding[] = [];
  const tracking: TrackingSetting[] = [];
  const launches: LaunchPoint[] = [];
  const where = { file: manifestPath };
  const folder = folderOf(manifestPath);

  if (root.local !== "courseStructure" || root.ns !== CMI5_NS) {
    findings.push(finding("cmi5-namespace", root.local !== "courseStructure" ? `The top element is <${root.name}>, not <courseStructure>.` : `Its namespace is "${root.ns || "none"}".`, { ...where, line: root.line }));
  }
  const course = kid(root, "course");
  if (!course) findings.push(finding("cmi5-no-course", "There is no <course> element.", where));

  const ids = new Map<string, number>();
  const checkId = (el: XmlElement, what: string): string => {
    const id = attr(el, "id") ?? "";
    if (!IRI.test(id)) findings.push(finding("cmi5-id", `The ${what} id is "${id || "(empty)"}".`, { ...where, line: el.line }));
    if (id && ids.has(id)) findings.push(finding("cmi5-duplicate-id", `"${id}" is used on line ${ids.get(id)} and again on line ${el.line}.`, { ...where, line: el.line }));
    else if (id) ids.set(id, el.line);
    return id;
  };
  if (course) checkId(course, "course");

  const readAu = (au: XmlElement): OutlineNode => {
    const id = checkId(au, "AU");
    const title = langText(kid(au, "title")) || id || "(untitled AU)";
    const node: OutlineNode = { title, id, kind: "au", children: [] };
    const add = (name: string, value: string, meaning: string, source: string) => tracking.push({ scope: title, name, value, meaning, source });

    const moveOn = attr(au, "moveOn");
    if (moveOn !== undefined && !(moveOn in MOVE_ON)) findings.push(finding("cmi5-moveon", `"${title}" has moveOn="${moveOn}".`, { ...where, line: au.line }));
    add("To move on", MOVE_ON[moveOn ?? "NotApplicable"] ?? moveOn ?? "", moveOn ? "What the learner must do for this AU to count toward the course." : "Not written, so cmi5's default applies.", "moveOn");
    const mastery = attr(au, "masteryScore");
    if (mastery !== undefined) {
      const n = Number(mastery);
      if (!Number.isFinite(n) || n < 0 || n > 1) findings.push(finding("cmi5-mastery", `"${title}" has masteryScore="${mastery}".`, { ...where, line: au.line }));
      add("Passing score", `${mastery}${Number.isFinite(n) ? ` (${Math.round(n * 100)} percent)` : ""}`, "The LMS gives this to the course, which decides pass or fail with it.", "masteryScore");
    }
    const method = attr(au, "launchMethod");
    if (method !== undefined && method !== "AnyWindow" && method !== "OwnWindow") findings.push(finding("cmi5-launchmethod", `"${title}" has launchMethod="${method}".`, { ...where, line: au.line }));
    add("Opens in", method === "OwnWindow" ? "Its own window" : "Any window the LMS chooses", method ? "Where the LMS opens the AU." : "Not written, so the LMS chooses.", "launchMethod");
    const activityType = attr(au, "activityType");
    if (activityType) add("Activity type", activityType, "The kind of activity this AU reports itself as.", "activityType");
    const params = allText(kid(au, "launchParameters"));
    if (params) add("Start-up data", params, "Text the LMS hands to the AU when it starts.", "launchParameters");
    if (kid(au, "entitlementKey")) add("Entitlement key", "Present", "A key the LMS passes on, used by some publishers to check a licence.", "entitlementKey");

    const urlEl = kid(au, "url");
    const url = allText(urlEl);
    if (!url) findings.push(finding("cmi5-no-url", `"${title}" has no <url>.`, { ...where, line: au.line }));
    else {
      const point: LaunchPoint = { title, from: `au ${id}`, href: url, tracked: true };
      if (isExternal(url)) findings.push(finding("cmi5-remote-launch", `"${title}" opens ${url}.`, { ...where, line: urlEl?.line }));
      else {
        const target = resolveIn(folder, splitReference(url).file);
        const look = files.lookup(target.path);
        if (target.outside || look.found === "missing") findings.push(finding("cmi5-launch-missing", `"${title}" starts at ${url}.`, { ...where, line: urlEl?.line }));
        else if (look.found === "case") {
          findings.push(finding("cmi5-launch-case", `"${title}" starts at ${target.path}; the package has ${look.path}.`, { ...where, line: urlEl?.line }));
          point.file = look.path;
        } else point.file = target.path;
      }
      node.launches = point.file ?? url;
      launches.push(point);
    }
    return node;
  };

  const readChildren = (parent: XmlElement): OutlineNode[] =>
    parent.children.flatMap((c): OutlineNode[] => {
      if (c.local === "au") return [readAu(c)];
      if (c.local === "block") {
        const id = checkId(c, "block");
        return [{ title: langText(kid(c, "title")) || id || "(untitled block)", id, kind: "block", children: readChildren(c) }];
      }
      return [];
    });

  const outline = readChildren(root);
  if (!launches.length && !findings.some((f) => f.id === "cmi5-no-url")) findings.push(finding("cmi5-no-au", "There is no <au> element.", where));
  return { title: langText(kid(course, "title")) || undefined, identifier: course ? attr(course, "id") : undefined, outline, launches, tracking, findings };
}

export function readTincan(root: XmlElement, manifestPath: string, files: FileIndex): StructureRead {
  const findings: Finding[] = [];
  const tracking: TrackingSetting[] = [];
  const launches: LaunchPoint[] = [];
  const where = { file: manifestPath };
  const folder = folderOf(manifestPath);

  if (root.local !== "tincan" || root.ns !== TINCAN_NS) {
    findings.push(finding("xapi-namespace", root.local !== "tincan" ? `The top element is <${root.name}>, not <tincan>.` : `Its namespace is "${root.ns || "none"}".`, { ...where, line: root.line }));
  }
  const activities = kids(kid(root, "activities"), "activity");
  if (!activities.length) findings.push(finding("xapi-no-activity", "There is no <activity> in <activities>.", where));

  const outline: OutlineNode[] = [];
  let title: string | undefined;
  let identifier: string | undefined;
  for (const a of activities) {
    const id = attr(a, "id") ?? "";
    const name = langText(kid(a, "name")) || id;
    if (!IRI.test(id)) findings.push(finding("xapi-id", `The activity id is "${id || "(empty)"}".`, { ...where, line: a.line }));
    const node: OutlineNode = { title: name, id, kind: "activity", children: [] };
    const launchEl = kid(a, "launch");
    const launch = allText(launchEl);
    if (launch) {
      title ??= name;
      identifier ??= id;
      tracking.push({ scope: name, name: "Activity id", value: id, meaning: "The learning record store files this course's records under this id.", source: "activity id" });
      const type = attr(a, "type");
      if (type) tracking.push({ scope: name, name: "Activity type", value: type, meaning: "The kind of activity the course reports itself as.", source: "activity type" });
      const point: LaunchPoint = { title: name, from: `activity ${id}`, href: launch, tracked: true };
      if (isExternal(launch)) findings.push(finding("xapi-remote-launch", `"${name}" opens ${launch}.`, { ...where, line: launchEl?.line }));
      else {
        const target = resolveIn(folder, splitReference(launch).file);
        const look = files.lookup(target.path);
        if (target.outside || look.found === "missing") findings.push(finding("xapi-launch-missing", `"${name}" starts at ${launch}.`, { ...where, line: launchEl?.line }));
        else if (look.found === "case") {
          findings.push(finding("xapi-launch-case", `"${name}" starts at ${target.path}; the package has ${look.path}.`, { ...where, line: launchEl?.line }));
          point.file = look.path;
        } else point.file = target.path;
      }
      node.launches = point.file ?? launch;
      launches.push(point);
    }
    outline.push(node);
  }
  if (activities.length && !launches.length) findings.push(finding("xapi-no-launch", `None of the ${activities.length} activities has a <launch>.`, where));
  return { title, identifier, outline, launches, tracking, findings };
}
