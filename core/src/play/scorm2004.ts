// A stand-in SCORM 2004 (4th edition) LMS: the API object a course finds as window.API_1484_11, with the whole data
// model, the standard's error codes and its limits. Like the SCORM 1.2 one it is as strict as the strictest LMSs, so a
// value some LMSs quietly accept shows up as refused, with the reason in words. It also does what an LMS does with the
// manifest's figures: a completion threshold and a passing score decide completion_status and success_status. Sequencing
// rules are not run; a navigation request (adl.nav.request) is recorded and the test player follows the simple ones.
// It is a test aid: it does not replace trying the course in the LMS it is for.
// Started from OpenStage Author's player/src/fake-lms-2004.ts.

import { duration2004, LEARNER, newRecord, parseDuration, short, type ApiCall, type LearnerRecord, type Mode } from "./scorm-common.ts";

const ERRORS: Record<string, string> = {
  "0": "No Error",
  "101": "General Exception",
  "102": "General Initialization Failure",
  "103": "Already Initialized",
  "104": "Content Instance Terminated",
  "111": "General Termination Failure",
  "112": "Termination Before Initialization",
  "113": "Termination After Termination",
  "122": "Retrieve Data Before Initialization",
  "123": "Retrieve Data After Termination",
  "132": "Store Data Before Initialization",
  "133": "Store Data After Termination",
  "142": "Commit Before Initialization",
  "143": "Commit After Termination",
  "201": "General Argument Error",
  "301": "General Get Failure",
  "351": "General Set Failure",
  "391": "General Commit Failure",
  "401": "Undefined Data Model Element",
  "402": "Unimplemented Data Model Element",
  "403": "Data Model Element Value Not Initialized",
  "404": "Data Model Element Is Read Only",
  "405": "Data Model Element Is Write Only",
  "406": "Data Model Element Type Mismatch",
  "407": "Data Model Element Value Out Of Range",
  "408": "Data Model Dependency Not Established",
};

type Check = (v: string, el: string) => [string, string] | null;
interface Element {
  access: "ro" | "rw" | "wo";
  check?: Check;
}

const REAL = /^-?\d+(\.\d+)?$/;
const SHORT_ID = /^[A-Za-z0-9._:-]+$/;
const TIMESTAMP = /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d{1,2})?)?)?(Z|[+-]\d{2}(:\d{2})?)?)?)?)?$/;
const LANG = /^(|[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*)$/;
const items = (v: string): string[] => (v === "" ? [] : v.split("[,]"));

const mismatch = (why: string): [string, string] => ["406", why];
const range = (why: string): [string, string] => ["407", why];
const vocab = (words: string[]): Check => (v) => (words.includes(v) ? null : mismatch(`it must be one of ${words.map((w) => `"${w}"`).join(", ")}`));
const upTo = (n: number): Check => (v) => (v.length <= n ? null : mismatch(`it may be at most ${n} characters, and this is ${v.length}`));
const real = (min?: number, max?: number): Check => (v) => {
  if (!REAL.test(v)) return mismatch("it must be a number written with digits, as 0.85");
  if ((min !== undefined && Number(v) < min) || (max !== undefined && Number(v) > max)) return range(`it must be from ${min ?? "any"} to ${max ?? "any"}`);
  return null;
};
const duration: Check = (v) => (parseDuration(v) !== null ? null : mismatch("it must be an ISO 8601 duration, as PT1H5M30S"));
const timestamp: Check = (v) => (TIMESTAMP.test(v) ? null : mismatch("it must be a date and time, as 2026-11-17T14:30:05"));
const longId: Check = (v) => (v.length > 0 && v.length <= 4000 && !/\s/.test(v) ? null : mismatch("it must be up to 4000 characters with no spaces"));
const lang: Check = (v) => (LANG.test(v) ? null : mismatch("it must be a language code, as en or en-US"));
/** A localized string may start with {lang=xx}; only the text after it counts toward the limit. */
const localized = (n: number): Check => (v) => {
  const m = /^\{lang=([^}]*)\}/.exec(v);
  if (m && !LANG.test(m[1]!)) return mismatch("its {lang=...} is not a language code");
  return upTo(n)(m ? v.slice(m[0].length) : v, "");
};

const COMPLETION = ["completed", "incomplete", "not attempted", "unknown"];
const SUCCESS = ["passed", "failed", "unknown"];

