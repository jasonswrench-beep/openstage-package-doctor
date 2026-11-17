// One sitting of the test player: a package, the parts of it that can be launched, a stand-in LMS or LRS for each launch,
// and the log of everything the course said to it. It answers the requests the course's pages make (its files, and for
// xAPI and cmi5 the LRS) and turns what it saw into findings. It holds no window: the Package Doctor window puts the
// course in a frame, hands this the requests, and shows the log. Nothing is sent anywhere, and nothing is kept once the
// window closes.

import { finding, type Finding, type Severity } from "../findings.ts";
import { NEEDED_TO_RUN } from "../links.ts";
import type { OpenedPackage, StartSettings } from "../model.ts";
import { FileIndex, splitReference } from "../paths.ts";
import type { ZipArchive, ZipEntry } from "../zip.ts";
import { Cmi5Lms, type LaunchMode } from "./cmi5.ts";
import { StandInLrs, uuid4, type HttpRequest, type LrsRequest } from "./lrs.ts";
import { duration2004, newRecord, parseDuration, parseTimespan12, short, timespan12, type ApiCall, type LearnerRecord, type Mode } from "./scorm-common.ts";
import { Scorm12Lms } from "./scorm12.ts";
import { Scorm2004Lms } from "./scorm2004.ts";

export type Standard = "scorm12" | "scorm2004" | "cmi5" | "xapi";

export const STANDARD_WORDS: Record<Standard, string> = { scorm12: "SCORM 1.2", scorm2004: "SCORM 2004", cmi5: "cmi5", xapi: "xAPI" };

/** A part of the package the test player can launch. */
export interface Playable {
  index: number;
  title: string;
  /** The file in the zip that opens. */
  file: string;
  /** What follows the file in the manifest's address: ?parameters and #fragment. */
  rest: string;
  /** Whether the LMS tracks it: a SCO, an AU or an activity, not a SCORM asset. */
  tracked: boolean;
  start: StartSettings;
}

/** The parts that can be launched, and those that cannot, with why. */
export function playables(report: OpenedPackage): { standard?: Standard; playable: Playable[]; skipped: { title: string; why: string }[] } {
  const standard = (["scorm12", "scorm2004", "cmi5", "xapi"] as const).find((k) => k === report.kind);
  const playable: Playable[] = [];
  const skipped: { title: string; why: string }[] = [];
  if (!standard) return { playable, skipped };
  for (const l of report.launches) {
    if (!l.file) {
      skipped.push({ title: l.title, why: /^[a-z][a-z0-9+.-]*:/i.test(l.href) ? `It opens ${l.href}, on another website.` : `Its start page, ${l.href}, is not in the package.` });
      continue;
    }
    playable.push({ index: playable.length, title: l.title, file: l.file, rest: splitReference(l.href).rest, tracked: l.tracked !== false, start: l.start ?? { id: l.from } });
  }
  return { standard, playable, skipped };
}

/** One line of the log. */
export interface LogEntry {
  /** Milliseconds since the test player started. */
  at: number;
  /** Which launch this belongs to, counting from 1. */
  launch: number;
  kind: "launch" | "call" | "lrs" | "file" | "lms";
  /** The call or request, as the course made it. */
  text: string;
  /** What the LMS or LRS answered. */
  answer?: string;
  /** Why it was refused, in words. */
  refused?: string;
  /** What the LMS did on its own, in words. */
  note?: string;
}

/** A response for the frame: a file, or an LRS answer. */
export interface PlayResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

const TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", xhtml: "application/xhtml+xml", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  json: "application/json", xml: "application/xml", xsd: "application/xml", dtd: "application/xml-dtd", txt: "text/plain", csv: "text/csv",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", bmp: "image/bmp", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime", vtt: "text/vtt", srt: "text/plain",
  pdf: "application/pdf", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  swf: "application/x-shockwave-flash", wasm: "application/wasm", zip: "application/zip",
};

