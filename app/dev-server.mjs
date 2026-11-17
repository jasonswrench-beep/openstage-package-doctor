// Serves web/ on this computer only, to try the window in a browser without building the program.
// node dev-server.mjs [port]   (run `node build.mjs` first, or `npm run preview`, which does both)
// Packages to try go in the repository's samples/ folder (never committed) and are served at /_samples/. They are kept
// out of web/ because everything in web/ is built into the program.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./web/", import.meta.url));
const samples = fileURLToPath(new URL("../samples/", import.meta.url));
const port = Number(process.argv[2] ?? 5185);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
  const [base, rest] = path.startsWith("_samples") ? [samples, path.slice("_samples".length)] : [root, path || "index.html"];
  const file = join(base, rest);
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Package Doctor preview: http://127.0.0.1:${port}/`));
