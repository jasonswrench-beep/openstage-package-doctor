// Bundles the window's web side into web/: the script (with ../core inside it) and one style sheet, the suite's
// shared look first (src/openstage-ui.css, a copy of the master in the OpenStage Author repository) and then this
// program's own styles.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "web/main.js",
  logLevel: "warning",
});
const suite = readFileSync("src/openstage-ui.css", "utf-8");
const app = readFileSync("src/app.css", "utf-8");
writeFileSync("web/style.css", `${suite}\n\n/* ---- OpenStage Package Doctor ---- */\n${app}`);
console.log("Built web/main.js and web/style.css");