export function contentType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}

/** How much of the unpacked large files is kept: enough for a few long videos. */
const KEEP_UNPACKED = 256 * 1024 * 1024;

const STATUS_ELEMENTS = /^cmi\.(core\.lesson_status|core\.score\.|completion_status|success_status|score\.)/;

interface Launch {
  number: number;
  playable: Playable;
  mode: Mode;
  startedAt: number;
  ended: boolean;
  scorm?: Scorm12Lms | Scorm2004Lms;
  /** For xAPI and cmi5: how many statements the course had sent before this launch. */
  statementsBefore: number;
  fetchCalls?: string[];
}

export class PlaySession {
  readonly report: OpenedPackage;
  readonly standard?: Standard;
  readonly playable: Playable[];
  readonly skipped: { title: string; why: string }[];
  /** The address the package is served under: origin + /play/<id>/. */
  readonly base: string;
  readonly log: LogEntry[] = [];
  /** Called whenever the log or the LMS's record changes. */
  onChange: () => void = () => {};
  mode: Mode = "normal";
  /** The launch now running, or the last one. */
  current?: Launch;
  /** The API objects the course looks for, set while a SCORM launch runs. */
  api?: Scorm12Lms;
  api2004?: Scorm2004Lms;
  private readonly archive: ZipArchive;
  private readonly entries = new Map<string, ZipEntry>();
  private readonly files: FileIndex;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly records = new Map<number, LearnerRecord>();
  private readonly launches: Launch[] = [];
  private lrs?: StandInLrs;
  private readonly cmi5 = new Map<number, Cmi5Lms>();
  private readonly registration = uuid4();
  private readonly actor = { objectType: "Agent", name: "Test Learner", mbox: "mailto:learner@packagedoctor.test" };
  /** What the course asked for that was not served as asked: path -> what happened. */
  private readonly misses = new Map<string, { kind: "missing" | "case" | "root"; path: string; actual?: string; launch: number }>();
  private readonly outside = new Map<string, number>();
  private readonly lrsRefusals: { request: LrsRequest; launch: number }[] = [];
  servedFiles = 0;
  /** Large files already unpacked, oldest first. */
  private readonly unpacked = new Map<string, Uint8Array>();

