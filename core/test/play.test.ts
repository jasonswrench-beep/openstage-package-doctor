import { test } from "node:test";
import assert from "node:assert/strict";
import { cmi5, makeZip, PAGE, scorm12, scorm2004, tincan } from "./helpers.ts";
import { openPackageSession } from "../src/open.ts";
import { Scorm12Lms } from "../src/play/scorm12.ts";
import { Scorm2004Lms } from "../src/play/scorm2004.ts";
import { StandInLrs, statementProblem, uuid4 } from "../src/play/lrs.ts";
import { CMI5, Cmi5Lms } from "../src/play/cmi5.ts";
import { PlaySession } from "../src/play/session.ts";
import type { ApiCall } from "../src/play/scorm-common.ts";

const ORIGIN = "http://tauri.localhost";

function session(files: Record<string, string>): PlaySession {
  const { report, archive } = openPackageSession(makeZip(Object.entries(files).map(([name, data]) => ({ name, data }))), "test.zip");
  return new PlaySession(report, archive!, ORIGIN, { id: "t1" });
}

const ids = (s: PlaySession) => s.findings().map((f) => f.id);

// ---- SCORM 1.2

test("SCORM 1.2: a course's ordinary conversation, and the passing score deciding passed or failed", () => {
  const calls: ApiCall[] = [];
  const lms = new Scorm12Lms({ masteryScore: 80, launchData: "chapter=2" });
  lms.onCall = (c) => calls.push(c);
  assert.equal(lms.LMSInitialize(""), "true");
  assert.equal(lms.LMSGetValue("cmi.core.entry"), "ab-initio");
  assert.equal(lms.LMSGetValue("cmi.launch_data"), "chapter=2");
  assert.equal(lms.LMSGetValue("cmi.student_data.mastery_score"), "80");
  assert.equal(lms.LMSGetValue("cmi.core._children").includes("lesson_status"), true);
  assert.equal(lms.LMSSetValue("cmi.core.lesson_status", "completed"), "true");
  assert.equal(lms.LMSSetValue("cmi.core.score.raw", "72"), "true");
  assert.equal(lms.LMSSetValue("cmi.core.session_time", "0000:05:30.00"), "true");
  assert.equal(lms.LMSSetValue("cmi.core.exit", "suspend"), "true");
  assert.equal(lms.LMSFinish(""), "true");
  assert.equal(lms.data["cmi.core.lesson_status"], "failed");
  assert.match(calls.at(-1)!.note ?? "", /failed: the score 72 is below the passing score 80/);
  assert.equal(lms.record.totalTime, 33000);

  // The next launch resumes, and total time carries over.
  const again = new Scorm12Lms({ masteryScore: 80 }, lms.record);
  again.LMSInitialize("");
  assert.equal(again.LMSGetValue("cmi.core.entry"), "resume");
  assert.equal(again.LMSGetValue("cmi.core.total_time"), "0000:05:30.00");
});

test("SCORM 1.2: refusals carry the standard's code and the reason in words", () => {
  const calls: ApiCall[] = [];
  const lms = new Scorm12Lms();
  lms.onCall = (c) => calls.push(c);
  assert.equal(lms.LMSSetValue("cmi.core.lesson_status", "completed"), "false");
  assert.equal(lms.LMSGetLastError(), "301");
  lms.LMSInitialize("");
  assert.equal(lms.LMSSetValue("cmi.core.lesson_status", "done"), "false");
  assert.equal(lms.LMSGetLastError(), "405");
  assert.match(calls.at(-1)!.reason!, /must be one of "passed", "completed"/);
  assert.equal(lms.LMSSetValue("cmi.core.score.raw", "150"), "false");
  assert.match(calls.at(-1)!.reason!, /0 to 100/);
  assert.equal(lms.LMSSetValue("cmi.core.student_name", "X"), "false");
  assert.equal(lms.LMSGetLastError(), "403");
  assert.equal(lms.LMSGetValue("cmi.core.exit"), "");
  assert.equal(lms.LMSGetLastError(), "404");
  assert.equal(lms.LMSSetValue("cmi.completion_status", "completed"), "false");
  assert.match(calls.at(-1)!.reason!, /SCORM 2004 name/);
  assert.equal(lms.LMSSetValue("cmi.suspend_data", "x".repeat(4097)), "false");
  assert.equal(lms.LMSSetValue("cmi.interactions.1.id", "q1"), "false");
  assert.match(calls.at(-1)!.reason!, /next one must be number 0/);
  assert.equal(lms.LMSSetValue("cmi.interactions.0.id", "q1"), "true");
  assert.equal(lms.LMSSetValue("cmi.interactions.0.type", "choice"), "true");
  assert.equal(lms.LMSGetValue("cmi.interactions._count"), "1");
  assert.equal(lms.LMSGetValue("cmi.interactions.0.id"), "");
  assert.equal(lms.LMSGetLastError(), "404");
  assert.equal(lms.LMSGetErrorString("405"), "Incorrect data type");
});

