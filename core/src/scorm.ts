// Reads imsmanifest.xml: SCORM 1.2 and SCORM 2004 (2nd, 3rd and 4th editions), and tells a SCORM course from other IMS
// content packages (question banks, course cartridges) that share the file name. It reads leniently, the way most LMSs
// do (an attribute is found whatever prefix a tool used), and reports where a strict LMS would differ.

import { finding, type Finding } from "./findings.ts";
import type { LaunchPoint, OutlineNode, PackageKind, StartSettings, TrackingSetting } from "./model.ts";
import { FileIndex, folderOf, isExternal, resolveIn, splitReference } from "./paths.ts";
import { XML_NS, allText, attr, kid, kids, type XmlElement } from "./xml.ts";

const NS = {
  adlcp12: "http://www.adlnet.org/xsd/adlcp_rootv1p2",
  adlcp2004: "http://www.adlnet.org/xsd/adlcp_v1p3",
  imsss: "http://www.imsglobal.org/xsd/imsss",
  adlseq: "http://www.adlnet.org/xsd/adlseq_v1p3",
  adlnav: "http://www.adlnet.org/xsd/adlnav_v1p3",
  xsi: "http://www.w3.org/2001/XMLSchema-instance",
};

export interface ScormRead {
  kind: PackageKind;
  kindLabel: string;
  title?: string;
  identifier?: string;
  outline: OutlineNode[];
  launches: LaunchPoint[];
  tracking: TrackingSetting[];
  findings: Finding[];
  /** Every file the manifest names, resolved, so the check can tell which files it leaves out. */
  listed: Set<string>;
}

interface Resource {
  id: string;
  type: string;
  scormType?: string;
  /** The local name the type attribute was written with: scormtype or scormType. */
  scormTypeSpelling?: string;
  href?: string;
  base: string;
  line: number;
  el: XmlElement;
}

function namespacesUsed(el: XmlElement, into = new Set<string>()): Set<string> {
  into.add(el.ns);
  for (const a of el.attrs) if (a.ns) into.add(a.ns);
  for (const c of el.children) namespacesUsed(c, into);
  return into;
}

/** An attribute matched by its local name whatever its capitals, so both scormtype and scormType are found. */
function attrAnyCase(el: XmlElement, local: string): { value: string; local: string } | undefined {
  const want = local.toLowerCase();
  const a = el.attrs.find((x) => x.local.toLowerCase() === want);
  return a ? { value: a.value, local: a.local } : undefined;
}

function kidAnyCase(el: XmlElement | undefined, local: string): XmlElement | undefined {
  const want = local.toLowerCase();
  return el?.children.find((c) => c.local.toLowerCase() === want);
}

function withSlash(base: string): string {
  return base && !base.endsWith("/") ? base + "/" : base;
}