  constructor(report: OpenedPackage, archive: ZipArchive, origin: string, options: { id?: string; now?: () => number } = {}) {
    this.report = report;
    this.archive = archive;
    const found = playables(report);
    this.standard = found.standard;
    this.playable = found.playable;
    this.skipped = found.skipped;
    for (const e of archive.entries) if (!e.isDirectory && !this.entries.has(e.path)) this.entries.set(e.path, e);
    this.files = new FileIndex(this.entries.keys());
    this.base = `${origin.replace(/\/$/, "")}/play/${options.id ?? uuid4().slice(0, 8)}/`;
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  private time(): number {
    return this.now() - this.startedAt;
  }

  private add(entry: Omit<LogEntry, "at" | "launch">): void {
    this.log.push({ at: this.time(), launch: this.current?.number ?? 0, ...entry });
    this.onChange();
  }

  /** The record the LMS keeps for one part, over every launch of it. */
  recordOf(index: number): LearnerRecord {
    let r = this.records.get(index);
    if (!r) this.records.set(index, (r = newRecord()));
    return r;
  }

  /** Forgets everything the LMS and LRS hold about the learner, as if they had never opened the course. The log stays. */
  resetLearner(): void {
    this.records.clear();
    this.lrs = undefined;
    this.cmi5.clear();
    this.add({ kind: "lms", text: "The learner's record was emptied: the next launch is a first launch." });
  }

  /** Starts a launch of one part and returns the address to open in the frame. */
  launch(index: number): string {
    if (this.current && !this.current.ended) this.end();
    const playable = this.playable[index];
    if (!playable) throw new Error(`There is no part ${index} to launch.`);
    const launch: Launch = { number: this.launches.length + 1, playable, mode: this.mode, startedAt: this.time(), ended: false, statementsBefore: 0 };
    this.launches.push(launch);
    this.current = launch;
    this.api = undefined;
    this.api2004 = undefined;
    const fileUrl = this.base + "pkg/" + playable.file.split("/").map(encodeURIComponent).join("/");
    let query = "";
    const record = this.recordOf(index);
    const s = playable.start;
    if (this.standard === "scorm12" && playable.tracked) {
      const lms = new Scorm12Lms({ launchData: s.launchData, masteryScore: s.masteryScore, maxTimeAllowed: s.maxTimeAllowed, timeLimitAction: s.timeLimitAction }, record);
      lms.mode = this.mode;
      lms.onCall = (c) => this.call(c);
      this.api = lms;
      launch.scorm = lms;
    } else if (this.standard === "scorm2004" && playable.tracked) {
      const lms = new Scorm2004Lms({ launchData: s.launchData, scaledPassingScore: s.scaledPassingScore, completionThreshold: s.completionThreshold, maxTimeAllowed: s.maxTimeAllowed, timeLimitAction: s.timeLimitAction }, record);
      lms.mode = this.mode;
      const tracked = this.playable.filter((p) => p.tracked);
      const at = tracked.indexOf(playable);
      lms.navigation = { continue: at >= 0 && at < tracked.length - 1, previous: at > 0, targets: tracked.map((p) => p.start.id) };
      lms.onCall = (c) => this.call(c);
      this.api2004 = lms;
      launch.scorm = lms;
    } else if (this.standard === "xapi") {
      const lrs = this.xapiLrs();
      launch.statementsBefore = this.courseStatements(lrs).length;
      query = new URLSearchParams({ endpoint: lrs.endpoint, auth: lrs.auth, actor: JSON.stringify(this.actor), registration: this.registration, activity_id: s.id }).toString();
    } else if (this.standard === "cmi5") {
      let lms = this.cmi5.get(index);
      if (!lms) {
        lms = new Cmi5Lms(`${this.base}lms/${index}/`, { id: s.id, moveOn: s.moveOn, masteryScore: s.masteryScore, launchParameters: s.launchData, launchMethod: s.launchMethod });
        lms.lrs.onRequest = (r) => this.lrsRequest(r);
        this.cmi5.set(index, lms);
      }
      lms.mode = ({ normal: "Normal", browse: "Browse", review: "Review" } as Record<Mode, LaunchMode>)[this.mode];
      launch.statementsBefore = lms.lrs.statements.length;
      query = lms.launch(playable.file);
      launch.fetchCalls = lms.fetchCalls;
      launch.statementsBefore = lms.lrs.statements.length;
    }
    const [path, hash] = splitHash(playable.rest);
    const joined = [path.replace(/^\?/, ""), query].filter(Boolean).join("&");
    const url = fileUrl + (joined ? `?${joined}` : "") + hash;
    const how = this.standard ? `${STANDARD_WORDS[this.standard]}${playable.tracked ? "" : ", an asset the LMS does not track"}` : "";
    this.add({ kind: "launch", text: `Launch ${launch.number}: "${playable.title}" (${how}), ${this.mode} mode, opening ${playable.file}${playable.rest}` });
    return url;
  }

  /** The launch has ended: the frame was emptied, so the course has had its chance to say goodbye. */
  end(): void {
    const launch = this.current;
    if (!launch || launch.ended) return;
    launch.ended = true;
    const scorm = launch.scorm;
    let words = "The course was closed.";
    if (scorm && !scorm.started) words = "The course was closed. It never called Initialize, so the LMS recorded nothing.";
    else if (scorm && !scorm.finished) words = "The course was closed without calling " + (scorm instanceof Scorm12Lms ? "LMSFinish." : "Terminate.");
    this.add({ kind: "lms", text: words });
  }

  /** The navigation request a SCORM 2004 course left at Terminate, and the part it leads to, if the player can follow it. */
  next(): { request: string; index?: number } | null {
    const launch = this.current;
    if (!launch || !(launch.scorm instanceof Scorm2004Lms) || !launch.scorm.finished) return null;
    const request = launch.scorm.navRequest;
    if (request === "_none_") return null;
    const tracked = this.playable.filter((p) => p.tracked);
    const at = tracked.indexOf(launch.playable);
    if (request === "continue" && at >= 0 && at < tracked.length - 1) return { request, index: tracked[at + 1]!.index };
    if (request === "previous" && at > 0) return { request, index: tracked[at - 1]!.index };
    const target = /^\{target=([^}]+)\}(choice|jump)$/.exec(request);
    if (target) {
      const p = this.playable.find((x) => x.start.id === target[1]);
      return p ? { request, index: p.index } : { request };
    }
    return { request };
  }