// ---- SCORM 2004

test("SCORM 2004: the manifest's threshold and passing score decide completion and success", () => {
  const lms = new Scorm2004Lms({ completionThreshold: 0.8, scaledPassingScore: 0.7 });
  lms.Initialize("");
  assert.equal(lms.GetValue("cmi.completion_threshold"), "0.8");
  assert.equal(lms.GetValue("cmi.completion_status"), "unknown");
  lms.SetValue("cmi.progress_measure", "0.5");
  lms.SetValue("cmi.completion_status", "completed");
  assert.equal(lms.GetValue("cmi.completion_status"), "incomplete");
  lms.SetValue("cmi.score.scaled", "0.75");
  lms.SetValue("cmi.success_status", "failed");
  assert.equal(lms.GetValue("cmi.success_status"), "passed");
  lms.Terminate("");
  assert.equal(lms.data["cmi.completion_status"], "incomplete");
  assert.equal(lms.data["cmi.success_status"], "passed");
});

test("SCORM 2004: interactions keep the standard's order and words", () => {
  const calls: ApiCall[] = [];
  const lms = new Scorm2004Lms();
  lms.onCall = (c) => calls.push(c);
  lms.Initialize("");
  assert.equal(lms.SetValue("cmi.interactions.0.type", "choice"), "false");
  assert.equal(lms.GetLastError(), "408");
  assert.equal(lms.SetValue("cmi.interactions.0.id", "q1"), "true");
  assert.equal(lms.SetValue("cmi.interactions.0.learner_response", "a"), "false");
  assert.equal(lms.GetLastError(), "408");
  assert.equal(lms.SetValue("cmi.interactions.0.type", "true_false"), "false");
  assert.equal(lms.GetLastError(), "406");
  assert.equal(lms.SetValue("cmi.interactions.0.type", "true-false"), "true");
  assert.equal(lms.SetValue("cmi.interactions.0.learner_response", "yes"), "false");
  assert.match(calls.at(-1)!.reason!, /"true" or "false"/);
  assert.equal(lms.SetValue("cmi.interactions.0.learner_response", "true"), "true");
  assert.equal(lms.SetValue("cmi.interactions.0.objectives.0.id", "obj-1"), "true");
  assert.equal(lms.GetValue("cmi.interactions.0.objectives._count"), "1");
  assert.equal(lms.SetValue("cmi.score.max", "10"), "true");
  assert.equal(lms.SetValue("cmi.score.raw", "12"), "false");
  assert.equal(lms.GetLastError(), "407");
  assert.equal(lms.SetValue("cmi.objectives.0.success_status", "passed"), "false");
  assert.equal(lms.GetLastError(), "408");
  assert.equal(lms.GetValue("cmi.location"), "");
  assert.equal(lms.GetLastError(), "403");
  assert.equal(lms.SetValue("cmi.core.lesson_status", "passed"), "false");
  assert.match(calls.at(-1)!.reason!, /SCORM 1\.2 name/);
});

test("SCORM 2004: suspending resumes; leaving normally starts a new attempt", () => {
  const first = new Scorm2004Lms();
  first.Initialize("");
  first.SetValue("cmi.location", "page-4");
  first.SetValue("cmi.exit", "suspend");
  first.SetValue("cmi.session_time", "PT2M");
  first.Terminate("");
  const second = new Scorm2004Lms({}, first.record);
  second.Initialize("");
  assert.equal(second.GetValue("cmi.entry"), "resume");
  assert.equal(second.GetValue("cmi.location"), "page-4");
  assert.equal(second.GetValue("cmi.total_time"), "PT2M0S");
  second.SetValue("cmi.exit", "normal");
  second.Terminate("");
  const third = new Scorm2004Lms({}, second.record);
  third.Initialize("");
  assert.equal(third.GetValue("cmi.entry"), "ab-initio");
  assert.equal(third.GetValue("cmi.location"), "");
  assert.equal(third.Terminate("x"), "false");
  assert.equal(third.GetLastError(), "201");
  third.Terminate("");
  assert.equal(third.Terminate(""), "false");
  assert.equal(third.GetLastError(), "113");
});

// ---- xAPI