const STATIC: Record<string, Element> = {
  "cmi._version": { access: "ro" },
  "cmi.completion_status": { access: "rw", check: vocab(COMPLETION) },
  "cmi.completion_threshold": { access: "ro" },
  "cmi.credit": { access: "ro" },
  "cmi.entry": { access: "ro" },
  "cmi.exit": { access: "wo", check: vocab(["time-out", "suspend", "logout", "normal", ""]) },
  "cmi.launch_data": { access: "ro" },
  "cmi.learner_id": { access: "ro" },
  "cmi.learner_name": { access: "ro" },
  "cmi.learner_preference.audio_level": { access: "rw", check: real(0) },
  "cmi.learner_preference.language": { access: "rw", check: lang },
  "cmi.learner_preference.delivery_speed": { access: "rw", check: real(0) },
  "cmi.learner_preference.audio_captioning": { access: "rw", check: vocab(["-1", "0", "1"]) },
  "cmi.location": { access: "rw", check: upTo(1000) },
  "cmi.max_time_allowed": { access: "ro" },
  "cmi.mode": { access: "ro" },
  "cmi.progress_measure": { access: "rw", check: real(0, 1) },
  "cmi.scaled_passing_score": { access: "ro" },
  "cmi.score.scaled": { access: "rw", check: real(-1, 1) },
  "cmi.score.raw": { access: "rw", check: real() },
  "cmi.score.min": { access: "rw", check: real() },
  "cmi.score.max": { access: "rw", check: real() },
  "cmi.session_time": { access: "wo", check: duration },
  "cmi.success_status": { access: "rw", check: vocab(SUCCESS) },
  "cmi.suspend_data": { access: "rw", check: upTo(64000) },
  "cmi.time_limit_action": { access: "ro" },
  "cmi.total_time": { access: "ro" },
  "adl.nav.request": { access: "rw", check: (v) => (/^(continue|previous|exit|exitAll|abandon|abandonAll|suspendAll|_none_)$/.test(v) || /^\{target=[^}\s]+\}(choice|jump)$/.test(v) ? null : mismatch('it must be "continue", "previous", "exit", "exitAll", "abandon", "abandonAll", "suspendAll", "_none_", or {target=ID}choice or {target=ID}jump')) },
  "adl.nav.request_valid.continue": { access: "ro" },
  "adl.nav.request_valid.previous": { access: "ro" },
};

const CHILDREN: Record<string, string> = {
  "cmi.comments_from_learner": "comment,location,timestamp",
  "cmi.comments_from_lms": "comment,location,timestamp",
  "cmi.interactions": "id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description",
  "cmi.learner_preference": "audio_level,language,delivery_speed,audio_captioning",
  "cmi.objectives": "id,score,success_status,completion_status,progress_measure,description",
  "cmi.score": "scaled,raw,min,max",
};

const OBJECTIVE: Record<string, Element> = {
  id: { access: "rw", check: longId },
  "score.scaled": { access: "rw", check: real(-1, 1) },
  "score.raw": { access: "rw", check: real() },
  "score.min": { access: "rw", check: real() },
  "score.max": { access: "rw", check: real() },
  success_status: { access: "rw", check: vocab(SUCCESS) },
  completion_status: { access: "rw", check: vocab(COMPLETION) },
  progress_measure: { access: "rw", check: real(0, 1) },
  description: { access: "rw", check: localized(250) },
};
const COMMENT: Record<string, Element> = {
  comment: { access: "rw", check: localized(4000) },
  location: { access: "rw", check: upTo(250) },
  timestamp: { access: "rw", check: timestamp },
};
const TYPES = ["true-false", "choice", "fill-in", "long-fill-in", "matching", "performance", "sequencing", "likert", "numeric", "other"];
const INTERACTION: Record<string, Element> = {
  id: { access: "rw", check: longId },
  type: { access: "rw", check: vocab(TYPES) },
  timestamp: { access: "rw", check: timestamp },
  weighting: { access: "rw", check: real() },
  result: { access: "rw", check: (v) => (["correct", "incorrect", "unanticipated", "neutral"].includes(v) || REAL.test(v) ? null : mismatch('it must be "correct", "incorrect", "unanticipated", "neutral" or a number')) },
  latency: { access: "rw", check: duration },
  description: { access: "rw", check: localized(250) },
};