  private call(c: ApiCall): void {
    const text = `${c.call}(${c.args.map((a) => JSON.stringify(short(a))).join(", ")})`;
    const entry: Omit<LogEntry, "at" | "launch"> = { kind: "call", text, answer: JSON.stringify(short(c.result, 60)) };
    if (c.error !== "0") entry.refused = `Error ${c.error}. ${c.reason ?? ""}`.trim();
    if (c.note) entry.note = c.note;
    this.add(entry);
  }

  private lrsRequest(r: LrsRequest): void {
    const verbs = (r.statements ?? []).map((s) => verbName(s)).join(", ");
    const what = r.resource === "statements" && r.statements?.length ? `${r.statements.length} statement${r.statements.length === 1 ? "" : "s"}: ${verbs}` : r.document ? `"${r.document}"` : "";
    const entry: Omit<LogEntry, "at" | "launch"> = { kind: "lrs", text: `${r.method} ${r.resource}${what ? ` (${what})` : ""}`, answer: String(r.status) };
    if (r.status >= 400 && !(r.status === 404 && r.method === "GET" && r.resource !== "statements")) {
      entry.refused = r.reason;
      this.lrsRefusals.push({ request: r, launch: this.current?.number ?? 0 });
    }
    this.add(entry);
  }

  private xapiLrs(): StandInLrs {
    if (!this.lrs) {
      this.lrs = new StandInLrs(`${this.base}lms/lrs/`, `Basic ${btoa("packagedoctor:test")}`);
      this.lrs.onRequest = (r) => this.lrsRequest(r);
    }
    return this.lrs;
  }

  private courseStatements(lrs: StandInLrs): Record<string, unknown>[] {
    return lrs.statements;
  }

  /** Something the course loaded from outside the package: another website, or the top of this one. */
  noteOutside(url: string): void {
    const u = new URL(url, this.base);
    if (u.href.startsWith(this.base)) return;
    if (u.origin === new URL(this.base).origin) {
      const path = decodeURIComponent(u.pathname);
      if (!this.misses.has(path)) {
        this.misses.set(path, { kind: "root", path, launch: this.current?.number ?? 0 });
        this.add({ kind: "file", text: `Asked for ${path}`, answer: "404", refused: "It starts with /, so it points at the top of the website, not the package." });
      }
      return;
    }
    const key = `${u.protocol}//${u.host}`;
    const first = !this.outside.has(key);
    this.outside.set(key, (this.outside.get(key) ?? 0) + 1);
    if (first) this.add({ kind: "file", text: `Loaded from another website: ${key}` });
  }

