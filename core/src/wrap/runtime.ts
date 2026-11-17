// The small tracking script inside a wrapped package (openstage-tracking.js). It tells the LMS the learner started, when
// the package counts as done, and that the learner left: through the SCORM 1.2 or SCORM 2004 API, or as xAPI statements
// (and for cmi5, with the token, the launch data and the rules cmi5 adds). It is plain JavaScript with no dependencies,
// for any browser an LMS supports.
//
// When it counts as done is chosen when wrapping: "open" (as soon as it opens), "button" (when the learner presses the
// page's I have finished button) or "end" (when a video has been watched to the end, or nearly). A video's place is
// kept, so a learner who comes back carries on where they stopped (SCORM only; an LMS keeps it for them).
//
// The tests run this script against the test player's stand-in LMS and LRS (test/wrap.test.ts), which are as strict
// as the standards.

export interface RuntimeConfig {
  standard: "scorm12" | "scorm2004" | "cmi5" | "xapi";
  complete: "open" | "button" | "end";
  title: string;
  language: string;
  /** For xAPI: the activity id, used when the LMS's launch address gives none. */
  courseId: string;
}

export function runtimeScript(config: RuntimeConfig): string {
  return `// Tracking for a package wrapped by OpenStage Package Doctor. It reports to the LMS when the learner starts,
// finishes and leaves. Standard: ${config.standard}; done when: ${config.complete}.
(function () {
  "use strict";
  var CONFIG = ${JSON.stringify(config)};
  var started = Date.now();
  var done = false;
  var ended = false;
  var resumeAt = 0;
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  function say(text) {
    var el = document.getElementById("openstage-status");
    if (el) el.textContent = text;
  }

  function findApi(name) {
    var seen = 0;
    function search(w) {
      while (w && seen < 20) {
        seen++;
        try { if (w[name]) return w[name]; } catch (e) { return null; }
        if (!w.parent || w.parent === w) return null;
        w = w.parent;
      }
      return null;
    }
    var api = search(window);
    if (!api) { try { if (window.opener) api = search(window.opener); } catch (e) { api = null; } }
    return api;
  }

  function seconds() { return (Date.now() - started) / 1000; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  function timespan12(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60;
    return pad(Math.min(h, 9999), 4) + ":" + pad(m, 2) + ":" + pad(Math.floor(r), 2) + "." + pad(Math.floor((r % 1) * 100), 2);
  }
  function duration(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round((s - h * 3600 - m * 60) * 100) / 100;
    return "PT" + (h ? h + "H" : "") + (m ? m + "M" : "") + r + "S";
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  // ---- SCORM 1.2 and 2004

  function scorm(is2004) {
    var api = findApi(is2004 ? "API_1484_11" : "API");
    if (!api) return null;
    var call = function (a, b, c) { return is2004 ? api[a](b, c) : api["LMS" + a](b, c); };
    var get = function (el) { return is2004 ? api.GetValue(el) : api.LMSGetValue(el); };
    var set = function (el, v) { return is2004 ? api.SetValue(el, v) : api.LMSSetValue(el, v); };
    if (String(call("Initialize", "")) !== "true") return null;
    var status = get(is2004 ? "cmi.completion_status" : "cmi.core.lesson_status");
    var mode = get(is2004 ? "cmi.mode" : "cmi.core.lesson_mode");
    var counts = mode === "normal" || mode === "";
    if (status === "completed" || status === "passed") done = true;
    else if (counts) set(is2004 ? "cmi.completion_status" : "cmi.core.lesson_status", "incomplete");
    // The place is read only when the LMS says the learner is coming back: before anything is saved there, reading it
    // is an error in SCORM 2004.
    if (get(is2004 ? "cmi.entry" : "cmi.core.entry") === "resume") {
      var place = Number(get(is2004 ? "cmi.location" : "cmi.core.lesson_location"));
      if (place > 0) resumeAt = place;
    }
    call("Commit", "");
    return {
      complete: function () {
        if (done || !counts) return;
        done = true;
        set(is2004 ? "cmi.completion_status" : "cmi.core.lesson_status", "completed");
        call("Commit", "");
      },
      place: function (s) {
        if (counts) set(is2004 ? "cmi.location" : "cmi.core.lesson_location", String(Math.floor(s)));
      },
      finish: function () {
        if (counts) {
          set(is2004 ? "cmi.session_time" : "cmi.core.session_time", is2004 ? duration(seconds()) : timespan12(seconds()));
          set(is2004 ? "cmi.exit" : "cmi.core.exit", done ? (is2004 ? "normal" : "") : "suspend");
        }
        call("Commit", "");
        call(is2004 ? "Terminate" : "Finish", "");
      }
    };
  }

  // ---- xAPI and cmi5

  var CMI5 = "https://w3id.org/xapi/cmi5/context/categories/cmi5";
  var MOVEON = "https://w3id.org/xapi/cmi5/context/categories/moveon";
  var VERB = "http://adlnet.gov/expapi/verbs/";

  function xapi(isCmi5) {
    var q = new URLSearchParams(window.location.search);
    var endpoint = q.get("endpoint");
    var actorText = q.get("actor");
    if (!endpoint || !actorText) return null;
    if (endpoint.charAt(endpoint.length - 1) !== "/") endpoint += "/";
    var actor;
    try { actor = JSON.parse(actorText); } catch (e) { return null; }
    var registration = q.get("registration") || undefined;
    var activityId = q.get(isCmi5 ? "activityId" : "activity_id") || CONFIG.courseId;
    var auth = q.get("auth") || "";
    var context = { contextActivities: {}, extensions: {} };
    var launchMode = "Normal";
    var returnURL = null;
    var chain = Promise.resolve();
    var headers = function (json) {
      var h = { "Authorization": auth, "X-Experience-API-Version": "1.0.3" };
      if (json) h["Content-Type"] = "application/json";
      return h;
    };
    var send = function (verb, result, keepalive) {
      var ctx = JSON.parse(JSON.stringify(context));
      if (registration) ctx.registration = registration;
      if (isCmi5) {
        ctx.contextActivities.category = (ctx.contextActivities.category || []).concat([{ id: CMI5 }]);
        if (verb === "completed") ctx.contextActivities.category.push({ id: MOVEON });
      }
      var statement = {
        id: uuid(),
        actor: actor,
        verb: { id: VERB + verb, display: { "en-US": verb } },
        object: { objectType: "Activity", id: activityId, definition: { name: (function () { var n = {}; n[CONFIG.language] = CONFIG.title; return n; })(), type: "http://adlnet.gov/expapi/activities/" + (isCmi5 ? "lesson" : "course") } },
        context: ctx,
        timestamp: new Date().toISOString()
      };
      if (result) statement.result = result;
      chain = chain.then(function () {
        return fetch(endpoint + "statements", { method: "POST", headers: headers(true), body: JSON.stringify(statement), keepalive: !!keepalive });
      }).catch(function () { say("A record could not be sent to the LMS."); });
      return chain;
    };
    var start = Promise.resolve();
    if (isCmi5) {
      var fetchUrl = q.get("fetch");
      start = fetch(fetchUrl, { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j["auth-token"]) throw new Error(j["error-text"] || "no token");
          auth = "Basic " + j["auth-token"];
          var u = endpoint + "activities/state?stateId=LMS.LaunchData&activityId=" + encodeURIComponent(activityId) +
            "&agent=" + encodeURIComponent(actorText) + (registration ? "&registration=" + encodeURIComponent(registration) : "");
          return fetch(u, { headers: headers(false) });
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          context = data.contextTemplate || context;
          context.contextActivities = context.contextActivities || {};
          context.extensions = context.extensions || {};
          launchMode = data.launchMode || "Normal";
          returnURL = data.returnURL || null;
        });
    }
    var ok = start.then(function () { return send("initialized"); });
    return {
      ready: ok,
      complete: function () {
        if (done || launchMode !== "Normal") return;
        done = true;
        ok.then(function () { send("completed", { completion: true, duration: duration(seconds()) }); });
      },
      place: function () {},
      finish: function (leaving) {
        var p = ok.then(function () { return send("terminated", { duration: duration(seconds()) }, true); });
        if (isCmi5 && !leaving) p.then(function () { if (returnURL) window.location.href = returnURL; });
        return p;
      }
    };
  }

  // ---- the page

  var tracker = CONFIG.standard === "scorm12" ? scorm(false) : CONFIG.standard === "scorm2004" ? scorm(true) : xapi(CONFIG.standard === "cmi5");
  if (!tracker) {
    say("This page is not connected to an LMS, so nothing is recorded. That is expected when it is opened on its own.");
    readyResolve();
    window.OpenStageTracking = { ready: ready, complete: function () {}, finish: function () {} };
    return;
  }

  function finish(leaving) {
    if (ended) return;
    ended = true;
    return tracker.finish(leaving);
  }

  Promise.resolve(tracker.ready).then(function () {
    if (CONFIG.complete === "open") tracker.complete();
    readyResolve();
  }, function () {
    say("The LMS did not answer, so this visit may not be recorded.");
    readyResolve();
  });

  var media = document.querySelector && document.querySelector("video, audio");
  if (media && CONFIG.complete === "end") {
    var nearly = function () { return media.duration && media.currentTime >= media.duration * 0.95; };
    media.addEventListener("ended", function () { tracker.complete(); });
    media.addEventListener("timeupdate", function () { if (nearly()) tracker.complete(); });
  }
  if (media) {
    var last = 0;
    media.addEventListener("timeupdate", function () {
      if (Math.abs(media.currentTime - last) >= 10) { last = media.currentTime; tracker.place(media.currentTime); }
    });
    media.addEventListener("pause", function () { tracker.place(media.currentTime); });
    media.addEventListener("loadedmetadata", function () {
      if (resumeAt > 0 && resumeAt < media.duration - 5) media.currentTime = resumeAt;
    });
  }

  var button = document.getElementById && document.getElementById("openstage-finish");
  if (button) {
    button.addEventListener("click", function () {
      tracker.complete();
      button.disabled = true;
      say("Recorded as finished. You can close this window.");
      finish(false);
    });
  }

  window.addEventListener("pagehide", function () { finish(true); });
  window.addEventListener("beforeunload", function () { finish(true); });
  window.OpenStageTracking = { ready: ready, complete: function () { tracker.complete(); }, finish: finish };
})();
`;
}
