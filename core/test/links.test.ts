import { test } from "node:test";
import assert from "node:assert/strict";
import { cssRefs, htmlRefs } from "../src/links.ts";
import { ids, open, PAGE, scorm12 } from "./helpers.ts";

const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const pkg = (files: Record<string, string>) => open({ "imsmanifest.xml": scorm12(), ...files });
const one = (files: Record<string, string>, id: string) => pkg(files).findings.find((f) => f.id === id);

test("links are read from tags, srcset, style attributes, style blocks and style sheets", () => {
  const { refs } = htmlRefs(`<img src="a.png" srcset="b.png 1x, c.png 2x"><div style="background:url('d.png')"></div>
<style>@import "e.css"; .x { background: url(f.png) }</style><a href="g.html#top">g</a><link rel="stylesheet" href="h.css">
<link rel="canonical" href="https://example.org/"><video poster="i.jpg"><source src="j.mp4"><track src="k.vtt"></video>`);
  assert.deepEqual(refs.map((r) => r.ref).sort(), ["a.png", "b.png", "c.png", "d.png", "e.css", "f.png", "g.html#top", "h.css", "i.jpg", "j.mp4", "k.vtt"]);
  assert.deepEqual(cssRefs(`/* url(no.png) */\n.a{background:url("yes.png")}`).map((r) => [r.ref, r.line]), [["yes.png", 2]]);
});

test("comments and script bodies are not read; a script's own src is", () => {
  const { refs } = htmlRefs(`<!-- <img src="old.png"> --><script src="app.js">var s = '<img src="x.png">';</script>`);
  assert.deepEqual(refs.map((r) => r.ref), ["app.js"]);
});

test("a missing script, style sheet or page is a problem; a missing picture is a warning", () => {
  const r = pkg({ "index.html": page(`<script src="js/app.js"></script><img src="images/logo.png" alt="">`, `<link rel="stylesheet" href="style.css">`) });
  const broken = r.findings.filter((f) => f.id === "link-broken");
  assert.deepEqual(broken.map((f) => [f.severity, f.detail.split(" ")[0]]).sort(), [["problem", "js/app.js"], ["problem", "style.css"], ["warning", "images/logo.png"]]);
  assert.equal(broken.find((f) => f.severity === "problem")!.file, "index.html");
});

test("the same missing file linked from many places is one finding", () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 5; i++) files[`p${i}.html`] = page(`<img src="shared/logo.png">`);
  const r = pkg({ "index.html": PAGE, ...files });
  const broken = r.findings.filter((f) => f.id === "link-broken");
  assert.equal(broken.length, 1);
  assert.match(broken[0]!.detail, /linked from p1\.html line 1, p2\.html line 1, p3\.html line 1 and 2 more places/);
});

test("many missing files linked from one file only become one finding about that file", () => {
  const css = ["a", "b", "c", "d", "e", "f"].map((n) => `.${n} { background: url(img/${n}.png) }`).join("\n");
  const r = pkg({ "index.html": PAGE, "site.css": css, "other.css": ".x { background: url(img/solo.png) }" });
  const broken = r.findings.filter((f) => f.id === "link-broken");
  assert.equal(broken.length, 2);
  assert.match(broken.find((f) => f.file === "site.css")!.detail, /^site\.css links to 6 files that are not in the package: img\/a\.png, img\/b\.png, img\/c\.png, img\/d\.png, img\/e\.png, and 1 more\.$/);
  assert.equal(broken.find((f) => f.file === "site.css")!.severity, "warning");
  assert.match(broken.find((f) => f.file === "other.css")!.detail, /^img\/solo\.png is missing/);
});

test("links in a style sheet are resolved from the style sheet's folder", () => {
  const r = pkg({ "index.html": PAGE, "css/site.css": `.a { background: url(../img/bg.png) } .b { background: url(img/none.png) }`, "img/bg.png": "x" });
  const broken = r.findings.filter((f) => f.id === "link-broken");
  assert.equal(broken.length, 1);
  assert.match(broken[0]!.detail, /^css\/img\/none\.png is missing/);
});

test("capitals, ../ above the top, a leading /, a file on someone's computer, backslashes", () => {
  assert.equal(one({ "index.html": page(`<script src="App.js"></script>`), "app.js": "1" }, "link-case")!.severity, "problem");
  assert.equal(one({ "index.html": page(`<img src="Logo.PNG">`), "logo.png": "x" }, "link-case")!.severity, "warning");
  assert.ok(one({ "index.html": page(`<img src="../../shared/logo.png">`) }, "link-outside"));
  assert.ok(one({ "index.html": page(`<script src="/lib/app.js"></script>`) }, "link-root"));
  assert.ok(one({ "index.html": page(`<img src="file:///C:/Users/me/pic.png">`) }, "link-local-disk"));
  assert.ok(one({ "index.html": page(`<img src="C:\\Users\\me\\pic.png">`) }, "link-local-disk"));
  const back = pkg({ "index.html": page(`<img src="images\\logo.png">`), "images/logo.png": "x" });
  assert.ok(ids(back, "warning").includes("link-backslash"));
  assert.ok(!ids(back).includes("link-broken"));
});

test("http: a loaded file is a warning, a link to follow is not", () => {
  const r = pkg({ "index.html": page(`<script src="http://cdn.example.org/lib.js"></script><a href="http://example.org/">site</a><img src="https://example.org/a.png">`) });
  const insecure = r.findings.filter((f) => f.id === "link-insecure");
  assert.equal(insecure.length, 1);
  assert.match(insecure[0]!.detail, /^http:\/\/cdn\.example\.org\/lib\.js/);
});

test("what is not a file is left alone: web addresses, data, fragments, mail, scripts and template placeholders", () => {
  const r = pkg({
    "index.html": page(`<a href="#top">t</a><a href="mailto:a@b.org">m</a><a href="javascript:void(0)">j</a><img src="data:image/png;base64,AAAA">
      <img src="{{logo}}"><img src="\${base}/x.png"><a href="https://example.org/">x</a><img src="//cdn.example.org/a.png"><a href="./">here</a>`),
  });
  assert.deepEqual(r.findings.filter((f) => f.id.startsWith("link-")).map((f) => f.id), []);
});

test("percent-encoded names and query strings resolve to the file", () => {
  const r = pkg({ "index.html": page(`<img src="my%20picture.png?v=2"><script src="app.js#x"></script>`), "my picture.png": "x", "app.js": "1" });
  assert.deepEqual(r.findings.filter((f) => f.id.startsWith("link-")).map((f) => f.id), []);
});

test("scripts are counted in a note, since the links they build are not checked", () => {
  const r = pkg({ "index.html": page(`<script src="app.js"></script>`), "app.js": "1" });
  const f = r.findings.find((x) => x.id === "links-scripted")!;
  assert.equal(f.severity, "note");
  assert.match(f.detail, /1 script file\. Links were read in 1 page and 0 style sheets\./);
});