  /** Answers a request from the course's frame: one of its files, or the stand-in LRS or cmi5 fetch address. */
  handle(request: HttpRequest & { range?: string }): PlayResponse {
    const u = new URL(request.url);
    if (!u.href.startsWith(this.base)) return text(404, "Not part of this test.");
    const rest = u.pathname.slice(new URL(this.base).pathname.length);
    if (rest.startsWith("lms/")) {
      if (rest.startsWith("lms/lrs/") && this.lrs) return this.lrs.handle(request);
      const m = /^lms\/(\d+)\/(fetch|lrs\/.*)$/.exec(rest);
      const lms = m ? this.cmi5.get(Number(m[1])) : undefined;
      if (lms && m![2] === "fetch") {
        const answer = lms.fetch(request);
        this.add({ kind: "lrs", text: `${request.method} the cmi5 fetch address`, answer: String(answer.status), ...(answer.body.includes("error-code") ? { refused: "The token had already been handed out for this launch." } : {}) });
        return answer;
      }
      if (lms) return lms.lrs.handle(request);
      return text(404, "There is no LMS at this address.");
    }
    if (!rest.startsWith("pkg/")) return text(404, "Not part of this test.");
    const path = rest.slice(4).split("/").map((p) => safeDecode(p)).join("/");
    const look = this.files.lookup(path);
    let serve = look.found === "exact" ? look.path : undefined;
    if (look.found === "case") {
      serve = look.path;
      if (!this.misses.has(path)) {
        this.misses.set(path, { kind: "case", path, actual: look.path, launch: this.current?.number ?? 0 });
        this.add({ kind: "file", text: `Asked for ${path}`, answer: "200", refused: `The package has ${look.path}; an LMS server that tells capitals apart would answer 404.` });
      }
    }
    const entry = serve !== undefined ? this.entries.get(serve) : undefined;
    if (!entry) {
      if (!this.misses.has(path)) {
        this.misses.set(path, { kind: "missing", path, launch: this.current?.number ?? 0 });
        this.add({ kind: "file", text: `Asked for ${path}`, answer: "404", refused: "It is not in the package." });
      }
      return text(404, `${path} is not in the package.`);
    }
    let bytes: Uint8Array;
    try {
      bytes = this.read(entry);
    } catch {
      return text(500, `${entry.path} could not be unpacked.`);
    }
    this.servedFiles++;
    const headers: Record<string, string> = { "content-type": contentType(entry.path), "accept-ranges": "bytes", "cache-control": "no-store" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.range ?? request.headers["range"] ?? request.headers["Range"] ?? "");
    if (range && (range[1] || range[2])) {
      const size = bytes.length;
      let from = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let to = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (from >= size || from > to) return { status: 416, headers: { "content-range": `bytes */${size}` }, body: "" };
      from = Math.max(0, from);
      to = Math.max(from, to);
      return { status: 206, headers: { ...headers, "content-range": `bytes ${from}-${to}/${size}` }, body: bytes.subarray(from, to + 1) };
    }
    return { status: 200, headers, body: bytes };
  }

  /** A file unpacked. Large ones are kept for a while, because a video is asked for a piece at a time as it plays. */
  private read(entry: ZipEntry): Uint8Array {
    const kept = this.unpacked.get(entry.path);
    if (kept) {
      this.unpacked.delete(entry.path);
      this.unpacked.set(entry.path, kept);
      return kept;
    }
    const bytes = this.archive.read(entry);
    if (bytes.length >= 1024 * 1024) {
      this.unpacked.set(entry.path, bytes);
      let total = 0;
      for (const b of this.unpacked.values()) total += b.length;
      for (const [path, b] of this.unpacked) {
        if (total <= KEEP_UNPACKED || this.unpacked.size === 1) break;
        this.unpacked.delete(path);
        total -= b.length;
      }
    }
    return bytes;
  }