/** Whether an answer suits the interaction's type, as SCORM 2004 writes answers. Null when it does. */
function response(type: string, value: string): string | null {
  switch (type) {
    case "true-false": return value === "true" || value === "false" ? null : 'a true-false answer must be "true" or "false"';
    case "choice":
    case "sequencing": return items(value).every((s) => SHORT_ID.test(s)) ? null : `${type} answers are ids separated by [,], with no spaces`;
    case "likert": return SHORT_ID.test(value) ? null : "a likert answer is one id, with no spaces";
    case "numeric": return REAL.test(value) ? null : "a numeric answer must be a number";
    case "matching": return items(value).every((p) => /^[^[\]]+\[\.\][^[\]]+$/.test(p) && p.split("[.]").every((s) => SHORT_ID.test(s))) ? null : "matching answers are pairs written source[.]target, separated by [,]";
    case "fill-in": return items(value).length <= 10 && items(value).every((s) => s.length <= 250) ? null : "a fill-in answer has at most 10 parts of 250 characters";
    case "long-fill-in": return value.length <= 4000 ? null : "a long fill-in answer has at most 4000 characters";
    default: return value.length <= 4000 ? null : "an answer has at most 4000 characters";
  }
}

function pattern(type: string, value: string): string | null {
  switch (type) {
    case "fill-in":
    case "long-fill-in": {
      const body = value.replace(/^(\{(case_matters|order_matters|lang=[^}]*)=?(true|false)?\})*/, "");
      return type === "long-fill-in" ? null : items(body).length <= 10 ? null : "a fill-in pattern has at most 10 parts";
    }
    case "numeric": return /^(-?\d+(\.\d+)?)?(\[:\](-?\d+(\.\d+)?)?)?$/.test(value) && value !== "" ? null : "a numeric pattern is a number or a range written min[:]max";
    case "choice":
    case "sequencing": return items(value).every((s) => SHORT_ID.test(s)) ? null : `${type} patterns are ids separated by [,], with no spaces`;
    case "performance": return null;
    default: return response(type, value);
  }
}

/** The settings the LMS starts the course with, from the manifest. */
export interface Scorm2004Start {
  launchData?: string;
  scaledPassingScore?: number;
  completionThreshold?: number;
  maxTimeAllowed?: string;
  timeLimitAction?: string;
}

type Found = { element: Element; array?: { base: string; index: number; count: number } } | { keyword: string } | { error: string; reason: string };

export class Scorm2004Lms {
  mode: Mode = "normal";
  onCall: (c: ApiCall) => void = () => {};
  record: LearnerRecord;
  /** Whether the test player has a part to go to next and before, for adl.nav.request_valid. */
  navigation = { continue: false, previous: false, targets: [] as string[] };
  private readonly start: Scorm2004Start;
  private state: "new" | "running" | "terminated" = "new";
  private error = "0";
  private session: Record<string, string> = {};

  constructor(start: Scorm2004Start = {}, record: LearnerRecord = newRecord()) {
    this.start = start;
    this.record = record;
  }

  get started(): boolean {
    return this.state !== "new";
  }
  get finished(): boolean {
    return this.state === "terminated";
  }

  /** Everything the LMS holds for this learner now, with completion and success as the LMS works them out. */
  get data(): Record<string, string> {
    const all = { ...this.record.data, ...this.session };
    all["cmi.completion_status"] = this.completion();
    all["cmi.success_status"] = this.success();
    return all;
  }

  /** The navigation request the course left, if any. */
  get navRequest(): string {
    return this.record.data["adl.nav.request"] ?? "_none_";
  }

  Initialize(arg: unknown = ""): string {
    if (arg !== "") return this.done("Initialize", [arg], "false", "201", "Initialize takes an empty string.");
    if (this.state === "running") return this.done("Initialize", [arg], "false", "103", "Initialize was called twice.");
    if (this.state === "terminated") return this.done("Initialize", [arg], "false", "104", "Terminate has been called; a new launch is needed to start again.");
    this.state = "running";
    const d = this.record.data;
    const resuming = d["cmi.exit"] === "suspend";
    // Unless the learner suspended, the last attempt is over and this launch starts a new one with an empty record.
    if (!resuming && this.record.launches > 0) {
      this.record.data = {};
      this.record.totalTime = 0;
    }
    this.record.launches++;
    const data = this.record.data;
    delete data["cmi.exit"];
    delete data["cmi.session_time"];
    delete data["adl.nav.request"];
    this.session = {
      "cmi._version": "1.0",
      "cmi.credit": this.mode === "normal" ? "credit" : "no-credit",
      "cmi.entry": resuming ? "resume" : "ab-initio",
      "cmi.mode": this.mode,
      "cmi.learner_id": LEARNER.id,
      "cmi.learner_name": LEARNER.name,
      "cmi.total_time": duration2004(this.record.totalTime),
    };
    if (this.start.launchData !== undefined) this.session["cmi.launch_data"] = this.start.launchData;
    if (this.start.scaledPassingScore !== undefined) this.session["cmi.scaled_passing_score"] = String(this.start.scaledPassingScore);
    if (this.start.completionThreshold !== undefined) this.session["cmi.completion_threshold"] = String(this.start.completionThreshold);
    if (this.start.maxTimeAllowed !== undefined) this.session["cmi.max_time_allowed"] = this.start.maxTimeAllowed;
    this.session["cmi.time_limit_action"] = this.start.timeLimitAction ?? "continue,no message";
    data["cmi.completion_status"] ??= "unknown";
    data["cmi.success_status"] ??= "unknown";
    return this.done("Initialize", [arg], "true", "0");
  }

