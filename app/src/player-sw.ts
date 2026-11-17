// The test player's service worker. It answers the requests a course's pages make under /play/: their files, and for
// xAPI and cmi5 the stand-in LRS. It holds nothing itself. Each request is handed to the Package Doctor window over a
// BroadcastChannel, and the window answers from the zip it has open (core/src/play/session.ts). That keeps the course
// on the window's own site, as SCORM needs: the course finds the LMS's API object in the window above it.
// Its scope is /play/, so it never touches the window's own files. Requests a course makes outside the package (another
// website, or the top of this one) go ahead as usual and the window is told, so the log can say so.
// Built to web/player-sw.js by build.mjs.

/* eslint-disable @typescript-eslint/no-explicit-any */
const sw = globalThis as any;

const channel = new BroadcastChannel("package-doctor-play");
const waiting = new Map<number, (answer: { status: number; headers: Record<string, string>; body: ArrayBuffer | string | null }) => void>();
let next = 1;

channel.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m?.type !== "response") return;
  const resolve = waiting.get(m.rid);
  if (resolve) {
    waiting.delete(m.rid);
    resolve(m);
  }
};

sw.addEventListener("install", () => sw.skipWaiting());
sw.addEventListener("activate", (e: any) => e.waitUntil(sw.clients.claim()));

sw.addEventListener("fetch", (event: any) => {
  const request: Request = event.request;
  const url = new URL(request.url);
  if (url.origin === sw.location.origin && url.pathname.startsWith("/play/")) {
    event.respondWith(relay(request));
    return;
  }
  // Not the package's: let it go, and tell the window a course asked for it.
  channel.postMessage({ type: "outside", url: request.url });
});

async function relay(request: Request): Promise<Response> {
  const rid = next++;
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  const answer = await new Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer | string | null }>((resolve) => {
    waiting.set(rid, resolve);
    channel.postMessage({ type: "request", rid, url: request.url, method: request.method, headers, body });
    setTimeout(() => {
      if (!waiting.has(rid)) return;
      waiting.delete(rid);
      resolve({ status: 503, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Package Doctor's window did not answer. Open the package again." });
    }, 30000);
  });
  const empty = answer.status === 204 || answer.status === 304 || request.method === "HEAD";
  return new Response(empty ? null : answer.body, { status: answer.status, headers: answer.headers });
}
