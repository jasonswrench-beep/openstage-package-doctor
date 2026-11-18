import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { openPackageSession } from "../src/open.ts";
import { PlaySession } from "../src/play/session.ts";
import { titleFromName, wrapPackage, type WrapInput } from "../src/wrap/wrap.ts";
import type { WrapStandard } from "../src/wrap/manifests.ts";

const enc = new TextEncoder();
const ORIGIN = "http://tauri.localhost";
const PDF = enc.encode("%PDF-1.4\n% a tiny stand-in document\n");
const MP4 = new Uint8Array(4096);
const STANDARDS: WrapStandard[] = ["scorm12", "scorm2004", "cmi5", "xapi"];

function wrap(over: Partial<WrapInput> = {}) {
  const input: WrapInput = { kind: "pdf", title: "Fire safety guide", language: "en", standard: "scorm12", complete: "button", files: new Map([["Fire safety guide.pdf", PDF]]), main: "Fire safety guide.pdf", ...over };
  const w = wrapPackage(input);
  return { w, ...openPackageSession(w.bytes, "wrapped.zip") };
}

test("a wrapped PDF opens as a sound package in each of the four standards", () => {
  const kinds: Record<WrapStandard, string> = { scorm12: "scorm12", scorm2004: "scorm2004", cmi5: "cmi5", xapi: "xapi" };
  for (const standard of STANDARDS) {
    const { report } = wrap({ standard });
    assert.equal(report.kind, kinds[standard], standard);
    assert.equal(report.title, "Fire safety guide");
    assert.equal(report.launches[0]!.file, "index.html");
    assert.deepEqual(report.findings.filter((f) => f.severity !== "note").map((f) => f.id), [], `${standard}: ${JSON.stringify(report.findings)}`);
  }
});

test("the start page is plain and accessible: language, title, main, the document's link, a real button", () => {
  const { archive } = wrap({ language: "fr-CA" });
  const page = new TextDecoder().decode(archive!.read(archive!.entries.find((e) => e.path === "index.html")!));
  assert.match(page, /<html lang="fr-CA">/);
  assert.match(page, /<title>Fire safety guide<\/title>/);
  assert.match(page, /<main>/);
  assert.match(page, /<iframe src="Fire%20safety%20guide\.pdf" title="Fire safety guide \(the document\)">/);
  assert.match(page, /<a href="Fire%20safety%20guide\.pdf"[^>]*>open the document on its own<\/a>/);
  assert.match(page, /<button type="button" id="openstage-finish">I have finished<\/button>/);
  assert.match(page, /<p id="openstage-status" role="status"><\/p>/);
});

test("a video gets its captions as a track; a folder goes into site/ untouched", () => {
  const video = wrap({ kind: "video", files: new Map([["talk.mp4", MP4], ["talk.en.vtt", enc.encode("WEBVTT\n")]]), main: "talk.mp4", captions: { path: "talk.en.vtt", language: "en", label: "English" }, complete: "end" });
  const page = new TextDecoder().decode(video.archive!.read(video.archive!.entries.find((e) => e.path === "index.html")!));
  assert.match(page, /<source src="talk\.mp4" type="video\/mp4">/);
  assert.match(page, /<track kind="captions" src="talk\.en\.vtt" srclang="en" label="English" default>/);
  assert.doesNotMatch(page, /openstage-finish/);
  const site = wrap({ kind: "site", files: new Map([["index.html", enc.encode("<p>Their own page</p>")], ["img/a.png", enc.encode("png")]]), main: "index.html" });
  assert.deepEqual(site.w.files.sort(), ["imsmanifest.xml", "index.html", "openstage-tracking.js", "site/img/a.png", "site/index.html"]);
  assert.equal(new TextDecoder().decode(site.archive!.read(site.archive!.entries.find((e) => e.path === "site/index.html")!)), "<p>Their own page</p>");
  assert.equal(titleFromName("folder/fire_safety-guide v2.pdf"), "Fire safety guide v2");
  assert.throws(() => wrap({ files: new Map([["index.html", PDF]]), main: "index.html" }), /needs for itself/);
});