  /** What the LMS or LRS holds for the part now launched, as label and value, in words. */
  holds(): { label: string; value: string }[] {
    const launch = this.current;
    if (!launch) return [];
    const out: { label: string; value: string }[] = [];
    const row = (label: string, value: string | undefined) => out.push({ label, value: value === undefined || value === "" ? "(none)" : value });
    const record = this.records.get(launch.playable.index);
    if (launch.scorm instanceof Scorm12Lms) {
      const d = launch.scorm.data;
      row("Status", d["cmi.core.lesson_status"]);
      row("Score", scoreWords(d["cmi.core.score.raw"], d["cmi.core.score.min"], d["cmi.core.score.max"]));
      if (launch.playable.start.masteryScore !== undefined) row("Passing score", String(launch.playable.start.masteryScore));
      const session = parseTimespan12(d["cmi.core.session_time"] ?? "");
      row("Time this session", session === null ? undefined : timespan12(session));
      row("Total time", timespan12(record?.totalTime ?? 0));
      row("Bookmark", d["cmi.core.lesson_location"]);
      row("Saved data", d["cmi.suspend_data"] ? `${d["cmi.suspend_data"].length} of 4096 characters` : undefined);
      row("Exit", d["cmi.core.exit"]);
      row("Interactions", count(d, "cmi.interactions"));
      row("Objectives", count(d, "cmi.objectives"));
    } else if (launch.scorm instanceof Scorm2004Lms) {
      const d = launch.scorm.data;
      row("Completion", d["cmi.completion_status"]);
      row("Pass or fail", d["cmi.success_status"]);
      row("Score", d["cmi.score.scaled"] !== undefined ? `${Math.round(Number(d["cmi.score.scaled"]) * 100)} percent (scaled ${d["cmi.score.scaled"]})` : scoreWords(d["cmi.score.raw"], d["cmi.score.min"], d["cmi.score.max"]));
      if (launch.playable.start.scaledPassingScore !== undefined) row("Passing score", `${launch.playable.start.scaledPassingScore}`);
      row("Progress", d["cmi.progress_measure"]);
      if (launch.playable.start.completionThreshold !== undefined) row("Completion threshold", String(launch.playable.start.completionThreshold));
      const session = parseDuration(d["cmi.session_time"] ?? "");
      row("Time this session", session === null ? undefined : duration2004(session));
      row("Total time", duration2004(record?.totalTime ?? 0));
      row("Location", d["cmi.location"]);
      row("Saved data", d["cmi.suspend_data"] ? `${d["cmi.suspend_data"].length} of 64000 characters` : undefined);
      row("Exit", d["cmi.exit"]);
      row("Interactions", count(d, "cmi.interactions"));
      row("Objectives", count(d, "cmi.objectives"));
      row("Navigation request", d["adl.nav.request"]);
    } else if (this.standard === "xapi" || this.standard === "cmi5") {
      const lms = this.cmi5.get(launch.playable.index);
      const lrs = lms ? lms.lrs : this.lrs;
      const statements = (lrs?.statements ?? []).filter((s) => !(lms && verbName(s) === "launched"));
      row("Statements kept", String(statements.length));
      const refused = this.lrsRefusals.filter((r) => r.request.resource === "statements").length;
      row("Requests refused", String(this.lrsRefusals.length) + (refused ? ` (${refused} with statements)` : ""));
      const verbs = new Map<string, number>();
      for (const s of statements) verbs.set(verbName(s), (verbs.get(verbName(s)) ?? 0) + 1);
      row("Verbs", [...verbs].map(([v, n]) => (n > 1 ? `${v} (${n})` : v)).join(", "));
      const last = [...statements].reverse().find((s) => typeof s["result"] === "object" && s["result"] !== null && ["completion", "success", "score"].some((k) => k in (s["result"] as object)));
      if (last) {
        const r = last["result"] as Record<string, unknown>;
        const sc = r["score"] as Record<string, number> | undefined;
        row("Last result", [r["completion"] !== undefined ? `completion ${r["completion"]}` : "", r["success"] !== undefined ? `success ${r["success"]}` : "", sc ? `score ${sc["scaled"] !== undefined ? `${Math.round(sc["scaled"] * 100)} percent` : scoreWords(sc["raw"]?.toString(), sc["min"]?.toString(), sc["max"]?.toString())}` : ""].filter(Boolean).join(", "));
      }
      if (lms) {
        const met = lms.satisfied();
        row("To move on", `${met.needed}: ${met.met ? "met" : "not met yet"}`);
      }
      const documents = [...(lrs?.documents.keys() ?? [])].filter((k) => !k.endsWith("|LMS.LaunchData")).length;
      row("Saved documents", String(documents));
    } else {
      row("Tracking", "None. This part is an asset, which the LMS opens but does not track.");
    }
    return out;
  }

