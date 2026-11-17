// A stand-in SCORM 1.2 LMS: the API object a course finds as window.API, with the whole 1.2 data model. It keeps to the
// standard strictly, as the strictest LMSs do, so a value one LMS quietly accepts and another refuses shows up here as
// refused, with the reason in words. It is a test aid: it does not replace trying the course in the LMS it is for.
// Started from OpenStage Author's player/src/fake-lms.ts.

import { LEARNER, newRecord, parseTimespan12, short, timespan12, type ApiCall, type LearnerRecord, type Mode } from "./scorm-common.ts";

const ERRORS: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "201": "Invalid argument error",
  "202": "Element cannot have children",
  "203": "Element not an array. Cannot have count",
  "301": "Not initialized",
  "401": "Not implemented error",
  "402": "Invalid set value, element is a keyword",
  "403": "Element is read only",
  "404": "Element is write only",
  "405": "Incorrect data type",
};

type Check = (v: string) => string | null;
interface Element {
  access: "ro" | "rw" | "wo";
  check?: Check;
}

const STATUS = ["passed", "completed", "failed", "incomplete", "browsed"];
const vocab = (words: string[]): Check => (v) => (words.includes(v) ? null : `it must be one of ${words.map((w) => `"${w}"`).join(", ")}`);
const upTo = (n: number): Check => (v) => (v.length <= n ? null : `it may be at most ${n} characters, and this is ${v.length}`);
const decimal: Check = (v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? null : "it must be a number");
const score: Check = (v) => (v === "" ? null : decimal(v) ?? (Number(v) >= 0 && Number(v) <= 100 ? null : "SCORM 1.2 scores run from 0 to 100"));
const integer = (min: number, max: number): Check => (v) => (/^-?\d+$/.test(v) && Number(v) >= min && Number(v) <= max ? null : `it must be a whole number from ${min} to ${max}`);
const identifier: Check = (v) => (v.length > 0 && v.length <= 255 && !/\s/.test(v) ? null : "it must be 1 to 255 characters with no spaces");
const timespan: Check = (v) => (parseTimespan12(v) !== null ? null : "it must be hours:minutes:seconds, as 0000:12:30 or 00:12:30.5");
const time: Check = (v) => (/^\d{2}:\d{2}:\d{2}(\.\d{1,2})?$/.test(v) && Number(v.slice(0, 2)) < 24 ? null : "it must be a time of day, as 14:30:05");

const STATIC: Record<string, Element> = {
  "cmi.core.student_id": { access: "ro" },
  "cmi.core.student_name": { access: "ro" },
  "cmi.core.lesson_location": { access: "rw", check: upTo(255) },
  "cmi.core.credit": { access: "ro" },
  "cmi.core.lesson_status": { access: "rw", check: vocab(STATUS) },
  "cmi.core.entry": { access: "ro" },
  "cmi.core.score.raw": { access: "rw", check: score },
  "cmi.core.score.min": { access: "rw", check: score },
  "cmi.core.score.max": { access: "rw", check: score },
  "cmi.core.total_time": { access: "ro" },
  "cmi.core.lesson_mode": { access: "ro" },
  "cmi.core.exit": { access: "wo", check: vocab(["time-out", "suspend", "logout", ""]) },
  "cmi.core.session_time": { access: "wo", check: timespan },
  "cmi.suspend_data": { access: "rw", check: upTo(4096) },
  "cmi.launch_data": { access: "ro" },
  "cmi.comments": { access: "rw", check: upTo(4096) },
  "cmi.comments_from_lms": { access: "ro" },
  "cmi.student_data.mastery_score": { access: "ro" },
  "cmi.student_data.max_time_allowed": { access: "ro" },
  "cmi.student_data.time_limit_action": { access: "ro" },
  "cmi.student_preference.audio": { access: "rw", check: integer(-1, 100) },
  "cmi.student_preference.language": { access: "rw", check: upTo(255) },
  "cmi.student_preference.speed": { access: "rw", check: integer(-100, 100) },
  "cmi.student_preference.text": { access: "rw", check: integer(-1, 1) },
};

