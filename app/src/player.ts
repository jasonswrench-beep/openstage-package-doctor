// The test player: the course in a frame, played the way an LMS plays it, with a log beside it of everything the course
// tells the LMS. The course's files are served from the open zip by a service worker (player-sw.ts) on the window's own
// site, so a SCORM course finds the API object on this window, as it would on an LMS's page. For xAPI and cmi5 the same
// worker carries the course's requests to a stand-in LRS. Everything stays on this computer.
// Accessibility: the player is a section with its own heading; the controls are ordinary buttons and selects; the log
// and the LMS's record are in a region that can be scrolled by keyboard; what matters (the course started, finished,
// was refused) is said in the status line, in words.

import { SEVERITY_ORDER, SEVERITY_WORDS } from "../../core/src/findings.ts";
import type { Mode } from "../../core/src/play/scorm-common.ts";
import { STANDARD_WORDS, type PlaySession } from "../../core/src/play/session.ts";
import { badge, copyText, findingItem, h } from "./dom.ts";
import { icon } from "./icons.ts";

export interface PlayerHost {
  main: HTMLElement;
  say(message: string): void;
  /** Called when the person goes back to the report. */
  back(): void;
}

const LOG_SHOWN = 300;
const channel = "BroadcastChannel" in window ? new BroadcastChannel("package-doctor-play") : undefined;
let active: PlaySession | undefined;

// The worker hands every request under /play/ to this window. Requests for another sitting (another window of the
// preview, say) are left for that window to answer.
channel?.addEventListener("message", (e: MessageEvent) => {
  const m = e.data;
  const session = active;
  if (!session) return;
  if (m?.type === "outside") {
    session.noteOutside(String(m.url));
    return;
  }
  if (m?.type !== "request" || !String(m.url).startsWith(session.base)) return;
  const body = m.body ? new TextDecoder().decode(m.body as ArrayBuffer) : "";
  let answer;
  try {
    answer = session.handle({ method: m.method, url: m.url, headers: m.headers, body });
  } catch (err) {
    answer = { status: 500, headers: { "content-type": "text/plain; charset=utf-8" }, body: `Package Doctor could not answer: ${err instanceof Error ? err.message : String(err)}` };
  }
  const out = answer.body instanceof Uint8Array ? answer.body.slice().buffer : answer.body;
  channel.postMessage({ type: "response", rid: m.rid, status: answer.status, headers: answer.headers, body: out });
});

/** Registers the worker (once) and waits until it is running. */
async function worker(): Promise<void> {
  if (!("serviceWorker" in navigator) || !channel) throw new Error("This window cannot run the test player: it has no service workers.");
  // Only the player's worker belongs here; anything else registered on this site is left over and is removed.
  for (const r of await navigator.serviceWorker.getRegistrations()) {
    if (!new URL(r.scope).pathname.endsWith("/play/")) await r.unregister();
  }
  const reg = await navigator.serviceWorker.register("player-sw.js", { scope: "play/" });
  if (reg.active) return;
  const w = reg.installing ?? reg.waiting;
  if (!w) throw new Error("The test player's worker did not start.");
  await new Promise<void>((resolve, reject) => {
    w.addEventListener("statechange", () => {
      if (w.state === "activated") resolve();
      if (w.state === "redundant") reject(new Error("The test player's worker did not start."));
    });
    window.setTimeout(() => (reg.active ? resolve() : reject(new Error("The test player's worker took too long to start."))), 10000);
  });
}

type ApiWindow = Window & { API?: unknown; API_1484_11?: unknown };