function percent(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${value} (${Math.round(n * 100)} percent)` : value;
}

const TIME_LIMIT_ACTIONS: Record<string, string> = {
  "exit,message": "Leave the course and show a message",
  "exit,no message": "Leave the course without a message",
  "continue,message": "Carry on and show a message",
  "continue,no message": "Carry on without a message",
};

export function readScorm(root: XmlElement, manifestPath: string, files: FileIndex): ScormRead {
  const findings: Finding[] = [];
  const tracking: TrackingSetting[] = [];
  const launches: LaunchPoint[] = [];
  const listed = new Set<string>([manifestPath]);
  const where = { file: manifestPath };
  const manifestFolder = folderOf(manifestPath);

  const metadata = kid(root, "metadata");
  const schema = allText(kid(metadata, "schema"));
  const schemaVersion = allText(kid(metadata, "schemaversion"));
  const used = namespacesUsed(root);
  const resourcesEl = kid(root, "resources");
  const resourceEls = kids(resourcesEl, "resource");
  const organizationsEl = kid(root, "organizations");
  const orgEls = kids(organizationsEl, "organization");

  // Which SCORM, if any.
  let version: "1.2" | "2004" | undefined;
  let edition = "";
  const sv = schemaVersion.toLowerCase().replace(/\s+/g, " ");
  if (sv === "1.2") version = "1.2";
  else if (sv === "cam 1.3" || sv === "2004 2nd edition") { version = "2004"; edition = "2nd Edition"; }
  else if (sv === "2004 3rd edition") { version = "2004"; edition = "3rd Edition"; }
  else if (sv === "2004 4th edition") { version = "2004"; edition = "4th Edition"; }
  const has12 = used.has(NS.adlcp12);
  const has2004 = used.has(NS.adlcp2004) || used.has(NS.imsss) || used.has(NS.adlseq) || used.has(NS.adlnav);
  if (version === "1.2" && has2004 && !has12) {
    findings.push(finding("scorm-namespace-mismatch", `The manifest says SCORM 1.2 but uses SCORM 2004's namespaces.`, where));
  } else if (version === "2004" && has12 && !has2004) {
    findings.push(finding("scorm-namespace-mismatch", `The manifest says SCORM 2004 ${edition} but uses SCORM 1.2's adlcp namespace.`, where));
  }
  const versionStated = version !== undefined;
  if (!version) version = has2004 ? "2004" : has12 ? "1.2" : undefined;

  if (!version) {
    // No SCORM namespace and no SCORM version: an IMS content package of another kind.
    const types = [...new Set(resourceEls.map((r) => attr(r, "type") ?? "").filter(Boolean))];
    const materials = resourceEls.flatMap((r) => r.attrs.filter((a) => a.local === "material_type").map((a) => a.value));
    const fromBrightspace = [...used].some((ns) => /desire2learn\.com/i.test(ns));
    const what = materials.some((m) => /question|quiz/i.test(m))
      ? `It is a question library${fromBrightspace ? " exported from Brightspace" : ""}`
      : types.some((t) => /qti/i.test(t))
      ? "It holds question banks (QTI)"
      : types.some((t) => /imscc|imsdt|imswl|imsbasiclti/i.test(t)) || /cartridge/i.test(schema)
        ? "It is a course cartridge"
        : "It is a plain IMS content package";
    findings.push(
      finding(
        "not-a-course",
        `${what}${types.length ? `, with resources of type ${types.slice(0, 4).join(", ")}${types.length > 4 ? " and others" : ""}` : ""}. Its manifest names no SCORM version${schema ? ` (it says "${schema}${schemaVersion ? " " + schemaVersion : ""}")` : ""}.`,
        where,
      ),
    );
    return {
      kind: "content-package",
      kindLabel: schema ? `IMS content package (${schema}${schemaVersion ? " " + schemaVersion : ""})` : "IMS content package",
      identifier: attr(root, "identifier"),
      title: allText(kid(orgEls[0], "title")) || undefined,
      outline: [],
      launches: [],
      tracking: [],
      findings,
      listed,
    };
  }
  if (!versionStated) {
    findings.push(
      finding(
        "scorm-version-unknown",
        schemaVersion
          ? `<schemaversion> says "${schemaVersion}", which is not a SCORM version. It is read as SCORM ${version} from its namespaces.`
          : `The manifest has no <schemaversion>. It is read as SCORM ${version} from its namespaces.`,
        where,
      ),
    );
  }
  const is12 = version === "1.2";
  const kind: PackageKind = is12 ? "scorm12" : "scorm2004";
  const kindLabel = is12 ? "SCORM 1.2" : edition ? `SCORM 2004 ${edition}` : "SCORM 2004";

  // Identifiers must be unique across the manifest.
  const seen = new Map<string, number>();
  const noteId = (el: XmlElement) => {
    const id = attr(el, "identifier");
    if (!id) return;
    if (seen.has(id)) findings.push(finding("scorm-duplicate-id", `"${id}" is used on line ${seen.get(id)} and again on line ${el.line}.`, { ...where, line: el.line }));
    else seen.set(id, el.line);
  };
  noteId(root);
  for (const o of orgEls) noteId(o);

  // xml:base on the manifest and on <resources> moves where every file is looked for.
  const rootBase = resolveIn(manifestFolder, withSlash(attr(root, "base", XML_NS) ?? "")).path;
  const resourcesBase = resolveIn(rootBase, withSlash(attr(resourcesEl, "base", XML_NS) ?? "")).path;

  const resources = new Map<string, Resource>();
  for (const r of resourceEls) {
    noteId(r);
    const id = attr(r, "identifier") ?? "";
    const typeAttr = attrAnyCase(r, "scormtype");
    const base = resolveIn(resourcesBase, withSlash(attr(r, "base", XML_NS) ?? "")).path;
    const res: Resource = { id, type: attr(r, "type") ?? "", base, line: r.line, el: r };
    if (typeAttr) { res.scormType = typeAttr.value.trim().toLowerCase(); res.scormTypeSpelling = typeAttr.local; }
    const href = attr(r, "href");
    if (href !== undefined) res.href = href;
    if (id && !resources.has(id)) resources.set(id, res);
  }

  // Each resource's files, and the files it depends on.
  for (const res of resources.values()) {
    const missing: string[] = [];
    for (const f of kids(res.el, "file")) {
      const href = attr(f, "href");
      if (!href || isExternal(href)) continue;
      const resolved = resolveIn(res.base, splitReference(href).file);
      listed.add(resolved.path);
      const look = files.lookup(resolved.path);
      if (look.found === "missing") missing.push(href);
      else if (look.found === "case") missing.push(`${href} (the package has ${look.path})`);
    }
    if (missing.length) {
      findings.push(
        finding(
          "scorm-file-missing",
          `Resource "${res.id}" lists ${missing.length === 1 ? "a file" : `${missing.length} files`} the package does not have: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? `, and ${missing.length - 5} more` : ""}.`,
          { ...where, line: res.line },
        ),
      );
    }
    for (const d of kids(res.el, "dependency")) {
      const ref = attr(d, "identifierref");
      if (ref && !resources.has(ref)) findings.push(finding("scorm-dependency-missing", `Resource "${res.id}" depends on "${ref}", which is not in the manifest.`, { ...where, line: d.line }));
    }
    if (res.href && !isExternal(res.href)) listed.add(resolveIn(res.base, splitReference(res.href).file).path);
  }

  // The course outline.
  const defaultId = attr(organizationsEl, "default");
  let org = orgEls.find((o) => attr(o, "identifier") === defaultId);
  if (!orgEls.length || !orgEls.some((o) => kids(o, "item").length)) {
    findings.push(finding("scorm-no-organization", orgEls.length ? "The manifest's <organization> has no <item>." : "The manifest has no <organization>.", where));
  } else if (defaultId && !org) {
    findings.push(finding("scorm-default-missing", `<organizations default="${defaultId}"> names an outline that is not there. The first outline is shown here; an LMS may refuse the package.`, { ...where, line: organizationsEl?.line }));
  } else if (!defaultId && orgEls.length > 1) {
    // No default is allowed; the LMS then takes the first.
  }
  org ??= orgEls[0];

  const launchedIds = new Set<string>();
  let assetLaunches = 0;
  const outline: OutlineNode[] = [];

  const readTracking = (el: XmlElement, scope: string) => {
    const add = (name: string, value: string, meaning: string, source: string) => tracking.push({ scope, name, value, meaning, source });
    if (is12) {
      const mastery = allText(kidAnyCase(el, "masteryscore"));
      if (mastery) {
        add("Passing score", mastery, "When the course reports a score, the LMS sets passed at this score or above and failed below it.", "adlcp:masteryscore");
        const n = Number(mastery);
        if (!Number.isFinite(n) || n < 0 || n > 100) findings.push(finding("scorm-mastery-range", `"${scope}" has a masteryscore of ${mastery}.`, { ...where, line: el.line }));
      }
      const maxTime = allText(kidAnyCase(el, "maxtimeallowed"));
      if (maxTime) add("Time allowed", maxTime, "How long a learner may spend in one attempt (hours:minutes:seconds). What happens then is the time limit action.", "adlcp:maxtimeallowed");
      const action = allText(kidAnyCase(el, "timelimitaction"));
      if (action) add("When time runs out", TIME_LIMIT_ACTIONS[action.toLowerCase()] ?? action, "The course is told this action and decides what to do; the LMS does not stop it.", "adlcp:timelimitaction");
      const data = allText(kidAnyCase(el, "datafromlms"));
      if (data) add("Start-up data", data, "Text the LMS hands to the course when it starts (cmi.launch_data).", "adlcp:datafromlms");
      const pre = allText(kidAnyCase(el, "prerequisites"));
      if (pre) add("Prerequisites", pre, "The parts that must be done before this one opens. Not every LMS applies them.", "adlcp:prerequisites");
      return;
    }
    const action = allText(kidAnyCase(el, "timeLimitAction"));
    if (action) add("When time runs out", TIME_LIMIT_ACTIONS[action.toLowerCase()] ?? action, "The course is told this action and decides what to do; the LMS does not stop it.", "adlcp:timeLimitAction");
    const data = allText(kidAnyCase(el, "dataFromLMS"));
    if (data) add("Start-up data", data, "Text the LMS hands to the course when it starts (cmi.launch_data).", "adlcp:dataFromLMS");
    const threshold = kidAnyCase(el, "completionThreshold");
    if (threshold) {
      const value = attr(threshold, "minProgressMeasure") ?? (allText(threshold) || "1.0");
      const byMeasure = attr(threshold, "completedByMeasure");
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) findings.push(finding("scorm-mastery-range", `"${scope}" has a completion threshold of ${value}.`, { ...where, line: threshold.line }));
      if (byMeasure === "false") add("Completion threshold", percent(value), "Written, but completedByMeasure is false, so the LMS takes completion from the course and ignores this figure.", "adlcp:completionThreshold");
      else add("Completion threshold", percent(value), "The part counts as complete when the progress the course reports reaches this figure.", "adlcp:completionThreshold");
    }
    const seq = kid(el, "sequencing", NS.imsss) ?? kidAnyCase(el, "sequencing");
    if (seq) readSequencing(seq, scope, add, el);
    const pres = kid(el, "presentation", NS.adlnav) ?? kidAnyCase(el, "presentation");
    const hidden = kids(kidAnyCase(pres, "navigationInterface"), "hideLMSUI").map((h) => allText(h)).filter(Boolean);
    if (hidden.length) add("LMS buttons hidden", hidden.join(", "), "The course draws its own buttons for these, so the LMS hides its own.", "adlnav:hideLMSUI");
  };

  const readSequencing = (seq: XmlElement, scope: string, add: (n: string, v: string, m: string, s: string) => void, owner: XmlElement) => {
    const idRef = attr(seq, "IDRef");
    if (idRef) add("Shared sequencing", idRef, "This part uses sequencing rules written once in the manifest's sequencingCollection.", "imsss:sequencing IDRef");
    const yes = (v: string | undefined) => (v === "true" ? "Yes" : "No");
    const cm = kidAnyCase(seq, "controlMode");
    if (cm) {
      const choice = attr(cm, "choice");
      const flow = attr(cm, "flow");
      const forwardOnly = attr(cm, "forwardOnly");
      const choiceExit = attr(cm, "choiceExit");
      if (choice !== undefined) add("Learners pick from the menu", yes(choice), "Whether a learner may open the parts inside this one from the LMS's menu.", "imsss:controlMode choice");
      if (flow !== undefined) add("Next and Previous", yes(flow), "Whether the LMS's Continue and Previous move through the parts inside this one in order.", "imsss:controlMode flow");
      if (forwardOnly !== undefined) add("Forward only", yes(forwardOnly), "Whether learners are kept from going back to an earlier part.", "imsss:controlMode forwardOnly");
      if (choiceExit !== undefined) add("May leave by the menu", yes(choiceExit), "Whether a learner may leave this part by picking another from the menu.", "imsss:controlMode choiceExit");
    }
    const dc = kidAnyCase(seq, "deliveryControls");
    if (dc) {
      const tracked = attr(dc, "tracked");
      if (tracked === "false") add("Tracked", "No", "The LMS records nothing about this part: no completion, no score.", "imsss:deliveryControls tracked");
      if (attr(dc, "completionSetByContent") === "true") add("Completion set by the course", "Yes", "Only the course sets completion; the LMS does not mark the part complete just because it was opened.", "imsss:deliveryControls completionSetByContent");
      if (attr(dc, "objectiveSetByContent") === "true") add("Pass or fail set by the course", "Yes", "Only the course sets whether the learner passed.", "imsss:deliveryControls objectiveSetByContent");
    }
    const objectives = kidAnyCase(seq, "objectives");
    const primary = kidAnyCase(objectives, "primaryObjective");
    if (primary && attr(primary, "satisfiedByMeasure") === "true") {
      const min = allText(kidAnyCase(primary, "minNormalizedMeasure")) || "1.0";
      const n = Number(min);
      if (!Number.isFinite(n) || n < -1 || n > 1) findings.push(finding("scorm-mastery-range", `"${scope}" has a minNormalizedMeasure of ${min}.`, { ...where, line: primary.line }));
      add("Passing score", percent(min), "The LMS sets passed or failed from the score the course reports, at this fraction of the maximum.", "imsss:minNormalizedMeasure");
    }
    const others = kids(objectives, "objective").length;
    if (others) add("Other objectives", String(others), "Objectives beyond the main one, which rules or other courses can read.", "imsss:objective");
    const limits = kidAnyCase(seq, "limitConditions");
    const attempts = attr(limits, "attemptLimit");
    if (attempts) add("Attempts allowed", attempts, "How many times a learner may attempt this part.", "imsss:limitConditions attemptLimit");
    const duration = attr(limits, "attemptAbsoluteDurationLimit");
    if (duration) add("Time allowed", duration, "How long one attempt may last (an ISO 8601 duration such as PT30M for 30 minutes).", "imsss:limitConditions attemptAbsoluteDurationLimit");
    const rules = kidAnyCase(seq, "sequencingRules");
    if (rules) {
      const n = (local: string) => rules.children.filter((c) => c.local === local).length;
      const parts = [
        n("preConditionRule") && `${n("preConditionRule")} before it starts`,
        n("exitConditionRule") && `${n("exitConditionRule")} on leaving`,
        n("postConditionRule") && `${n("postConditionRule")} after it ends`,
      ].filter(Boolean);
      if (parts.length) add("Sequencing rules", parts.join(", "), "Rules that skip, hide or repeat parts. What they do is only seen by running the course in an LMS.", "imsss:sequencingRules");
    }
    const rollup = kids(kidAnyCase(seq, "rollupRules"), "rollupRule").length;
    if (rollup) add("Roll-up rules", String(rollup), "Rules for how the results of the parts inside this one add up to its own result.", "imsss:rollupRules");
    void owner;
  };

  /** What the LMS hands the course when this item starts, for the test player. */
  const startSettings = (item: XmlElement, id: string): StartSettings => {
    const s: StartSettings = { id };
    const text = (local: string) => allText(kidAnyCase(item, local)) || undefined;
    const num = (v: string | undefined) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
    s.launchData = text(is12 ? "datafromlms" : "dataFromLMS");
    s.timeLimitAction = text(is12 ? "timelimitaction" : "timeLimitAction");
    if (is12) {
      s.masteryScore = num(text("masteryscore"));
      s.maxTimeAllowed = text("maxtimeallowed");
    } else {
      const threshold = kidAnyCase(item, "completionThreshold");
      if (threshold && attr(threshold, "completedByMeasure") !== "false") s.completionThreshold = num(attr(threshold, "minProgressMeasure") ?? (allText(threshold) || "1.0"));
      const seq = kid(item, "sequencing", NS.imsss) ?? kidAnyCase(item, "sequencing");
      const primary = kidAnyCase(kidAnyCase(seq, "objectives"), "primaryObjective");
      if (primary && attr(primary, "satisfiedByMeasure") === "true") s.scaledPassingScore = num(allText(kidAnyCase(primary, "minNormalizedMeasure")) || "1.0");
      s.maxTimeAllowed = attr(kidAnyCase(seq, "limitConditions"), "attemptAbsoluteDurationLimit");
    }
    for (const k of Object.keys(s) as (keyof StartSettings)[]) if (s[k] === undefined) delete s[k];
    return s;
  };

  const walk = (item: XmlElement, depth: number): OutlineNode => {
    noteId(item);
    const id = attr(item, "identifier") ?? "";
    const title = allText(kid(item, "title")) || id || "(untitled)";
    const subItems = kids(item, "item");
    const node: OutlineNode = { title, id, kind: "item", children: [] };
    if (attr(item, "isvisible") === "false") node.hidden = true;
    const ref = attr(item, "identifierref");
    if (ref !== undefined) {
      const res = resources.get(ref);
      if (!res) findings.push(finding("scorm-item-ref-missing", `Item "${title}" points to "${ref}".`, { ...where, line: item.line }));
      else {
        launchedIds.add(ref);
        if (res.href === undefined || res.href === "") findings.push(finding("scorm-resource-no-href", `Resource "${res.id}", launched by "${title}", has no href.`, { ...where, line: res.line }));
        else {
          const params = attr(item, "parameters") ?? "";
          const href = res.href + params;
          const point: LaunchPoint = { title, from: `item ${id}`, href, start: startSettings(item, id) };
          if (!res.scormType) {
            findings.push(finding("scorm-type-missing", `Resource "${res.id}" (launched by "${title}") has no ${is12 ? "adlcp:scormtype" : "adlcp:scormType"}.`, { ...where, line: res.line }));
          } else {
            const expected = is12 ? "scormtype" : "scormType";
            if (res.scormTypeSpelling !== expected) {
              findings.push(finding("scorm-type-case", `Resource "${res.id}" has ${res.scormTypeSpelling}; SCORM ${version} spells it ${expected}.`, { ...where, line: res.line }));
            }
            point.tracked = res.scormType === "sco";
            if (!point.tracked) assetLaunches++;
          }
          if (isExternal(res.href)) {
            findings.push(finding("scorm-remote-launch", `"${title}" opens ${res.href}.`, { ...where, line: res.line }));
          } else {
            const target = resolveIn(res.base, splitReference(res.href).file);
            const look = files.lookup(target.path);
            if (target.outside || look.found === "missing") {
              findings.push(finding("scorm-launch-missing", `"${title}" starts at ${res.href}, which is not in the package.`, { ...where, line: res.line }));
            } else if (look.found === "case") {
              findings.push(finding("scorm-launch-case", `"${title}" starts at ${target.path}; the package has ${look.path}.`, { ...where, line: res.line }));
              point.file = look.path;
            } else point.file = target.path;
          }
          node.launches = point.file ?? href;
          launches.push(point);
        }
      }
    } else if (!subItems.length) {
      findings.push(finding("scorm-item-no-ref", `Item "${title}" has no identifierref.`, { ...where, line: item.line }));
    }
    readTracking(item, title);
    node.children = subItems.map((s) => walk(s, depth + 1));
    return node;
  };

  for (const o of orgEls) {
    const orgTitle = allText(kid(o, "title")) || attr(o, "identifier") || "(untitled outline)";
    const node: OutlineNode = { title: orgTitle, id: attr(o, "identifier") ?? "", kind: "organization", children: [] };
    if (o === org) {
      readTracking(o, "Course");
      const gObj = attrAnyCase(o, "objectivesGlobalToSystem");
      if (gObj?.value === "false") tracking.push({ scope: "Course", name: "Objectives shared with other courses", value: "No", meaning: "This course's objectives are kept to itself.", source: "adlseq:objectivesGlobalToSystem" });
      const gData = attrAnyCase(o, "sharedDataGlobalToSystem");
      if (gData?.value === "false") tracking.push({ scope: "Course", name: "Data shared with other courses", value: "No", meaning: "Data the course stores for later is kept to itself.", source: "adlcp:sharedDataGlobalToSystem" });
      node.children = kids(o, "item").map((it) => walk(it, 1));
      outline.push(node);
    } else {
      // Other outlines are listed, and their references checked, but the LMS launches the default one.
      for (const it of kids(o, "item")) {
        const stack = [it];
        while (stack.length) {
          const x = stack.pop()!;
          noteId(x);
          const ref = attr(x, "identifierref");
          if (ref !== undefined && !resources.has(ref)) findings.push(finding("scorm-item-ref-missing", `Item "${allText(kid(x, "title")) || attr(x, "identifier")}" in the outline "${orgTitle}" points to "${ref}".`, { ...where, line: x.line }));
          stack.push(...kids(x, "item"));
        }
      }
      outline.push(node);
    }
  }

  if (assetLaunches) {
    findings.push(finding("scorm-asset-launched", `${assetLaunches === 1 ? "One item launches" : `${assetLaunches} items launch`} a resource marked as an asset.`, where));
  }
  const tracked = launches.filter((l) => l.tracked).length;
  if (tracked > 1) findings.push(finding("scorm-several-scos", `${tracked} items are tracked separately.`, where));

  // Schema files named in xsi:schemaLocation.
  const schemaLocation = attr(root, "schemaLocation", NS.xsi);
  if (schemaLocation) {
    const parts = schemaLocation.trim().split(/\s+/);
    const missing: string[] = [];
    for (let k = 1; k < parts.length; k += 2) {
      const loc = parts[k]!;
      if (isExternal(loc)) continue;
      const p = resolveIn(manifestFolder, loc);
      listed.add(p.path);
      if (files.lookup(p.path).found !== "exact") missing.push(loc);
    }
    if (missing.length) findings.push(finding("scorm-schema-files", `Missing: ${missing.join(", ")}.`, where));
  }

  return {
    kind,
    kindLabel,
    title: (org && allText(kid(org, "title"))) || allText(kid(kid(metadata, "lom"), "title")) || undefined,
    identifier: attr(root, "identifier"),
    outline,
    launches,
    tracking,
    findings,
    listed,
  };
}