  GetValue(element: unknown): string {
    const args = [element];
    if (this.state !== "running") return this.done("GetValue", args, "", this.state === "new" ? "122" : "123", this.state === "new" ? "Initialize has not been called yet." : "Terminate has already been called.");
    const el = String(element);
    if (el === "") return this.done("GetValue", args, "", "301", "GetValue was given no element name.");
    if (el === "adl.nav.request_valid.continue") return this.done("GetValue", args, String(this.navigation.continue), "0");
    if (el === "adl.nav.request_valid.previous") return this.done("GetValue", args, String(this.navigation.previous), "0");
    const choice = /^adl\.nav\.request_valid\.(choice|jump)\.\{target=([^}]+)\}$/.exec(el);
    if (choice) return this.done("GetValue", args, String(this.navigation.targets.includes(choice[2]!)), "0");
    if (el === "cmi.completion_status") return this.done("GetValue", args, this.completion(), "0");
    if (el === "cmi.success_status") return this.done("GetValue", args, this.success(), "0");
    const found = this.find(el);
    if ("error" in found) return this.done("GetValue", args, "", found.error, found.reason);
    if ("keyword" in found) return this.done("GetValue", args, found.keyword, "0");
    if (found.element.access === "wo") return this.done("GetValue", args, "", "405", `${el} can be written but not read.`);
    const value = this.session[el] ?? this.record.data[el];
    if (value === undefined) return this.done("GetValue", args, "", "403", `${el} has no value yet. The course should set it before reading it, or check GetLastError.`);
    return this.done("GetValue", args, value, "0");
  }

  SetValue(element: unknown, value: unknown): string {
    const args = [element, value];
    if (this.state !== "running") return this.done("SetValue", args, "false", this.state === "new" ? "132" : "133", this.state === "new" ? "Initialize has not been called yet." : "Terminate has already been called.");
    const el = String(element);
    if (typeof value !== "string" && typeof value !== "number") return this.done("SetValue", args, "false", "406", "The value must be text.");
    const v = String(value);
    if (el === "") return this.done("SetValue", args, "false", "351", "SetValue was given no element name.");
    const found = this.find(el);
    if ("error" in found) return this.done("SetValue", args, "false", found.error, found.reason);
    if ("keyword" in found) return this.done("SetValue", args, "false", "404", `${el} is kept by the LMS and the course may only read it.`);
    if (found.element.access === "ro") return this.done("SetValue", args, "false", "404", `${el} is set by the LMS and the course may only read it.`);
    if (found.array && found.array.index > found.array.count) {
      return this.done("SetValue", args, "false", "351", `${found.array.base} has ${found.array.count} so far, so the next one must be number ${found.array.count}, not ${found.array.index}.`);
    }
    const bad = found.element.check?.(v, el) ?? this.dependent(el, v, found);
    if (bad) return this.done("SetValue", args, "false", bad[0], `${el} was given "${short(v, 60)}", but ${bad[1]}.`);
    if (this.mode !== "normal" && el.startsWith("cmi.")) return this.done("SetValue", args, "true", "0", undefined, `In ${this.mode} mode an LMS accepts this but does not keep it.`);
    this.record.data[el] = v;
    return this.done("SetValue", args, "true", "0");
  }

  Commit(arg: unknown = ""): string {
    if (this.state !== "running") return this.done("Commit", [arg], "false", this.state === "new" ? "142" : "143", this.state === "new" ? "Initialize has not been called yet." : "Terminate has already been called.");
    if (arg !== "") return this.done("Commit", [arg], "false", "201", "Commit takes an empty string.");
    return this.done("Commit", [arg], "true", "0");
  }

  Terminate(arg: unknown = ""): string {
    if (this.state === "new") return this.done("Terminate", [arg], "false", "112", "Initialize has not been called yet.");
    if (this.state === "terminated") return this.done("Terminate", [arg], "false", "113", "Terminate was called twice.");
    if (arg !== "") return this.done("Terminate", [arg], "false", "201", "Terminate takes an empty string.");
    this.state = "terminated";
    const d = this.record.data;
    const notes: string[] = [];
    const session = parseDuration(d["cmi.session_time"] ?? "");
    if (session !== null) this.record.totalTime += session;
    const completion = this.completion();
    if (completion !== d["cmi.completion_status"]) notes.push(`The LMS records completion as ${completion}: the progress the course reported (${d["cmi.progress_measure"] ?? "none"}) against the completion threshold ${this.start.completionThreshold}.`);
    const success = this.success();
    if (success !== d["cmi.success_status"]) notes.push(`The LMS records ${success}: the scaled score (${d["cmi.score.scaled"] ?? "none"}) against the passing score ${this.start.scaledPassingScore}.`);
    if (this.mode === "normal") {
      d["cmi.completion_status"] = completion;
      d["cmi.success_status"] = success;
    }
    const nav = d["adl.nav.request"];
    if (nav && nav !== "_none_") notes.push(`The course asked the LMS to ${nav}.`);
    return this.done("Terminate", [arg], "true", "0", undefined, notes.join(" ") || undefined);
  }

  GetLastError(): string {
    return this.error;
  }
  GetErrorString(code: unknown): string {
    return ERRORS[String(code)] ?? "";
  }
  GetDiagnostic(code: unknown): string {
    return ERRORS[String(code === "" || code === undefined ? this.error : code)] ?? "";
  }

  // ---- internals

  /** completion_status as an LMS reports it: from the progress and the threshold when the manifest gives one. */
  private completion(): string {
    const d = this.record.data;
    const threshold = this.start.completionThreshold;
    if (threshold !== undefined) {
      const progress = d["cmi.progress_measure"];
      if (progress !== undefined) return Number(progress) >= threshold ? "completed" : "incomplete";
      return "unknown";
    }
    return d["cmi.completion_status"] ?? "unknown";
  }

  /** success_status as an LMS reports it: from the scaled score and the passing score when the manifest gives one. */
  private success(): string {
    const d = this.record.data;
    const passing = this.start.scaledPassingScore;
    if (passing !== undefined) {
      const scaled = d["cmi.score.scaled"];
      return scaled === undefined ? "unknown" : Number(scaled) >= passing ? "passed" : "failed";
    }
    return d["cmi.success_status"] ?? "unknown";
  }

  private done(call: string, args: unknown[], result: string, error: string, reason?: string, note?: string): string {
    this.error = error;
    const c: ApiCall = { call, args: args.map((a) => (a === undefined ? "" : String(a))), result, error };
    if (reason) c.reason = reason;
    if (note) c.note = note;
    this.onCall(c);
    return result;
  }

  private count(base: string): number {
    let n = 0;
    for (const k of Object.keys(this.record.data)) {
      if (!k.startsWith(base + ".")) continue;
      const i = Number(k.slice(base.length + 1).split(".")[0]);
      if (Number.isInteger(i)) n = Math.max(n, i + 1);
    }
    return n;
  }

  /** The checks that depend on other values: an interaction's id comes first, its answers suit its type, raw within min and max. */
  private dependent(el: string, v: string, found: Found): [string, string] | null {
    if ("error" in found || "keyword" in found) return null;
    const score = /^cmi\.(objectives\.\d+\.)?score\.(raw|min|max)$/.exec(el);
    if (score) {
      const base = el.slice(0, el.lastIndexOf(".") + 1);
      const get = (k: string) => (k === score[2] ? v : this.record.data[base + k]);
      const [raw, min, max] = [get("raw"), get("min"), get("max")].map((x) => (x === undefined ? undefined : Number(x)));
      if (min !== undefined && max !== undefined && min > max) return range(`the minimum ${min} is above the maximum ${max}`);
      if (raw !== undefined && min !== undefined && raw < min) return range(`the raw score ${raw} is below the minimum ${min}`);
      if (raw !== undefined && max !== undefined && raw > max) return range(`the raw score ${raw} is above the maximum ${max}`);
      return null;
    }
    const inter = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(el);
    const obj = /^cmi\.objectives\.(\d+)\.(.+)$/.exec(el);
    const list = inter ?? obj;
    if (list && list[2] !== "id" && this.record.data[`cmi.${inter ? "interactions" : "objectives"}.${list[1]}.id`] === undefined) {
      return ["408", `its id (cmi.${inter ? "interactions" : "objectives"}.${list[1]}.id) must be set first`];
    }
    if (inter && /^(learner_response|correct_responses\.\d+\.pattern)$/.test(inter[2]!)) {
      const type = this.record.data[`cmi.interactions.${inter[1]}.type`];
      if (!type) return ["408", `the interaction's type (cmi.interactions.${inter[1]}.type) must be set first, because the answer's form depends on it`];
      const why = inter[2] === "learner_response" ? response(type, v) : pattern(type, v);
      return why ? mismatch(why) : null;
    }
    return null;
  }

  private find(el: string): Found {
    if (STATIC[el]) return { element: STATIC[el] };
    if (el.endsWith("._children")) {
      const base = el.slice(0, -"._children".length);
      if (CHILDREN[base]) return { keyword: CHILDREN[base] };
      if (/^cmi\.objectives\.\d+\.score$/.test(base)) return { keyword: "scaled,raw,min,max" };
      return { error: "301", reason: `${base} has no parts to list.` };
    }
    if (el.endsWith("._count")) {
      const base = el.slice(0, -"._count".length);
      if (/^cmi\.(objectives|interactions|comments_from_learner|comments_from_lms)$/.test(base) || /^cmi\.interactions\.\d+\.(objectives|correct_responses)$/.test(base)) return { keyword: String(this.count(base)) };
      if (base === "adl.data") return { keyword: "0" };
      return { error: "301", reason: `${base} is not a list, so it has no count.` };
    }
    const lists: [RegExp, string, Record<string, Element>][] = [
      [/^cmi\.objectives\.(\d+)\.(.+)$/, "cmi.objectives", OBJECTIVE],
      [/^cmi\.comments_from_learner\.(\d+)\.(.+)$/, "cmi.comments_from_learner", COMMENT],
    ];
    for (const [re, base, fields] of lists) {
      const m = re.exec(el);
      if (!m) continue;
      const field = fields[m[2]!];
      if (!field) return { error: "401", reason: `${el} is not in the SCORM 2004 data model.` };
      return { element: field, array: { base, index: Number(m[1]), count: this.count(base) } };
    }
    const lms = /^cmi\.comments_from_lms\.(\d+)\.(comment|location|timestamp)$/.exec(el);
    if (lms) return { error: "301", reason: "The LMS has given no comments, so there is none to read." };
    const inter = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(el);
    if (inter) {
      const base = `cmi.interactions.${inter[1]}`;
      const array = { base: "cmi.interactions", index: Number(inter[1]), count: this.count("cmi.interactions") };
      const sub = /^(objectives\.(\d+)\.id|correct_responses\.(\d+)\.pattern)$/.exec(inter[2]!);
      if (sub) {
        // Until the interaction itself exists, the parts inside it are checked against it: its id comes first.
        if (array.index >= array.count) return { element: { access: "rw" }, array };
        const which = sub[2] !== undefined ? "objectives" : "correct_responses";
        const inner = { base: `${base}.${which}`, index: Number(sub[2] ?? sub[3]), count: this.count(`${base}.${which}`) };
        return { element: which === "objectives" ? { access: "rw", check: longId } : { access: "rw" }, array: inner };
      }
      if (inter[2] === "learner_response") return { element: { access: "rw" }, array };
      const field = INTERACTION[inter[2]!];
      if (!field) return { error: "401", reason: `${el} is not part of an interaction in SCORM 2004.` };
      return { element: field, array };
    }
    if (/^adl\.data\./.test(el)) return { error: "301", reason: "This package shares no data stores (adl.data), so there is none to read or write." };
    if (/^(cmi|adl)\./.test(el)) {
      const hint = /^cmi\.(core\.|student_|objectives\.\d+\.status)/.test(el) ? " That is a SCORM 1.2 name; the course may have been published for the other version." : "";
      return { error: "401", reason: `${el} is not in the SCORM 2004 data model.${hint}` };
    }
    return { error: "401", reason: `${el} is not a data model element.` };
  }
}