const CHILDREN: Record<string, string> = {
  "cmi.core": "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
  "cmi.core.score": "raw,min,max",
  "cmi.objectives": "id,score,status",
  "cmi.student_data": "mastery_score,max_time_allowed,time_limit_action",
  "cmi.student_preference": "audio,language,speed,text",
  "cmi.interactions": "id,objectives,time,type,correct_responses,weighting,student_response,result,latency",
};

/** Fields of one objective or interaction: the part after cmi.objectives.n. or cmi.interactions.n. */
const OBJECTIVE: Record<string, Element> = {
  id: { access: "rw", check: identifier },
  "score.raw": { access: "rw", check: (v) => (v === "" ? null : decimal(v)) },
  "score.min": { access: "rw", check: (v) => (v === "" ? null : decimal(v)) },
  "score.max": { access: "rw", check: (v) => (v === "" ? null : decimal(v)) },
  status: { access: "rw", check: vocab([...STATUS, "not attempted"]) },
};
const INTERACTION: Record<string, Element> = {
  id: { access: "wo", check: identifier },
  time: { access: "wo", check: time },
  type: { access: "wo", check: vocab(["true-false", "choice", "fill-in", "matching", "performance", "sequencing", "likert", "numeric"]) },
  weighting: { access: "wo", check: decimal },
  student_response: { access: "wo", check: upTo(255) },
  result: { access: "wo", check: (v) => (["correct", "wrong", "unanticipated", "neutral"].includes(v) || decimal(v) === null ? null : 'it must be "correct", "wrong", "unanticipated", "neutral" or a number') },
  latency: { access: "wo", check: timespan },
};

/** The settings the LMS starts the course with, from the manifest. */
export interface Scorm12Start {
  launchData?: string;
  masteryScore?: number;
  maxTimeAllowed?: string;
  timeLimitAction?: string;
}

type Found = { element: Element; array?: { base: string; index: number; count: number } } | { keyword: string } | { error: string; reason: string };

export class Scorm12Lms {
  mode: Mode = "normal";
  /** Called after every call the course makes. */
  onCall: (c: ApiCall) => void = () => {};
  record: LearnerRecord;
  private readonly start: Scorm12Start;
  private state: "new" | "running" | "finished" = "new";
  private error = "0";
  private session: Record<string, string> = {};

  constructor(start: Scorm12Start = {}, record: LearnerRecord = newRecord()) {
    this.start = start;
    this.record = record;
  }

  /** Whether the course has called LMSInitialize, and LMSFinish. */
  get started(): boolean {
    return this.state !== "new";
  }
  get finished(): boolean {
    return this.state === "finished";
  }

  /** Everything the LMS holds for this learner now, read-only values included. */
  get data(): Record<string, string> {
    return { ...this.record.data, ...this.session };
  }

  LMSInitialize(arg: unknown = ""): string {
    if (arg !== "") return this.done("LMSInitialize", [arg], "false", "201", "LMSInitialize takes an empty string.");
    if (this.state === "running") return this.done("LMSInitialize", [arg], "false", "101", "The course was already started; LMSInitialize was called twice.");
    if (this.state === "finished") return this.done("LMSInitialize", [arg], "false", "101", "LMSFinish has been called; a new launch is needed to start again.");
    this.state = "running";
    const d = this.record.data;
    const resuming = d["cmi.core.exit"] === "suspend";
    this.record.launches++;
    this.session = {
      "cmi.core.student_id": LEARNER.id,
      "cmi.core.student_name": LEARNER.name,
      "cmi.core.credit": this.mode === "normal" ? "credit" : "no-credit",
      "cmi.core.entry": resuming ? "resume" : this.record.launches === 1 ? "ab-initio" : "",
      "cmi.core.lesson_mode": this.mode,
      "cmi.core.total_time": timespan12(this.record.totalTime),
      "cmi.launch_data": this.start.launchData ?? "",
      "cmi.comments_from_lms": "",
      "cmi.student_data.mastery_score": this.start.masteryScore !== undefined ? String(this.start.masteryScore) : "",
      "cmi.student_data.max_time_allowed": this.start.maxTimeAllowed ?? "",
      "cmi.student_data.time_limit_action": this.start.timeLimitAction ?? "",
    };
    delete d["cmi.core.exit"];
    delete d["cmi.core.session_time"];
    d["cmi.core.lesson_status"] ??= "not attempted";
    return this.done("LMSInitialize", [arg], "true", "0");
  }