export async function openPlayer(session: PlaySession, host: PlayerHost, first = 0): Promise<void> {
  try {
    await worker();
  } catch (e) {
    host.say(e instanceof Error ? e.message : String(e));
    return;
  }
  active = session;
  const w = window as ApiWindow;
  const standard = session.standard ? STANDARD_WORDS[session.standard] : "";
  let part = first;
  let rendered = 0;
  let handledNav = 0;
  let announced = session.log.length;
  let refusalSaid = false;

  // ---- the controls
  const title = h("h1", { id: "player-title", tabindex: "-1" }, "Test player");
  const backButton = h("button", { type: "button", class: "button" }, "Back to the report");
  const relaunchButton = h("button", { type: "button", class: "button" }, "Leave and relaunch");
  const resetButton = h("button", { type: "button", class: "button" }, "Empty the learner's record");
  const copyButton = h("button", { type: "button", class: "button" }, icon("copy"), "Copy log");
  const partSelect = h("select", { id: "player-part" }, ...session.playable.map((p) => h("option", { value: String(p.index) }, `${p.index + 1}. ${p.title}${p.tracked ? "" : " (asset)"}`)));
  partSelect.value = String(part);
  const modeSelect = h(
    "select",
    { id: "player-mode" },
    h("option", { value: "normal" }, "Normal: the attempt counts"),
    h("option", { value: "browse" }, "Browse: looking, not counted"),
    h("option", { value: "review" }, "Review: looking back, nothing changes"),
  );
  modeSelect.value = session.mode;

  // ---- the course and what the LMS saw
  const frame = h("iframe", { class: "player-frame", title: "Course" });
  const closed = h("div", { class: "player-closed", hidden: true });
  const holds = h("dl", { class: "facts facts--tight" });
  const found = h("div", {});
  const statements = h("div", {});
  const log = h("ol", { class: "player-log" });
  const logNote = h("p", { class: "muted" });
  // Two parts that scroll on their own, so the log running on never pushes the LMS's record out of sight.
  const summary = h(
    "div",
    { class: "player-summary", role: "region", "aria-labelledby": "player-holds-h", tabindex: "0" },
    h("h2", { id: "player-holds-h" }, session.standard === "xapi" || session.standard === "cmi5" ? "What the LRS holds" : "What the LMS holds"),
    holds,
    h("h2", {}, "What the test player found"),
    found,
    statements,
  );
  const logBox = h("div", { class: "player-logbox", role: "region", "aria-labelledby": "player-log-h", tabindex: "0" }, h("h2", { id: "player-log-h" }, "Log"), logNote, log);
  const panel = h("div", { class: "player-panel" }, summary, logBox);

  host.main.replaceChildren(
    h(
      "section",
      { class: "player", "aria-labelledby": "player-title" },
      h(
        "div",
        { class: "player-head" },
        title,
        h("p", { class: "muted" }, `Plays the course as a ${standard} LMS would, and logs everything the course tells it. The learner, "Learner, Test", is made up, and nothing is sent anywhere or kept once this window closes.`),
        h(
          "div",
          { class: "player-tools" },
          backButton,
          session.playable.length > 1 ? h("label", { class: "field" }, "Part ", partSelect) : null,
          h("label", { class: "field" }, "Launch ", modeSelect),
          relaunchButton,
          resetButton,
          copyButton,
        ),
      ),
      h("div", { class: "player-body" }, h("div", { class: "player-stage" }, frame, closed), panel),
    ),
  );

  // ---- drawing what the LMS saw, a few times a second at most
  let timer = 0;
  const schedule = () => {
    if (!timer) timer = window.setTimeout(() => ((timer = 0), render()), 250);
  };
  session.onChange = () => {
    schedule();
    watch();
  };

  function render(): void {
    holds.replaceChildren(...session.holds().flatMap((r) => [h("dt", {}, r.label), h("dd", {}, r.value)]));
    const list = session.findings();
    found.replaceChildren(
      ...(list.length
        ? SEVERITY_ORDER.filter((s) => list.some((f) => f.severity === s)).map((s) => {
            const these = list.filter((f) => f.severity === s);
            return h("div", { class: "group" }, h("h3", {}, badge(s), ` ${SEVERITY_WORDS[s]}s (${these.length})`), h("ul", { class: "findings", role: "list" }, ...these.map((f) => findingItem(f))));
          })
        : [h("p", {}, "Nothing so far. Findings appear here as the course runs, and when it is closed.")]),
    );
    if (session.standard === "xapi" || session.standard === "cmi5") {
      const all = session.statements();
      statements.replaceChildren(
        h("h2", {}, `Statements kept (${all.length})`),
        all.length
          ? h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                {},
                h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Verb"), h("th", { scope: "col" }, "Object"), h("th", { scope: "col" }, "Result"))),
                h("tbody", {}, ...all.slice(-100).map((s) => statementRow(s))),
              ),
            )
          : h("p", {}, "None yet."),
      );
    }
    if (session.log.length !== rendered) {
      const atEnd = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
      const shown = session.log.slice(-LOG_SHOWN);
      log.replaceChildren(...shown.map((e) => logItem(e)));
      logNote.textContent = session.log.length > LOG_SHOWN ? `The last ${LOG_SHOWN} of ${session.log.length} entries. Copy log has them all.` : `${session.log.length} entr${session.log.length === 1 ? "y" : "ies"}.`;
      rendered = session.log.length;
      if (atEnd) logBox.scrollTop = logBox.scrollHeight;
    }
  }

  /** Says the moments that matter, and follows a SCORM 2004 course's request to go on to another part. */
  function watch(): void {
    for (const e of session.log.slice(announced)) {
      if (e.kind === "call" && !e.refused && /^(LMS)?Initialize\(/.test(e.text)) host.say("The course started talking to the LMS.");
      if (e.kind === "call" && !e.refused && /^(LMSFinish|Terminate)\(/.test(e.text)) host.say("The course told the LMS it is finished." + (e.note ? ` ${e.note}` : ""));
      if (e.refused && e.kind === "call" && !refusalSaid) {
        // Said once: a course that keeps sending a refused value would otherwise drown everything else.
        refusalSaid = true;
        host.say(`The LMS refused a call: ${e.text}. The log and the findings say why.`);
      }
    }
    announced = session.log.length;
    const launch = session.current;
    if (!launch || launch.number === handledNav) return;
    const next = session.next();
    if (!next) return;
    handledNav = launch.number;
    window.setTimeout(() => {
      if (next.index !== undefined) {
        host.say(`The course asked to ${next.request}. Opening "${session.playable[next.index]!.title}".`);
        void start(next.index);
      } else void leave(`The course asked the LMS to ${next.request}. An LMS would close it here.`);
    }, 0);
  }

  // ---- launching and leaving
  /** Empties the frame, so the course says goodbye, and waits until it has. */
  function empty(): Promise<void> {
    return new Promise((resolve) => {
      if (!frame.src || frame.src === "about:blank") {
        session.end();
        resolve();
        return;
      }
      // A moment after the page has gone, so the last requests it sent as it closed (xAPI's terminated, often) are in.
      frame.addEventListener("load", () => window.setTimeout(() => {
        session.end();
        resolve();
      }, 400), { once: true });
      frame.src = "about:blank";
    });
  }

  async function start(index: number): Promise<void> {
    await empty();
    part = index;
    partSelect.value = String(index);
    session.mode = modeSelect.value as Mode;
    const url = session.launch(index);
    delete w.API;
    delete w.API_1484_11;
    if (session.api) w.API = session.api;
    if (session.api2004) w.API_1484_11 = session.api2004;
    const p = session.playable[index]!;
    frame.title = `Course: ${p.title}`;
    closed.hidden = true;
    frame.hidden = false;
    frame.src = url;
    render();
  }

  async function leave(message: string): Promise<void> {
    await empty();
    frame.hidden = true;
    const again = h("button", { type: "button", class: "button button--primary" }, "Launch it again");
    again.addEventListener("click", () => void start(part));
    closed.replaceChildren(h("p", {}, message), again);
    closed.hidden = false;
    render();
    host.say(message);
  }

  backButton.addEventListener("click", async () => {
    await empty();
    delete w.API;
    delete w.API_1484_11;
    session.onChange = () => {};
    active = undefined;
    host.back();
  });
  relaunchButton.addEventListener("click", () => {
    void start(part).then(() => host.say(`Relaunched. The course was closed and opened again, as when a learner comes back.`));
  });
  resetButton.addEventListener("click", async () => {
    await empty();
    session.resetLearner();
    await start(part);
    host.say("The learner's record is empty, and the course was opened again as a first launch.");
  });
  copyButton.addEventListener("click", async () => {
    await copyText(session.logText());
    host.say("The log is copied. Paste it into an email or a document.");
  });
  partSelect.addEventListener("change", () => void start(Number(partSelect.value)).then(() => host.say(`Opened part ${Number(partSelect.value) + 1}.`)));
  modeSelect.addEventListener("change", () => void start(part).then(() => host.say(`Relaunched in ${modeSelect.value} mode.`)));

  await start(part);
  title.focus();
  host.say(`Playing "${session.playable[part]!.title}" in the test player. The log is beside the course.`);
}

function logItem(e: PlaySession["log"][number]): HTMLElement {
  const time = `${(e.at / 1000).toFixed(1)} s`;
  return h(
    "li",
    { class: `log-entry log-entry--${e.kind}${e.refused ? " log-entry--refused" : ""}` },
    h("span", { class: "log-time" }, time),
    h("span", { class: "log-text" }, h("code", {}, e.text), e.answer !== undefined ? h("span", { class: "muted" }, ` → ${e.answer}`) : null),
    e.refused ? h("span", { class: "log-why" }, h("strong", {}, "Refused: "), e.refused) : null,
    e.note ? h("span", { class: "log-why" }, h("strong", {}, "The LMS: "), e.note) : null,
  );
}

function statementRow(s: Record<string, unknown>): HTMLElement {
  const verb = s["verb"] as { id?: string; display?: Record<string, string> } | undefined;
  const object = s["object"] as { id?: string; definition?: { name?: Record<string, string> } } | undefined;
  const name = object?.definition?.name ? Object.values(object.definition.name)[0] : undefined;
  const result = s["result"] as Record<string, unknown> | undefined;
  const words = result
    ? Object.entries(result)
        .filter(([k]) => k !== "extensions")
        .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ")
    : "";
  return h("tr", {}, h("td", {}, String(verb?.id ?? "").split(/[/#]/).filter(Boolean).pop() ?? ""), h("td", {}, name ?? String(object?.id ?? "")), h("td", {}, words));
}
