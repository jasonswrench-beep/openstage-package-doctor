// Every pairing of Package Doctor's own colours is measured here, as the suite's design guide asks: words 4.5:1,
// the edges of controls 3:1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8") + readFileSync(new URL("./openstage-ui.css", import.meta.url), "utf8");
const value = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  assert.ok(m, `--${name} is not set`);
  return m[1]!;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test("the product colours pass their contrast", () => {
  const pairs: [string, string, number][] = [
    ["#ffffff", value("pd-action"), 4.5], // white words on a filled button
    ["#ffffff", value("pd-action-hover"), 4.5],
    [value("pd-action-text"), "#ffffff", 4.5], // links and green words on white
    [value("pd-action-text"), value("os-page"), 4.5], // ... and on the page grey
    [value("pd-action-text"), value("pd-tint"), 4.5], // a tag's words on its tint
    [value("pd-on-shell"), value("os-shell"), 4.5], // the name on the navy bar
    [value("pd-logo"), value("os-shell"), 3],
    // The accessibility statuses' words on their tints (each is also a word and a symbol).
    [value("os-danger"), value("os-danger-tint"), 4.5],
    [value("os-warning"), value("os-warning-tint"), 4.5],
    [value("os-success"), value("os-success-tint"), 4.5],
    [value("os-muted"), value("os-subtle"), 4.5],
  ];
  for (const [fg, bg, min] of pairs) assert.ok(ratio(fg, bg) >= min, `${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1, under ${min}:1`);
});