  LMSGetValue(element: unknown): string {
    const args = [element];
    if (this.state !== "running") return this.done("LMSGetValue", args, "", "301", this.state === "new" ? "LMSInitialize has not been called yet." : "LMSFinish has already been called.");
    const el = String(element);
    const found = this.find(el);
    if ("error" in found) return this.done("LMSGetValue", args, "", found.error, found.reason);
    if ("keyword" in found) return this.done("LMSGetValue", args, found.keyword, "0");
    if (found.element.access === "wo") return this.done("LMSGetValue", args, "", "404", `${el} can be written but not read.`);
    return this.done("LMSGetValue", args, this.session[el] ?? this.record.data[el] ?? "", "0");
  }

  LMSSetValue(element: unknown, value: unknown): string {
    const args = [element, value];
    if (this.state !== "running") return this.done("LMSSetValue", args, "false", "301", this.state === "new" ? "LMSInitialize has not been called yet." : "LMSFinish has already been called.");
    const el = String(element);
    if (typeof value !== "string" && typeof value !== "number") return this.done("LMSSetValue", args, "false", "405", "The value must be text.");
    const v = String(value);
    const found = this.find(el);
    if ("error" in found) return this.done("LMSSetValue", args, "false", found.error, found.reason);
    if ("keyword" in found) return this.done("LMSSetValue", args, "false", "402", `${el} is the LMS's own list and cannot be set.`);
    if (found.element.access === "ro") return this.done("LMSSetValue", args, "false", "403", `${el} is set by the LMS and the course may only read it.`);
    if (found.array && found.array.index > found.array.count) {
      return this.done("LMSSetValue", args, "false", "201", `${found.array.base} has ${found.array.count} so far, so the next one must be number ${found.array.count}, not ${found.array.index}.`);
    }
    const bad = found.element.check?.(v);
    if (bad) return this.done("LMSSetValue", args, "false", "405", `${el} was given "${short(v, 60)}", but ${bad}.`);
    if (this.mode !== "normal") return this.done("LMSSetValue", args, "true", "0", undefined, `In ${this.mode} mode an LMS accepts this but does not keep it.`);
    this.record.data[el] = v;
    return this.done("LMSSetValue", args, "true", "0");
  }

  LMSCommit(arg: unknown = ""): string {
    if (this.state !== "running") return this.done("LMSCommit", [arg], "false", "301", this.state === "new" ? "LMSInitialize has not been called yet." : "LMSFinish has already been called.");
    if (arg !== "") return this.done("LMSCommit", [arg], "false", "201", "LMSCommit takes an empty string.");
    return this.done("LMSCommit", [arg], "true", "0");
  }

  LMSFinish(arg: unknown = ""): string {
    if (this.state !== "running") return this.done("LMSFinish", [arg], "false", "301", this.state === "new" ? "LMSInitialize has not been called yet." : "LMSFinish was called twice.");
    if (arg !== "") return this.done("LMSFinish", [arg], "false", "201", "LMSFinish takes an empty string.");
    this.state = "finished";
    const d = this.record.data;
    const notes: string[] = [];
    const session = parseTimespan12(d["cmi.core.session_time"] ?? "");
    if (session !== null) this.record.totalTime += session;
    // What an LMS does with a passing score: the score decides passed or failed, whatever the course said.
    const mastery = this.start.masteryScore;
    const raw = d["cmi.core.score.raw"];
    if (mastery !== undefined && this.mode === "normal" && raw !== undefined && raw !== "") {
      const status = Number(raw) >= mastery ? "passed" : "failed";
      if (d["cmi.core.lesson_status"] !== status) notes.push(`The LMS set the status to ${status}: the score ${raw} is ${status === "passed" ? "at or above" : "below"} the passing score ${mastery} (adlcp:masteryscore).`);
      d["cmi.core.lesson_status"] = status;
    }
    return this.done("LMSFinish", [arg], "true", "0", undefined, notes.join(" ") || undefined);
  }