/** WCAG's contrast ratio between two colours written #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("a video page's own words (shown where the video cannot play) are readable on the video's black", () => {
  const video = wrap({ kind: "video", files: new Map([["talk.mp4", MP4]]), main: "talk.mp4", complete: "end" });
  const page = new TextDecoder().decode(video.archive!.read(video.archive!.entries.find((e) => e.path === "index.html")!));
  const rule = (selector: string) => new RegExp(`^\\s*${selector} \\{([^}]*)\\}`, "m").exec(page)?.[1] ?? "";
  const back = /background: (#[0-9a-f]{6})/.exec(rule("video"))?.[1];
  const words = /(?:^|;)\s*color: (#[0-9a-f]{6})/.exec(rule("video"))?.[1];
  const link = /color: (#[0-9a-f]{6})/.exec(rule("video a"))?.[1];
  assert.ok(back && words && link, "the video and its link have colours of their own");
  assert.ok(contrast(words, back) >= 4.5, `words ${contrast(words, back).toFixed(1)}:1`);
  assert.ok(contrast(link, back) >= 4.5, `link ${contrast(link, back).toFixed(1)}:1`);
});

/** Runs the wrapped package's tracking script against the test player's stand-in LMS or LRS, as a browser would. */
async function play(standard: WrapStandard, complete: WrapInput["complete"], act: (page: { click(): void; leave(): void; media: { currentTime: number; duration: number; fire(e: string): void } }) => void, kind: WrapInput["kind"] = "pdf") {
  const files = kind === "video" ? new Map([["talk.mp4", MP4]]) : new Map([["guide.pdf", PDF]]);
  const { w } = wrap({ standard, complete, kind, files, main: kind === "video" ? "talk.mp4" : "guide.pdf" });
  const { report, archive } = openPackageSession(w.bytes, "wrapped.zip");
  const session = new PlaySession(report, archive!, ORIGIN, { id: "w1" });
  const url = session.launch(0);
  const script = new TextDecoder().decode(archive!.read(archive!.entries.find((e) => e.path === "openstage-tracking.js")!));
  const listeners: Record<string, (() => void)[]> = {};
  const on = (store: Record<string, (() => void)[]>) => (type: string, f: () => void) => void (store[type] ??= []).push(f);
  const buttonListeners: Record<string, (() => void)[]> = {};
  const mediaListeners: Record<string, (() => void)[]> = {};
  const button = { disabled: false, addEventListener: on(buttonListeners) };
  const media = { currentTime: 0, duration: 120, addEventListener: on(mediaListeners), fire: (e: string) => (mediaListeners[e] ?? []).forEach((f) => f()) };
  const win: Record<string, unknown> = {
    location: new URL(url),
    addEventListener: on(listeners),
    crypto: globalThis.crypto,
    fetch: async (u: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
      const r = session.handle({ method: init.method ?? "GET", url: new URL(u, url).href, headers: init.headers ?? {}, body: init.body ?? "" });
      return new Response(r.status === 204 ? null : (r.body as BodyInit), { status: r.status, headers: r.headers });
    },
    URLSearchParams,
    setTimeout,
    console,
    document: { getElementById: (id: string) => (id === "openstage-finish" && complete === "button" ? button : null), querySelector: () => (kind === "video" ? media : null) },
  };
  win.window = win;
  win.parent = win;
  if (session.api) win.API = session.api;
  if (session.api2004) win.API_1484_11 = session.api2004;
  vm.runInNewContext(script, win);
  await (win.OpenStageTracking as { ready: Promise<void> }).ready;
  act({ click: () => (buttonListeners.click ?? []).forEach((f) => f()), leave: () => (listeners.pagehide ?? []).forEach((f) => f()), media });
  await new Promise((r) => setTimeout(r, 30));
  session.end();
  return session;
}

for (const standard of STANDARDS) {
  test(`the tracking script keeps every rule of the strict stand-in for ${standard}: started, finished, left`, async () => {
    const session = await play(standard, "button", (p) => p.click());
    assert.deepEqual(session.findings().map((f) => `${f.id}: ${f.detail}`), []);
    const holds = Object.fromEntries(session.holds().map((h) => [h.label, h.value]));
    if (standard === "scorm12") assert.equal(holds["Status"], "completed");
    if (standard === "scorm2004") assert.equal(holds["Completion"], "completed");
    if (standard === "cmi5") assert.equal(holds["To move on"], "Completed: met");
    if (standard === "xapi") assert.equal(holds["Verbs"], "initialized, completed, terminated");
  });
}

test("done when opened: completed at once, and the session time and exit are sent on leaving", async () => {
  const session = await play("scorm12", "open", (p) => p.leave());
  assert.deepEqual(session.findings(), []);
  const holds = Object.fromEntries(session.holds().map((h) => [h.label, h.value]));
  assert.equal(holds["Status"], "completed");
  assert.match(holds["Time this session"]!, /^0000:00:00\.\d\d$/);
});

test("a video counts as done when watched nearly to the end, and its place is kept for next time", async () => {
  const left = await play("scorm2004", "end", (p) => {
    p.media.currentTime = 40;
    p.media.fire("pause");
    p.leave();
  }, "video");
  let holds = Object.fromEntries(left.holds().map((h) => [h.label, h.value]));
  assert.equal(holds["Completion"], "incomplete");
  assert.equal(holds["Location"], "40");
  assert.equal(holds["Exit"], "suspend");
  const watched = await play("scorm2004", "end", (p) => {
    p.media.currentTime = 115;
    p.media.fire("timeupdate");
    p.leave();
  }, "video");
  holds = Object.fromEntries(watched.holds().map((h) => [h.label, h.value]));
  assert.equal(holds["Completion"], "completed");
  assert.deepEqual(watched.findings(), []);
});
