// A stand-in learning record store (LRS) for xAPI 1.0.3: statements, the State, Activity Profile and Agent Profile
// documents, and the small lookups a course may make. It is as strict as the standard: it refuses a statement a real LRS
// must refuse, and says why in words. It keeps everything in memory, for one sitting of the test player. It is a test
// aid, not a real LRS. Started from OpenStage Author's player/src/fake-lrs.ts, with Author's own rules taken out.

export interface HttpRequest {
  method: string;
  /** The whole address, with the query. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One request the course made to the LRS, with what the LRS answered. */
export interface LrsRequest {
  method: string;
  /** The part of the address after the endpoint, such as statements or activities/state. */
  resource: string;
  status: number;
  /** Why the LRS refused it, in words. */
  reason?: string;
  /** The statements the request carried, when it sent some. */
  statements?: Record<string, unknown>[];
  /** For a document: its id (stateId or profileId). */
  document?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IRI = /^[a-z][a-z0-9+.-]*:[^\s]+$/i;
const LANG = /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/i;
const DURATION = /^P(?!$)(\d+(\.\d+)?Y)?(\d+(\.\d+)?M)?(\d+(\.\d+)?W)?(\d+(\.\d+)?D)?(T(?!$)(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const TOP = ["id", "actor", "verb", "object", "result", "context", "timestamp", "stored", "authority", "version", "attachments"];
const INTERACTIONS = ["true-false", "choice", "fill-in", "long-fill-in", "matching", "performance", "sequencing", "likert", "numeric", "other"];

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function uuid4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function languageMap(v: unknown, what: string): string | null {
  if (!isObject(v)) return `${what} must be a language map, as {"en-US": "..."}`;
  for (const [k, text] of Object.entries(v)) {
    if (!LANG.test(k)) return `${what} has "${k}", which is not a language code`;
    if (typeof text !== "string") return `${what} must map language codes to text`;
  }
  return null;
}

function extensions(v: unknown, what: string): string | null {
  if (v === undefined) return null;
  if (!isObject(v)) return `${what} must be an object`;
  for (const k of Object.keys(v)) if (!IRI.test(k)) return `${what} has the key "${k}", which is not an address (IRI)`;
  return null;
}

function agentProblem(a: unknown, what: string, groupOk = true): string | null {
  if (!isObject(a)) return `${what} is missing or is not an object`;
  const type = a["objectType"] ?? "Agent";
  if (type !== "Agent" && !(groupOk && type === "Group")) return `${what} must be an Agent${groupOk ? " or a Group" : ""}`;
  const ids = ["mbox", "mbox_sha1sum", "openid", "account"].filter((k) => a[k] !== undefined);
  if (type === "Agent" && ids.length !== 1) return `${what} needs exactly one way of being identified (mbox, mbox_sha1sum, openid or account), and has ${ids.length}`;
  if (type === "Group" && ids.length > 1) return `${what} has more than one way of being identified`;
  if (type === "Group" && ids.length === 0 && !Array.isArray(a["member"])) return `${what} is a Group with no identifier, so it must list its members`;
  if (typeof a["mbox"] === "string" && !/^mailto:\S+@\S+$/.test(a["mbox"])) return `${what}'s mbox must be a mailto: address`;
  if (a["mbox"] !== undefined && typeof a["mbox"] !== "string") return `${what}'s mbox must be text`;
  if (a["account"] !== undefined && !(isObject(a["account"]) && typeof a["account"]["homePage"] === "string" && IRI.test(a["account"]["homePage"]) && typeof a["account"]["name"] === "string")) return `${what}'s account needs a homePage address and a name`;
  if (a["name"] !== undefined && typeof a["name"] !== "string") return `${what}'s name must be text`;
  if (Array.isArray(a["member"])) for (const m of a["member"]) { const p = agentProblem(m, `a member of ${what}`, false); if (p) return p; }
  return null;
}

function activityProblem(o: Obj, what: string): string | null {
  if (typeof o["id"] !== "string" || !IRI.test(o["id"])) return `${what}'s id must be an address (IRI)`;
  const def = o["definition"];
  if (def === undefined) return null;
  if (!isObject(def)) return `${what}'s definition must be an object`;
  for (const k of ["name", "description"]) if (def[k] !== undefined) { const p = languageMap(def[k], `${what}'s definition.${k}`); if (p) return p; }
  if (def["type"] !== undefined && !(typeof def["type"] === "string" && IRI.test(def["type"]))) return `${what}'s definition.type must be an address (IRI)`;
  if (def["moreInfo"] !== undefined && !(typeof def["moreInfo"] === "string" && IRI.test(def["moreInfo"]))) return `${what}'s definition.moreInfo must be an address`;
  if (def["interactionType"] !== undefined && !INTERACTIONS.includes(String(def["interactionType"]))) return `${what}'s interactionType "${def["interactionType"]}" is not one of xAPI's (${INTERACTIONS.join(", ")})`;
  const patterns = def["correctResponsesPattern"];
  if (patterns !== undefined && !(Array.isArray(patterns) && patterns.every((p) => typeof p === "string"))) return `${what}'s correctResponsesPattern must be a list of text`;
  for (const list of ["choices", "scale", "source", "target", "steps"]) {
    const v = def[list];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((c) => isObject(c) && typeof c["id"] === "string" && (c["description"] === undefined || languageMap(c["description"], "x") === null))) return `${what}'s ${list} must be a list of {id, description}`;
  }
  return extensions(def["extensions"], `${what}'s definition.extensions`);
}

/** Why a real LRS would refuse this statement, in words, or null when it would keep it. */
export function statementProblem(s: unknown, sub = false): string | null {
  const what = sub ? "the sub-statement" : "the statement";
  if (!isObject(s)) return `${what} is not a JSON object`;
  for (const key of Object.keys(s)) {
    if (sub && key === "objectType") continue;
    if (!TOP.includes(key)) return `${what} has a property xAPI does not have: "${key}"`;
    if (sub && ["id", "stored", "version", "authority"].includes(key)) return `a sub-statement may not have "${key}"`;
  }
  if (s["id"] !== undefined && !(typeof s["id"] === "string" && UUID.test(s["id"]))) return `${what}'s id "${String(s["id"])}" is not a UUID`;
  const actor = agentProblem(s["actor"], "the actor");
  if (actor) return actor;

  const verb = s["verb"];
  if (!isObject(verb)) return `${what} has no verb`;
  if (typeof verb["id"] !== "string" || !IRI.test(verb["id"])) return "the verb's id must be an address (IRI)";
  if (verb["display"] !== undefined) { const p = languageMap(verb["display"], "the verb's display"); if (p) return p; }

  const object = s["object"];
  if (!isObject(object)) return `${what} has no object`;
  const type = object["objectType"] ?? "Activity";
  if (type === "Activity") { const p = activityProblem(object, "the object"); if (p) return p; }
  else if (type === "Agent" || type === "Group") { const p = agentProblem(object, "the object"); if (p) return p; }
  else if (type === "StatementRef") { if (typeof object["id"] !== "string" || !UUID.test(object["id"])) return "a StatementRef's id must be a UUID"; }
  else if (type === "SubStatement") {
    if (sub) return "a sub-statement may not hold another sub-statement";
    const p = statementProblem(object, true);
    if (p) return p;
  } else return `the object's objectType "${String(type)}" is not one of Activity, Agent, Group, StatementRef or SubStatement`;
  if (String(verb["id"]) === "http://adlnet.gov/expapi/verbs/voided" && type !== "StatementRef") return "a voiding statement's object must be a StatementRef";

  const result = s["result"];
  if (result !== undefined) {
    if (!isObject(result)) return "the result must be an object";
    for (const key of ["success", "completion"]) if (result[key] !== undefined && typeof result[key] !== "boolean") return `result.${key} must be true or false, not ${JSON.stringify(result[key])}`;
    if (result["response"] !== undefined && typeof result["response"] !== "string") return "result.response must be text";
    if (result["duration"] !== undefined && !(typeof result["duration"] === "string" && DURATION.test(result["duration"]))) return `result.duration "${String(result["duration"])}" is not an ISO 8601 duration, as PT1M30S`;
    const score = result["score"];
    if (score !== undefined) {
      if (!isObject(score)) return "result.score must be an object";
      for (const key of ["scaled", "raw", "min", "max"]) if (score[key] !== undefined && typeof score[key] !== "number") return `result.score.${key} must be a number, not ${JSON.stringify(score[key])}`;
      const { scaled, raw, min, max } = score as Record<string, number | undefined>;
      if (scaled !== undefined && (scaled < -1 || scaled > 1)) return `result.score.scaled is ${scaled}; it must be from -1 to 1`;
      if (min !== undefined && max !== undefined && min > max) return `result.score.min (${min}) is above result.score.max (${max})`;
      if (raw !== undefined && min !== undefined && raw < min) return `result.score.raw (${raw}) is below result.score.min (${min})`;
      if (raw !== undefined && max !== undefined && raw > max) return `result.score.raw (${raw}) is above result.score.max (${max})`;
    }
    const p = extensions(result["extensions"], "result.extensions");
    if (p) return p;
  }

  const context = s["context"];
  if (context !== undefined) {
    if (!isObject(context)) return "the context must be an object";
    if (context["registration"] !== undefined && !(typeof context["registration"] === "string" && UUID.test(context["registration"]))) return "context.registration must be a UUID";
    const activities = context["contextActivities"];
    if (activities !== undefined) {
      if (!isObject(activities)) return "context.contextActivities must be an object";
      for (const [k, list] of Object.entries(activities)) {
        if (!["parent", "grouping", "category", "other"].includes(k)) return `context.contextActivities has "${k}"; it may only have parent, grouping, category and other`;
        for (const a of Array.isArray(list) ? list : [list]) {
          if (!isObject(a)) return `context.contextActivities.${k} must hold activities`;
          const p = activityProblem(a, `an activity in context.contextActivities.${k}`);
          if (p) return p;
        }
      }
    }
    if (context["instructor"] !== undefined) { const p = agentProblem(context["instructor"], "context.instructor"); if (p) return p; }
    if (context["team"] !== undefined && !(isObject(context["team"]) && context["team"]["objectType"] === "Group")) return "context.team must be a Group";
    if (type !== "Activity" && (context["revision"] !== undefined || context["platform"] !== undefined)) return "context.revision and context.platform are only allowed when the object is an Activity";
    if (context["language"] !== undefined && !(typeof context["language"] === "string" && LANG.test(context["language"]))) return "context.language must be a language code";
    const p = extensions(context["extensions"], "context.extensions");
    if (p) return p;
  }
  if (s["timestamp"] !== undefined && !(typeof s["timestamp"] === "string" && TIMESTAMP.test(s["timestamp"]) && !Number.isNaN(Date.parse(s["timestamp"])))) return `the timestamp "${String(s["timestamp"])}" is not an ISO 8601 date and time`;
  if (s["version"] !== undefined && !(typeof s["version"] === "string" && /^1\.0(\.\d+)?$/.test(s["version"]))) return `the version "${String(s["version"])}" is not 1.0.x`;
  return null;
}

const json = (status: number, value: unknown): HttpResponse => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const empty = (status: number): HttpResponse => ({ status, headers: {}, body: "" });
const refuse = (status: number, reason: string): HttpResponse => ({ status, headers: { "content-type": "text/plain; charset=utf-8" }, body: reason });

export class StandInLrs {
  /** Every statement kept, in the order it arrived. */
  readonly statements: Obj[] = [];
  /** State and profile documents, by a key made of what names them. */
  readonly documents = new Map<string, { contentType: string; body: string; updated: string }>();
  /** Called after every request. */
  onRequest: (r: LrsRequest) => void = () => {};
  /** The LRS's address, ending in a slash. */
  readonly endpoint: string;
  /** The credentials the course must send: the Authorization header, whole. */
  auth: string;
  /** Earlier credentials still accepted: a course's last statements can arrive after the LMS has launched it again. */
  readonly earlierAuth = new Set<string>();

  constructor(endpoint: string, auth: string) {
    this.endpoint = endpoint;
    this.auth = auth;
  }

  /** Keeps a statement the LMS writes itself, as cmi5's launched. */
  store(statement: Obj): void {
    this.statements.push({ ...statement, stored: new Date().toISOString(), version: "1.0.0" });
  }

  handle(request: HttpRequest): HttpResponse {
    let { method } = request;
    const u = new URL(request.url);
    let headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]));
    let body = request.body;
    let params = u.searchParams;
    const resource = u.pathname.slice(new URL(this.endpoint).pathname.length).replace(/\/$/, "");
    // The "alternate request syntax" older xAPI libraries use: everything in a form-encoded POST, the real method in ?method=.
    const alternate = params.get("method");
    if (alternate && method === "POST") {
      const form = new URLSearchParams(body);
      method = alternate.toUpperCase();
      headers = { ...headers };
      params = new URLSearchParams();
      for (const [k, v] of form) {
        const low = k.toLowerCase();
        if (["authorization", "x-experience-api-version", "content-type", "if-match", "if-none-match"].includes(low)) headers[low] = v;
        else if (low === "content") body = v;
        else params.set(k, v);
      }
    }
    const answer = this.route(method, resource, params, headers, body);
    const record: LrsRequest = { method, resource: resource || "(the endpoint itself)", status: answer.response.status };
    if (answer.response.status >= 400) record.reason = answer.response.body || `${answer.response.status}`;
    if (answer.statements) record.statements = answer.statements;
    if (answer.document) record.document = answer.document;
    this.onRequest(record);
    answer.response.headers["x-experience-api-version"] = "1.0.3";
    return answer.response;
  }