const AUTH = "Basic dGVzdDp0ZXN0";
const statement = (extra: Record<string, unknown> = {}) => ({
  actor: { objectType: "Agent", name: "L", mbox: "mailto:l@example.test" },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
  object: { id: "https://example.org/course/1" },
  ...extra,
});
const post = (lrs: StandInLrs, body: unknown, headers: Record<string, string> = {}) =>
  lrs.handle({ method: "POST", url: lrs.endpoint + "statements", headers: { "X-Experience-API-Version": "1.0.3", Authorization: AUTH, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("the LRS keeps sound statements and refuses what xAPI forbids, saying why", () => {
  const lrs = new StandInLrs("http://x.test/lrs/", AUTH);
  assert.equal(post(lrs, statement()).status, 200);
  assert.equal(lrs.statements.length, 1);
  assert.equal(post(lrs, statement(), { "X-Experience-API-Version": "" }).status, 400);
  assert.equal(post(lrs, statement(), { Authorization: "Basic bm9wZQ==" }).status, 401);
  const bad = post(lrs, statement({ result: { score: { scaled: 85 } } }));
  assert.equal(bad.status, 400);
  assert.match(bad.body, /scaled is 85; it must be from -1 to 1/);
  assert.match(statementProblem(statement({ actor: { name: "No id" } }))!, /exactly one way of being identified/);
  assert.match(statementProblem(statement({ score: 1 }))!, /property xAPI does not have: "score"/);
  assert.match(statementProblem(statement({ result: { duration: "5 minutes" } }))!, /ISO 8601 duration/);
  assert.equal(statementProblem(statement({ object: { id: "https://e.org/q1", definition: { type: "http://adlnet.gov/expapi/activities/cmi.interaction", interactionType: "choice", correctResponsesPattern: ["a"] } }, result: { response: "a", success: true } })), null);
  const id = uuid4();
  assert.equal(post(lrs, statement({ id })).status, 200);
  assert.equal(post(lrs, statement({ id, result: { completion: true } })).status, 409);
});

test("the LRS keeps State documents and merges JSON on POST", () => {
  const lrs = new StandInLrs("http://x.test/lrs/", AUTH);
  const agent = encodeURIComponent(JSON.stringify({ mbox: "mailto:l@example.test" }));
  const url = `${lrs.endpoint}activities/state?activityId=${encodeURIComponent("https://e.org/a")}&agent=${agent}&stateId=bookmark`;
  const h = { "X-Experience-API-Version": "1.0.3", Authorization: AUTH, "Content-Type": "application/json" };
  assert.equal(lrs.handle({ method: "GET", url, headers: h, body: "" }).status, 404);
  assert.equal(lrs.handle({ method: "PUT", url, headers: h, body: '{"page":3}' }).status, 204);
  assert.equal(lrs.handle({ method: "POST", url, headers: h, body: '{"done":true}' }).status, 204);
  assert.deepEqual(JSON.parse(lrs.handle({ method: "GET", url, headers: h, body: "" }).body), { page: 3, done: true });
  assert.equal(lrs.handle({ method: "PUT", url, headers: h, body: "{not json" }).status, 400);
});

// ---- cmi5

function cmi5Statement(lms: Cmi5Lms, verb: string, extra: { result?: Record<string, unknown>; moveOn?: boolean; mastery?: boolean } = {}) {
  const category = [{ id: CMI5.category }, ...(extra.moveOn ? [{ id: CMI5.moveOn }] : [])];
  const extensions: Record<string, unknown> = { [CMI5.sessionId]: lms.sessionId };
  if (extra.mastery) extensions[CMI5.masteryScore] = lms.au.masteryScore;
  return {
    id: uuid4(),
    actor: lms.actor,
    verb: { id: `http://adlnet.gov/expapi/verbs/${verb}` },
    object: { id: lms.activityId },
    context: { registration: lms.registration, contextActivities: { grouping: [{ id: lms.au.id }], category }, extensions },
    timestamp: new Date().toISOString(),
    ...(extra.result ? { result: extra.result } : {}),
  };
}

test("cmi5: the launch, the token handed out once, and a session that keeps the rules", () => {
  const lms = new Cmi5Lms("http://x.test/lms/0/", { id: "https://example.org/au/1", moveOn: "CompletedAndPassed", masteryScore: 0.8 });
  const query = new URLSearchParams(lms.launch("index.html"));
  assert.equal(query.get("fetch"), "http://x.test/lms/0/fetch");
  assert.equal(query.get("endpoint"), "http://x.test/lms/0/lrs/");
  const token = JSON.parse(lms.fetch({ method: "POST", url: lms.fetchUrl, headers: {}, body: "" }).body)["auth-token"];
  assert.ok(token);
  assert.equal(JSON.parse(lms.fetch({ method: "POST", url: lms.fetchUrl, headers: {}, body: "" }).body)["error-code"], "1");
  const h = { "X-Experience-API-Version": "1.0.3", Authorization: `Basic ${token}`, "Content-Type": "application/json" };
  const agent = encodeURIComponent(JSON.stringify(lms.actor));
  const data = lms.lrs.handle({ method: "GET", url: `${lms.lrs.endpoint}activities/state?activityId=${encodeURIComponent(lms.activityId)}&agent=${agent}&registration=${lms.registration}&stateId=LMS.LaunchData`, headers: h, body: "" });
  assert.equal(JSON.parse(data.body).launchMode, "Normal");
  const send = (s: unknown) => lms.lrs.handle({ method: "POST", url: lms.lrs.endpoint + "statements", headers: h, body: JSON.stringify(s) });
  send(cmi5Statement(lms, "initialized"));
  send(cmi5Statement(lms, "completed", { moveOn: true, result: { completion: true, duration: "PT5M" } }));
  send(cmi5Statement(lms, "passed", { moveOn: true, mastery: true, result: { success: true, score: { scaled: 0.9 }, duration: "PT5M" } }));
  send(cmi5Statement(lms, "terminated", { result: { duration: "PT6M" } }));
  assert.deepEqual(lms.problems(), []);
  assert.deepEqual(lms.satisfied(), { needed: "CompletedAndPassed", met: true });
});

test("cmi5: the rules a course breaks are named", () => {
  const lms = new Cmi5Lms("http://x.test/lms/0/", { id: "https://example.org/au/1", masteryScore: 0.8 });
  lms.launch("index.html");
  const token = JSON.parse(lms.fetch({ method: "POST", url: lms.fetchUrl, headers: {}, body: "" }).body)["auth-token"];
  const h = { "X-Experience-API-Version": "1.0.3", Authorization: `Basic ${token}`, "Content-Type": "application/json" };
  const send = (s: unknown) => lms.lrs.handle({ method: "POST", url: lms.lrs.endpoint + "statements", headers: h, body: JSON.stringify(s) });
  send(cmi5Statement(lms, "completed", { result: { completion: true } }));
  send(cmi5Statement(lms, "passed", { moveOn: true, result: { success: true, score: { scaled: 0.5 }, duration: "PT1M" } }));
  const problems = lms.problems().join("\n");
  assert.match(problems, /first statement is completed/);
  assert.match(problems, /moveOn category is missing/);
  assert.match(problems, /needs result\.duration/);
  assert.match(problems, /masteryScore \(0\.8\) must be in context\.extensions/);
  assert.match(problems, /scaled score 0\.5 is below the masteryScore 0\.8/);
});

// ---- the test player's session

const SCORM12_FILES = { "imsmanifest.xml": scorm12(), "index.html": PAGE, "images/Logo.png": "png" };

test("the session serves the package's files, notes what is missing, and answers ranges", () => {
  const s = session(SCORM12_FILES);
  const url = s.launch(0);
  assert.equal(url, `${ORIGIN}/play/t1/pkg/index.html`);
  const page = s.handle({ method: "GET", url, headers: {}, body: "" });
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html");
  assert.equal(s.handle({ method: "GET", url: `${ORIGIN}/play/t1/pkg/script.js`, headers: {}, body: "" }).status, 404);
  assert.equal(s.handle({ method: "GET", url: `${ORIGIN}/play/t1/pkg/images/logo.png`, headers: {}, body: "" }).status, 200);
  const part = s.handle({ method: "GET", url: `${ORIGIN}/play/t1/pkg/index.html`, headers: { range: "bytes=0-14" }, body: "" });
  assert.equal(part.status, 206);
  assert.equal(new TextDecoder().decode(part.body as Uint8Array), "<!doctype html>");
  s.noteOutside(`${ORIGIN}/fonts/a.woff`);
  s.noteOutside("https://fonts.example.com/css?family=x");
  const found = s.findings();
  assert.deepEqual(found.find((f) => f.id === "play-missing-file")?.severity, "problem");
  assert.deepEqual(found.find((f) => f.id === "play-file-case")?.detail, "The course asked for images/logo.png; the package has images/Logo.png.");
  assert.equal(found.find((f) => f.id === "play-root-request")?.severity, "warning");
  assert.equal(found.find((f) => f.id === "play-external")?.detail, "https://fonts.example.com.");
});

test("the session runs a SCORM 1.2 launch through its API and says what went wrong", () => {
  const s = session(SCORM12_FILES);
  s.launch(0);
  const api = s.api!;
  api.LMSInitialize("");
  api.LMSSetValue("cmi.core.score.raw", "high");
  s.end();
  const found = s.findings();
  assert.deepEqual(found.map((f) => f.id).sort(), ["play-no-finish", "play-refused"]);
  assert.equal(found.find((f) => f.id === "play-refused")!.severity, "problem");
  assert.ok(s.holds().some((h) => h.label === "Status" && h.value === "not attempted"));

  s.launch(0);
  s.api!.LMSInitialize("");
  s.api!.LMSFinish("");
  s.end();
  assert.ok(ids(s).includes("play-no-status"));
  assert.match(s.logText(), /LMSFinish\(""\) -> "true"/);
});

test("the session notices a SCORM 2004 course that never finds the API", () => {
  const s = session({ "imsmanifest.xml": scorm2004(), "index.html": PAGE });
  s.launch(0);
  assert.ok(s.api2004);
  s.end();
  assert.deepEqual(ids(s), ["play-no-api"]);
});

test("the session launches an xAPI course with the LRS's address, and notices a course that sends nothing", () => {
  const s = session({ "tincan.xml": tincan(), "index.html": PAGE });
  const url = new URL(s.launch(0));
  assert.equal(url.searchParams.get("endpoint"), `${ORIGIN}/play/t1/lms/lrs/`);
  assert.equal(url.searchParams.get("activity_id"), "https://example.org/course/1");
  const auth = url.searchParams.get("auth")!;
  const answer = s.handle({ method: "POST", url: `${ORIGIN}/play/t1/lms/lrs/statements`, headers: { "x-experience-api-version": "1.0.3", authorization: auth, "content-type": "application/json" }, body: JSON.stringify(statement()) });
  assert.equal(answer.status, 200);
  assert.ok(s.holds().some((h) => h.label === "Statements kept" && h.value === "1"));
  s.end();
  assert.deepEqual(ids(s), []);
  s.launch(0);
  s.end();
  assert.deepEqual(ids(s), ["play-no-statement"]);
});

test("the session launches a cmi5 AU and notices one that never fetches its token", () => {
  const s = session({ "cmi5.xml": cmi5(), "index.html": PAGE });
  const url = new URL(s.launch(0));
  assert.equal(url.searchParams.get("fetch"), `${ORIGIN}/play/t1/lms/0/fetch`);
  s.end();
  assert.deepEqual(ids(s).sort(), ["play-cmi5-fetch", "play-no-statement"]);
  s.launch(0);
  const fetched = s.handle({ method: "POST", url: `${ORIGIN}/play/t1/lms/0/fetch`, headers: {}, body: "" });
  assert.ok(JSON.parse(String(fetched.body))["auth-token"]);
});

test("cmi5: a statement from the last launch that arrives after the next has begun still counts, in its own session", () => {
  const lms = new Cmi5Lms("http://x.test/lms/0/", { id: "https://example.org/au/1" });
  lms.launch("index.html");
  const first = JSON.parse(lms.fetch({ method: "POST", url: lms.fetchUrl, headers: {}, body: "" }).body)["auth-token"];
  const h = (token: string) => ({ "X-Experience-API-Version": "1.0.3", Authorization: `Basic ${token}`, "Content-Type": "application/json" });
  const send = (s: unknown, token: string) => lms.lrs.handle({ method: "POST", url: lms.lrs.endpoint + "statements", headers: h(token), body: JSON.stringify(s) });
  send(cmi5Statement(lms, "initialized"), first);
  const terminated = cmi5Statement(lms, "terminated", { result: { duration: "PT1M" } });
  lms.launch("index.html");
  assert.equal(send(terminated, first).status, 200);
  const second = JSON.parse(lms.fetch({ method: "POST", url: lms.fetchUrl, headers: {}, body: "" }).body)["auth-token"];
  send(cmi5Statement(lms, "initialized"), second);
  assert.deepEqual(lms.problems(), []);
});

test("reading a SCORM 2004 value nothing has set yet is in the log but is not a finding", () => {
  const s = session({ "imsmanifest.xml": scorm2004(), "index.html": PAGE });
  s.launch(0);
  s.api2004!.Initialize("");
  assert.equal(s.api2004!.GetValue("cmi.location"), "");
  s.api2004!.SetValue("cmi.completion_status", "completed");
  s.api2004!.Terminate("");
  s.end();
  assert.ok(s.log.some((e) => e.text === 'GetValue("cmi.location")' && /^Error 403/.test(e.refused ?? "")));
  assert.deepEqual(ids(s), []);
});
