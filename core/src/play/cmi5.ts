// The stand-in cmi5 LMS: the part of an LMS that launches an AU and checks what it sends back. It launches the AU the cmi5
// way (an address with the endpoint, a fetch address for the token, the actor, the registration and the activity id),
// writes the LMS.LaunchData document and the launched statement as an LMS must, and checks every statement against the
// rules cmi5 adds to xAPI. The statements are first checked as xAPI by the stand-in LRS (lrs.ts). The rules are those of
// cmi5 (Quartz), sections 9 and 10. Started from OpenStage Author's player/src/fake-cmi5.ts, with Author's own rules taken out.

import { StandInLrs, uuid4, type HttpRequest, type HttpResponse } from "./lrs.ts";

const ADL = "http://adlnet.gov/expapi/verbs/";
export const CMI5 = {
  category: "https://w3id.org/xapi/cmi5/context/categories/cmi5",
  moveOn: "https://w3id.org/xapi/cmi5/context/categories/moveon",
  sessionId: "https://w3id.org/xapi/cmi5/context/extensions/sessionid",
  masteryScore: "https://w3id.org/xapi/cmi5/context/extensions/masteryscore",
  launchMode: "https://w3id.org/xapi/cmi5/context/extensions/launchmode",
  launchUrl: "https://w3id.org/xapi/cmi5/context/extensions/launchurl",
  launchParameters: "https://w3id.org/xapi/cmi5/context/extensions/launchparameters",
  moveOnExt: "https://w3id.org/xapi/cmi5/context/extensions/moveon",
};
/** The verbs cmi5 defines for an AU to send. */
const DEFINED = ["initialized", "completed", "passed", "failed", "terminated"];
/** Verbs only the LMS may send. */
const LMS_ONLY: Record<string, string> = {
  [`${ADL}launched`]: "launched",
  [`${ADL}satisfied`]: "satisfied",
  "https://w3id.org/xapi/adl/verbs/satisfied": "satisfied",
  "https://w3id.org/xapi/adl/verbs/waived": "waived",
  "https://w3id.org/xapi/adl/verbs/abandoned": "abandoned",
};

export interface Cmi5Au {
  /** The AU's id in cmi5.xml: the publisher's id, which goes in the context's grouping. */
  id: string;
  moveOn?: string;
  masteryScore?: number;
  launchParameters?: string;
  launchMethod?: string;
}

export type LaunchMode = "Normal" | "Browse" | "Review";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : v === undefined ? [] : [obj(v)]);
const verbWord = (s: Obj): string => {
  const id = String(obj(s["verb"])["id"] ?? "");
  return id.startsWith(ADL) ? id.slice(ADL.length) : id;
};

export class Cmi5Lms {
  readonly lrs: StandInLrs;
  readonly au: Cmi5Au;
  readonly registration = uuid4();
  readonly actor = { objectType: "Agent", name: "Test Learner", account: { homePage: "https://packagedoctor.test", name: "learner-1" } };
  /** The activity id the LMS launches the AU with. An LMS makes its own; it need not be the AU's id in cmi5.xml. */
  readonly activityId: string;
  readonly fetchUrl: string;
  mode: LaunchMode = "Normal";
  sessionId = uuid4();
  /** Whether the token for this launch has been handed out. It can be had once. */
  tokenGiven = false;
  /** How often the course asked for a token in this launch, by method. */
  readonly fetchCalls: string[] = [];
  /** The sessions so far, each with the id of the first statement the course sent in it. */
  private readonly sessions: { id: string; mode: LaunchMode; from: number }[] = [];
  private token = "";
  /** The ids of the statements the LMS wrote itself, which are not the course's to answer for. */
  private readonly own = new Set<string>();

  /** base: where the LMS's addresses start, ending in a slash. */
  constructor(base: string, au: Cmi5Au) {
    this.au = au;
    this.activityId = `${base}activity/${encodeURIComponent(au.id)}`;
    this.fetchUrl = `${base}fetch`;
    this.lrs = new StandInLrs(`${base}lrs/`, "");
  }