  private route(method: string, resource: string, params: URLSearchParams, headers: Record<string, string>, body: string): { response: HttpResponse; statements?: Obj[]; document?: string } {
    if (resource === "about" && method === "GET") return { response: json(200, { version: ["1.0.3", "1.0.0"] }) };
    const version = headers["x-experience-api-version"];
    if (!version) return { response: refuse(400, "The request has no X-Experience-API-Version header, which every xAPI request must carry.") };
    if (!/^1\.0(\.\d+)?$/.test(version)) return { response: refuse(400, `X-Experience-API-Version is "${version}"; this LRS speaks 1.0.x.`) };
    if (headers["authorization"] !== this.auth && !this.earlierAuth.has(headers["authorization"] ?? "")) {
      return { response: refuse(401, headers["authorization"] ? "The Authorization header is not the one the LMS gave at launch." : "The request has no Authorization header; the course must send the credentials the LMS gave it at launch.") };
    }

    if (resource === "statements") return this.statements_(method, params, headers, body);

    const docs: Record<string, { key: string[]; id: string; needAgent?: boolean }> = {
      "activities/state": { key: ["activityId", "agent", "registration"], id: "stateId", needAgent: true },
      "activities/profile": { key: ["activityId"], id: "profileId" },
      "agents/profile": { key: ["agent"], id: "profileId", needAgent: true },
    };
    const doc = docs[resource];
    if (doc) {
      for (const k of doc.key) {
        if (k === "registration") continue;
        if (!params.get(k)) return { response: refuse(400, `${resource} needs the ${k} parameter.`) };
      }
      if (doc.needAgent) {
        let agent: unknown;
        try { agent = JSON.parse(params.get("agent") ?? ""); } catch { return { response: refuse(400, "The agent parameter is not JSON.") }; }
        const p = agentProblem(agent, "the agent parameter");
        if (p) return { response: refuse(400, p + ".") };
      }
      const registration = params.get("registration");
      if (registration !== null && !UUID.test(registration)) return { response: refuse(400, "The registration parameter must be a UUID.") };
      const base = [resource, ...doc.key.map((k) => params.get(k) ?? "")].join("|");
      const id = params.get(doc.id);
      if (method === "GET" && id === null) {
        const ids = [...this.documents.keys()].filter((k) => k.startsWith(base + "|")).map((k) => k.slice(base.length + 1));
        return { response: json(200, ids) };
      }
      if (id === null) return { response: refuse(400, `${resource} needs the ${doc.id} parameter.`) };
      const key = `${base}|${id}`;
      const kept = this.documents.get(key);
      const type = headers["content-type"] ?? "application/octet-stream";
      if (method === "GET") return { response: kept ? { status: 200, headers: { "content-type": kept.contentType, "last-modified": kept.updated }, body: kept.body } : refuse(404, "There is no such document yet."), document: id };
      if (method === "DELETE") { this.documents.delete(key); return { response: empty(204), document: id }; }
      if (method === "PUT" || method === "POST") {
        if (/json/i.test(type)) {
          let value: unknown;
          try { value = JSON.parse(body); } catch { return { response: refuse(400, `The document is sent as JSON (${type}), but it is not JSON.`), document: id }; }
          if (method === "POST" && kept) {
            let old: unknown;
            try { old = JSON.parse(kept.body); } catch { old = undefined; }
            if (!isObject(old) || !isObject(value)) return { response: refuse(400, "POST merges JSON objects, and one of the two is not a JSON object."), document: id };
            body = JSON.stringify({ ...old, ...value });
          }
        } else if (method === "POST" && kept) return { response: refuse(400, "POST merges JSON documents, and this one is not sent as JSON."), document: id };
        this.documents.set(key, { contentType: type, body, updated: new Date().toISOString() });
        return { response: empty(204), document: id };
      }
    }
    if (resource === "activities" && method === "GET") {
      const id = params.get("activityId");
      return { response: id ? json(200, { objectType: "Activity", id }) : refuse(400, "activities needs the activityId parameter.") };
    }
    if (resource === "agents" && method === "GET") {
      let agent: Obj;
      try { agent = JSON.parse(params.get("agent") ?? "") as Obj; } catch { return { response: refuse(400, "The agent parameter is not JSON.") }; }
      const person: Obj = { objectType: "Person" };
      for (const k of ["name", "mbox", "mbox_sha1sum", "openid", "account"]) if (agent[k] !== undefined) person[k] = [agent[k]];
      return { response: json(200, person) };
    }
    return { response: refuse(404, `This LRS has no ${method} ${resource || "on the endpoint itself"}. xAPI's resources are statements, activities/state, activities/profile, agents/profile, activities, agents and about.`) };
  }