  /** The statements the LRS kept, newest last, for the window to list. */
  statements(): Record<string, unknown>[] {
    const launch = this.current;
    if (!launch) return [];
    const lms = this.cmi5.get(launch.playable.index);
    return (lms ? lms.lrs : this.lrs)?.statements ?? [];
  }

  /** Everything the test player found so far. `now` lets a launch that has run a while without starting count. */
  findings(): Finding[] {
    const out: Finding[] = [];
    // Values the LMS refused, one finding per field and reason.
    const refusals = new Map<string, { entry: LogEntry; times: number }>();
    for (const e of this.log) {
      if (e.kind !== "call" || !e.refused) continue;
      const key = `${e.text.replace(/,.*$/, "").replace(/\)$/, "")}|${e.refused}`;
      const r = refusals.get(key);
      if (r) r.times++;
      else refusals.set(key, { entry: e, times: 1 });
    }
    for (const { entry, times } of refusals.values()) {
      const element = /"(cmi\.[^"]+|adl\.[^"]+)"/.exec(entry.text)?.[1] ?? "";
      const severity: Severity = /SetValue/.test(entry.text) && STATUS_ELEMENTS.test(element) ? "problem" : "warning";
      out.push(finding("play-refused", `${entry.text} was refused${times > 1 ? ` (${times} times)` : ""}. ${entry.refused}`, {}, severity));
    }
    for (const launch of this.launches) {
      const label = this.launches.length > 1 ? `Launch ${launch.number} ("${launch.playable.title}"): ` : "";
      const scorm = launch.scorm;
      const running = this.time() - launch.startedAt;
      if (scorm && !scorm.started && (launch.ended || running > 15000)) out.push(finding("play-no-api", `${label}the course ${launch.ended ? "was open" : "has been open"} ${Math.round(running / 1000)} seconds without calling ${scorm instanceof Scorm12Lms ? "LMSInitialize" : "Initialize"}.`));
      if (scorm && scorm.started && !scorm.finished && launch.ended) out.push(finding("play-no-finish", `${label}it called ${scorm instanceof Scorm12Lms ? "LMSInitialize but not LMSFinish" : "Initialize but not Terminate"}.`));
      if (scorm && scorm.finished && launch.mode === "normal") {
        const d = scorm.data;
        const status = scorm instanceof Scorm12Lms ? d["cmi.core.lesson_status"] : d["cmi.completion_status"];
        const set = this.log.some((e) => e.launch === launch.number && e.kind === "call" && !e.refused && /SetValue\("cmi\.(core\.lesson_status|completion_status|progress_measure)"/.test(e.text));
        if (!set) out.push(finding("play-no-status", `${label}the LMS shows "${status}".`));
      }
      if ((this.standard === "xapi" || this.standard === "cmi5") && launch.ended) {
        const lms = this.cmi5.get(launch.playable.index);
        const sent = this.log.some((e) => e.launch === launch.number && e.kind === "lrs" && /^(POST|PUT) statements/.test(e.text));
        if (lms && launch.fetchCalls !== undefined && !this.log.some((e) => e.launch === launch.number && e.text.includes("cmi5 fetch address"))) out.push(finding("play-cmi5-fetch", `${label}the course did not POST to the fetch address.`));
        if (!sent) out.push(finding("play-no-statement", `${label}the course sent no statements while it was open.`));
      }
    }
    for (const lms of this.cmi5.values()) {
      const problems = lms.problems();
      for (const p of problems.slice(0, 20)) out.push(finding("play-cmi5-rule", p));
      if (problems.length > 20) out.push(finding("play-cmi5-rule", `And ${problems.length - 20} more breaks of cmi5's rules; Copy log lists the statements.`));
    }
    const refusedStatements = new Map<string, number>();
    const otherRefusals = new Map<string, number>();
    for (const { request } of this.lrsRefusals) {
      const map = request.resource === "statements" && request.method !== "GET" ? refusedStatements : otherRefusals;
      const key = `${request.method} ${request.resource}${request.document ? ` "${request.document}"` : ""}: ${request.reason ?? request.status}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    for (const [key, n] of refusedStatements) out.push(finding("play-statement-refused", `${key}${n > 1 ? ` (${n} times)` : ""}`));
    for (const [key, n] of otherRefusals) out.push(finding("play-lrs-refused", `${key}${n > 1 ? ` (${n} times)` : ""}`));
    for (const m of this.misses.values()) {
      const severity: Severity = NEEDED_TO_RUN.test(m.path) ? "problem" : "warning";
      if (m.kind === "missing") out.push(finding("play-missing-file", `${m.path}.`, { file: m.path }, severity));
      else if (m.kind === "case") out.push(finding("play-file-case", `The course asked for ${m.path}; the package has ${m.actual}.`, { file: m.actual }, severity));
      else out.push(finding("play-root-request", `The course asked for ${m.path}.`, {}, severity));
    }
    if (this.outside.size) {
      const hosts = [...this.outside.keys()];
      const insecure = hosts.filter((h) => h.startsWith("http:"));
      out.push(finding("play-external", `${hosts.join(", ")}.`, {}, insecure.length ? "warning" : "note"));
    }
    return out;
  }

  /** The whole log as text, for Copy log. */
  logText(): string {
    const lines = [
      "Package Doctor test player log",
      `Package: ${this.report.fileName} (${this.report.kindLabel})`,
      `Learner: Learner, Test (made up by the test player)`,
      "",
    ];
    for (const e of this.log) {
      const t = `${(e.at / 1000).toFixed(3).padStart(8)}s`;
      lines.push(`${t}  ${e.text}${e.answer !== undefined ? ` -> ${e.answer}` : ""}`);
      if (e.refused) lines.push(`${" ".repeat(11)}Refused: ${e.refused}`);
      if (e.note) lines.push(`${" ".repeat(11)}LMS: ${e.note}`);
    }
    const holds = this.holds();
    if (holds.length) lines.push("", "What the LMS holds now:", ...holds.map((h) => `  ${h.label}: ${h.value}`));
    const found = this.findings();
    lines.push("", found.length ? "What the test player found:" : "The test player found nothing to report.");
    for (const f of found) lines.push(`  ${f.severity.toUpperCase()}: ${f.title}. ${f.detail}`);
    lines.push("", "This is one run on one computer with a stand-in LMS. Try the course in the LMS it is for as well.");
    return lines.join("\n") + "\n";
  }
}

function verbName(s: Record<string, unknown>): string {
  const verb = s["verb"] as { id?: string; display?: Record<string, string> } | undefined;
  const id = String(verb?.id ?? "");
  return id.split(/[/#]/).filter(Boolean).pop() ?? id;
}

function scoreWords(raw?: string, min?: string, max?: string): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  return max !== undefined && max !== "" ? `${raw} out of ${max}${min !== undefined && min !== "" && min !== "0" ? ` (lowest ${min})` : ""}` : raw;
}

function count(d: Record<string, string>, base: string): string {
  const ids = Object.keys(d).filter((k) => new RegExp(`^${base.replace(/\./g, "\\.")}\\.\\d+\\.id$`).test(k)).length;
  return String(ids);
}

function splitHash(rest: string): [string, string] {
  const at = rest.indexOf("#");
  return at < 0 ? [rest, ""] : [rest.slice(0, at), rest.slice(at)];
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function text(status: number, body: string): PlayResponse {
  return { status, headers: { "content-type": "text/plain; charset=utf-8" }, body };
}