  /** Starts a launch: a new session and token, the launch data, and the launched statement. Returns the query to open the AU with. */
  launch(href: string): string {
    if (this.token) this.lrs.earlierAuth.add(`Basic ${this.token}`);
    this.sessionId = uuid4();
    this.token = btoa(`cmi5-${this.sessionId}`);
    this.lrs.auth = `Basic ${this.token}`;
    this.tokenGiven = false;
    this.fetchCalls.length = 0;
    this.sessions.push({ id: this.sessionId, mode: this.mode, from: this.lrs.statements.length });
    const context = { contextActivities: { grouping: [{ objectType: "Activity", id: this.au.id }] }, extensions: { [CMI5.sessionId]: this.sessionId } };
    const data: Obj = { contextTemplate: context, launchMode: this.mode, moveOn: this.au.moveOn ?? "NotApplicable" };
    if (this.au.launchParameters !== undefined) data["launchParameters"] = this.au.launchParameters;
    if (this.au.masteryScore !== undefined) data["masteryScore"] = this.au.masteryScore;
    const key = ["activities/state", this.activityId, JSON.stringify(this.actor), this.registration, "LMS.LaunchData"].join("|");
    this.lrs.documents.set(key, { contentType: "application/json", body: JSON.stringify(data), updated: new Date().toISOString() });
    const query = new URLSearchParams({ endpoint: this.lrs.endpoint, fetch: this.fetchUrl, actor: JSON.stringify(this.actor), registration: this.registration, activityId: this.activityId });
    const extensions: Obj = { [CMI5.sessionId]: this.sessionId, [CMI5.launchMode]: this.mode, [CMI5.launchUrl]: href, [CMI5.moveOnExt]: this.au.moveOn ?? "NotApplicable" };
    if (this.au.launchParameters !== undefined) extensions[CMI5.launchParameters] = this.au.launchParameters;
    const launched = uuid4();
    this.own.add(launched);
    this.lrs.store({
      id: launched,
      actor: this.actor,
      verb: { id: `${ADL}launched`, display: { "en-US": "Launched" } },
      object: { objectType: "Activity", id: this.activityId },
      context: { registration: this.registration, contextActivities: { grouping: [{ objectType: "Activity", id: this.au.id }], category: [{ id: CMI5.category }] }, extensions },
      timestamp: new Date().toISOString(),
    });
    // The launched statement is the LMS's own; the course's statements start after it.
    this.sessions[this.sessions.length - 1]!.from = this.lrs.statements.length;
    return query.toString();
  }

  /** The fetch address: the course asks it once, with POST, for the token it signs its requests with. */
  fetch(request: HttpRequest): HttpResponse {
    this.fetchCalls.push(request.method);
    const answer = (value: unknown): HttpResponse => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    if (request.method !== "POST") return { status: 405, headers: { "content-type": "text/plain; charset=utf-8" }, body: "The fetch address only answers POST." };
    if (this.tokenGiven) return answer({ "error-code": "1", "error-text": "The token has already been handed out; cmi5 allows it once a launch." });
    this.tokenGiven = true;
    return answer({ "auth-token": this.token });
  }

  /** Every way the course's statements break cmi5's rules, session by session. Empty when they keep them all. */
  problems(): string[] {
    // A statement belongs to the session its session id names. One without a known session id is put with the launch
    // that was running when it arrived.
    const bySession = this.sessions.map(() => [] as Obj[]);
    this.lrs.statements.forEach((s, at) => {
      if (this.own.has(String(s["id"]))) return;
      const sid = obj(obj(s["context"])["extensions"])[CMI5.sessionId];
      let i = this.sessions.findIndex((x) => x.id === sid);
      if (i < 0) i = this.sessions.reduce((last, x, k) => (x.from <= at ? k : last), 0);
      bySession[i]?.push(s);
    });
    const out: string[] = [];
    this.sessions.forEach((session, i) => {
      const label = this.sessions.length > 1 ? `Launch ${i + 1}: ` : "";
      for (const p of this.sessionProblems(bySession[i]!, session)) out.push(label + p);
    });
    return out;
  }