  LMSGetLastError(): string {
    return this.error;
  }
  LMSGetErrorString(code: unknown): string {
    return ERRORS[String(code)] ?? "";
  }
  LMSGetDiagnostic(code: unknown): string {
    return ERRORS[String(code === "" || code === undefined ? this.error : code)] ?? "";
  }

  // ---- internals

  private done(call: string, args: unknown[], result: string, error: string, reason?: string, note?: string): string {
    this.error = error;
    const c: ApiCall = { call, args: args.map((a) => (a === undefined ? "" : String(a))), result, error };
    if (reason) c.reason = reason;
    if (note) c.note = note;
    this.onCall(c);
    return result;
  }

  private count(base: string): number {
    const at = base.length + 1;
    let n = 0;
    for (const k of Object.keys(this.record.data)) {
      if (!k.startsWith(base + ".")) continue;
      const i = Number(k.slice(at).split(".")[0]);
      if (Number.isInteger(i)) n = Math.max(n, i + 1);
    }
    return n;
  }

  private find(el: string): Found {
    if (STATIC[el]) return { element: STATIC[el] };
    if (el.endsWith("._children")) {
      const base = el.slice(0, -"._children".length);
      if (CHILDREN[base]) return { keyword: CHILDREN[base] };
      if (/^cmi\.(objectives|interactions)\.\d+\.score$/.test(base) || /^cmi\.objectives\.\d+\.score$/.test(base)) return { keyword: "raw,min,max" };
      return { error: "202", reason: `${base} has no parts to list.` };
    }
    if (el.endsWith("._count")) {
      const base = el.slice(0, -"._count".length);
      if (base === "cmi.objectives" || base === "cmi.interactions" || /^cmi\.interactions\.\d+\.(objectives|correct_responses)$/.test(base)) return { keyword: String(this.count(base)) };
      return { error: "203", reason: `${base} is not a list, so it has no count.` };
    }
    const obj = /^cmi\.objectives\.(\d+)\.(.+)$/.exec(el);
    if (obj) {
      const field = OBJECTIVE[obj[2]!];
      if (!field) return { error: "201", reason: `${el} is not part of an objective in SCORM 1.2.` };
      return { element: field, array: { base: "cmi.objectives", index: Number(obj[1]), count: this.count("cmi.objectives") } };
    }
    const inter = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(el);
    if (inter) {
      const base = `cmi.interactions.${inter[1]}`;
      const array = { base: "cmi.interactions", index: Number(inter[1]), count: this.count("cmi.interactions") };
      const sub = /^(objectives|correct_responses)\.(\d+)\.(id|pattern)$/.exec(inter[2]!);
      if (sub && ((sub[1] === "objectives" && sub[3] === "id") || (sub[1] === "correct_responses" && sub[3] === "pattern"))) {
        if (array.index > array.count) return { element: INTERACTION.id!, array };
        const inner = { base: `${base}.${sub[1]}`, index: Number(sub[2]), count: this.count(`${base}.${sub[1]}`) };
        return { element: sub[1] === "objectives" ? INTERACTION.id! : { access: "wo", check: upTo(255) }, array: inner };
      }
      const field = INTERACTION[inter[2]!];
      if (!field) return { error: "201", reason: `${el} is not part of an interaction in SCORM 1.2.` };
      return { element: field, array };
    }
    if (/^cmi\./.test(el)) {
      // A SCORM 2004 name sent to a SCORM 1.2 LMS is a common mistake; say so.
      const hint = /^cmi\.(completion_status|success_status|location|exit|session_time|score\.scaled|learner_)/.test(el) ? " That is a SCORM 2004 name; the course may have been published for the other version." : "";
      return { error: "201", reason: `${el} is not in the SCORM 1.2 data model.${hint}` };
    }
    return { error: "201", reason: `${el || "(nothing)"} is not a data model element.` };
  }
}