  private statements_(method: string, params: URLSearchParams, headers: Record<string, string>, body: string): { response: HttpResponse; statements?: Obj[] } {
    if (method === "GET") {
      const id = params.get("statementId") ?? params.get("voidedStatementId");
      if (id) {
        const s = this.statements.find((x) => x["id"] === id);
        return { response: s ? json(200, s) : refuse(404, "There is no statement with that id.") };
      }
      let list = this.statements.filter((s) => !this.voided(String(s["id"])));
      const verb = params.get("verb");
      if (verb) list = list.filter((s) => (s["verb"] as Obj)["id"] === verb);
      const activity = params.get("activity");
      if (activity) list = list.filter((s) => (s["object"] as Obj)["id"] === activity);
      const registration = params.get("registration");
      if (registration) list = list.filter((s) => isObject(s["context"]) && s["context"]["registration"] === registration);
      const ascending = params.get("ascending") === "true";
      list = ascending ? list : [...list].reverse();
      const limit = Number(params.get("limit") ?? 0);
      return { response: json(200, { statements: limit > 0 ? list.slice(0, limit) : list, more: "" }) };
    }
    if (method !== "POST" && method !== "PUT") return { response: refuse(405, `Statements can be sent with POST or PUT and read with GET, not ${method}.`) };
    const type = headers["content-type"] ?? "";
    if (/^multipart\/mixed/i.test(type)) return { response: refuse(400, "The statements came with attachments (multipart/mixed). Package Doctor's test LRS does not read attachments, so they were not checked.") };
    if (!/^application\/json/i.test(type)) return { response: refuse(400, `Statements must be sent as application/json; the Content-Type is "${type || "(none)"}".`) };
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return { response: refuse(400, "The body is not JSON.") }; }
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as unknown[];
    const shown = list.filter(isObject);
    if (method === "PUT") {
      const id = params.get("statementId");
      if (!id || !UUID.test(id)) return { response: refuse(400, "PUT statements needs a statementId parameter that is a UUID."), statements: shown };
      if (Array.isArray(parsed)) return { response: refuse(400, "PUT sends one statement, not a list."), statements: shown };
      if (isObject(parsed) && parsed["id"] !== undefined && parsed["id"] !== id) return { response: refuse(400, "The statement's id is not the statementId in the address."), statements: shown };
      if (isObject(parsed)) parsed["id"] ??= id;
    }
    for (const [i, s] of list.entries()) {
      const p = statementProblem(s);
      if (p) return { response: refuse(400, (list.length > 1 ? `Statement ${i + 1} of ${list.length}: ` : "") + p + ". The LRS keeps none of the statements in this request."), statements: shown };
    }
    const ids: string[] = [];
    const fresh: Obj[] = [];
    for (const raw of list as Obj[]) {
      const s: Obj = { ...raw };
      s["id"] ??= uuid4();
      const earlier = this.statements.find((x) => x["id"] === s["id"]);
      if (earlier) {
        const same = (o: Obj) => JSON.stringify({ ...o, stored: undefined, version: undefined, authority: undefined });
        if (same(earlier) !== same(s)) return { response: refuse(409, `A different statement already has the id ${String(s["id"])}.`), statements: shown };
        ids.push(String(s["id"]));
        continue;
      }
      s["timestamp"] ??= new Date().toISOString();
      fresh.push(s);
      ids.push(String(s["id"]));
    }
    for (const s of fresh) this.statements.push({ ...s, stored: new Date().toISOString(), version: (s["version"] as string | undefined) ?? "1.0.0" });
    return { response: method === "PUT" ? empty(204) : json(200, ids), statements: fresh };
  }

  private voided(id: string): boolean {
    return this.statements.some((s) => (s["verb"] as Obj)["id"] === "http://adlnet.gov/expapi/verbs/voided" && (s["object"] as Obj)["id"] === id);
  }
}