  private sessionProblems(statements: Obj[], session: { id: string; mode: LaunchMode }): string[] {
    const out: string[] = [];
    const ours = statements;
    if (ours.length === 0) return out;
    const verbs = ours.map(verbWord);
    if (verbs[0] !== "initialized") out.push(`The first statement is ${verbs[0]}; an AU's first statement must be initialized.`);
    const end = verbs.indexOf("terminated");
    if (end >= 0 && end < verbs.length - 1) out.push(`${verbs.length - 1 - end} statement(s) came after terminated; nothing may be sent after it.`);
    for (const v of ["initialized", "terminated", "completed", "passed", "failed"]) if (verbs.filter((x) => x === v).length > 1) out.push(`${v} was sent ${verbs.filter((x) => x === v).length} times; cmi5 allows it once.`);
    if (verbs.includes("passed") && verbs.includes("failed")) out.push("Both passed and failed were sent in one session.");
    if (session.mode !== "Normal") {
      const settling = verbs.filter((v) => ["completed", "passed", "failed"].includes(v));
      if (settling.length) out.push(`In a ${session.mode} launch the AU must not send ${[...new Set(settling)].join(", ")}.`);
    }
    ours.forEach((s, n) => {
      const verb = verbWord(s);
      const at = `Statement ${n + 1} (${verb})`;
      const context = obj(s["context"]);
      const activities = obj(context["contextActivities"]);
      const ids = (kind: string) => list(activities[kind]).map((a) => String(a["id"]));
      const result = obj(s["result"]);
      const ext = obj(context["extensions"]);
      const lmsOnly = LMS_ONLY[String(obj(s["verb"])["id"])];
      if (lmsOnly) out.push(`${at}: only the LMS may send ${lmsOnly}.`);
      if (JSON.stringify(s["actor"]) !== JSON.stringify(this.actor)) out.push(`${at}: the actor is not the one the LMS gave at launch.`);
      if (context["registration"] !== this.registration) out.push(`${at}: context.registration is not the launch's registration.`);
      if (ext[CMI5.sessionId] !== session.id) out.push(`${at}: the session id from LMS.LaunchData is missing from context.extensions.`);
      if (!ids("grouping").includes(this.au.id)) out.push(`${at}: the AU's id (${this.au.id}) is not in context.contextActivities.grouping; copy the contextTemplate from LMS.LaunchData.`);
      if (!DEFINED.includes(verb)) {
        if (ids("category").includes(CMI5.category)) out.push(`${at}: a statement cmi5 does not define must not carry the cmi5 category.`);
        return;
      }
      if (obj(s["object"])["id"] !== this.activityId) out.push(`${at}: the object must be the activity id the LMS launched the AU with.`);
      if (!ids("category").includes(CMI5.category)) out.push(`${at}: the cmi5 category is missing from context.contextActivities.category.`);
      const settles = ["completed", "passed", "failed"].includes(verb);
      if (settles !== ids("category").includes(CMI5.moveOn)) out.push(`${at}: the moveOn category ${settles ? "is missing" : "belongs only on completed, passed and failed"}.`);
      if (["completed", "passed", "failed", "terminated"].includes(verb) && typeof result["duration"] !== "string") out.push(`${at}: it needs result.duration.`);
      if (result["score"] !== undefined && !["passed", "failed"].includes(verb)) out.push(`${at}: a score belongs only on passed and failed.`);
      if (verb === "completed" && result["completion"] !== true) out.push(`${at}: completed needs result.completion true.`);
      if (verb === "passed" && result["success"] !== true) out.push(`${at}: passed needs result.success true.`);
      if (verb === "failed" && result["success"] !== false) out.push(`${at}: failed needs result.success false.`);
      if (!["passed", "failed"].includes(verb) && result["success"] !== undefined) out.push(`${at}: result.success belongs only on passed and failed.`);
      if (verb !== "completed" && result["completion"] !== undefined) out.push(`${at}: result.completion belongs only on completed.`);
      const mastery = this.au.masteryScore;
      if ((verb === "passed" || verb === "failed") && mastery !== undefined) {
        if (ext[CMI5.masteryScore] !== mastery) out.push(`${at}: the masteryScore (${mastery}) must be in context.extensions.`);
        const scaled = obj(result["score"])["scaled"];
        if (typeof scaled === "number" && verb === "passed" && scaled < mastery) out.push(`${at}: the scaled score ${scaled} is below the masteryScore ${mastery}, so it cannot pass.`);
        if (typeof scaled === "number" && verb === "failed" && scaled >= mastery) out.push(`${at}: the scaled score ${scaled} reaches the masteryScore ${mastery}, so it cannot fail.`);
      }
    });
    return out;
  }

  /** What cmi5 says this AU needs for the course to count it, against what the course sent. */
  satisfied(): { needed: string; met: boolean } {
    const verbs = new Set(this.lrs.statements.filter((s) => obj(s["object"])["id"] === this.activityId).map(verbWord));
    const moveOn = this.au.moveOn ?? "NotApplicable";
    const met: Record<string, boolean> = {
      Passed: verbs.has("passed"),
      Completed: verbs.has("completed"),
      CompletedAndPassed: verbs.has("completed") && verbs.has("passed"),
      CompletedOrPassed: verbs.has("completed") || verbs.has("passed"),
      NotApplicable: true,
    };
    return { needed: moveOn, met: met[moveOn] ?? false };
  }
}
