// SPDX-License-Identifier: Apache-2.0
// Makes the OpenStage Package Doctor installer for a release, on this PC. Adapted from OpenExplainer's tools/build-installer.mjs.
//
//   node tools/build-installer.mjs            build the setup file (not signed), for checking
//   node tools/build-installer.mjs --sign     build it from the release's tagged commit, and sign every program in it and the setup itself
//
// What it does, in order:
//   1. reads the version (app/src-tauri/tauri.conf.json) and checks that Cargo.toml and both package.json files say the same. With --sign it
//      stops unless the tree is clean (nothing to commit, nothing untracked) and the commit checked out is the one tagged v<version>, so the
//      release tag points at the exact commit the build came from (CLAUDE.md, Commits and releases);
//   2. builds the program and its installer with Tauri. Rust is given --remap-path-prefix for the user folder, Rust's own folders and this
//      repository, and the linker is told to name the debug file without its folder, so no folder name of the building computer is written in;
//   3. checks Tauri's installer script (the web view's setup is carried inside the installer, never downloaded while installing), unpacks the
//      setup with 7-Zip and checks every program in it: none may name this computer's user folder, and with --sign every one, and the setup,
//      must be signed and timestamped by the publisher (OPENSTAGE_SIGN_PUBLISHER when it is set), except the web view's setup, which keeps its
//      maker's signature. Signing is done by Tauri's sign command with tools/sign_windows.py (the suite's shared copy; its top says which
//      settings it needs; they come from the environment and are never written into the repository);
//   4. with --sign, checks the tree and the tag again: a build that changed a file git tracks is not a build of the tagged commit, so its setup
//      is removed;
//   5. copies the setup to app/src-tauri/target/release-files/OpenStage-Package-Doctor-<version>-Setup.exe, with its SHA-256 beside it.
// docs/releasing.md says how a release is made with it.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app");
const tauriDir = join(appDir, "src-tauri");
const appExe = join(tauriDir, "target", "release", "openstage-package-doctor.exe");
const nsisScript = join(tauriDir, "target", "release", "nsis", "x64", "installer.nsi");
const bundleDir = join(tauriDir, "target", "release", "bundle", "nsis");
const outDir = join(tauriDir, "target", "release-files");
const signDir = join(tauriDir, "target", "signing");
const signScript = join(root, "tools", "sign_windows.py");
const sevenZip = process.env.OPENSTAGE_7ZIP ?? "C:\\Program Files\\7-Zip\\7z.exe";
/** Programs in the setup that their makers sign, never signed here: the web view's setup, for a computer that has no web view. */
const MAKERS_FILES = new Set(["microsoftedgewebview2setup.exe"]);
const PROGRAM = /\.(exe|dll)$/i;

const say = (words) => console.log(words);
function fail(words) {
  console.error(`STOPPED: ${words}`);
  process.exit(1);
}

/** The version in each place it is written. They must all be the same; the release tag is "v" and that version. */
export function versions(repo = root) {
  const json = (path) => JSON.parse(readFileSync(join(repo, path), "utf8")).version;
  const cargo = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(repo, "app", "src-tauri", "Cargo.toml"), "utf8"));
  return {
    "app/src-tauri/tauri.conf.json": json("app/src-tauri/tauri.conf.json"),
    "app/src-tauri/Cargo.toml": cargo ? cargo[1] : undefined,
    "app/package.json": json("app/package.json"),
    "core/package.json": json("core/package.json"),
  };
}

/**
 * The flags a Rust build here is given: one --remap-path-prefix for each folder whose name should not be written into the program, and the linker's
 * /PDBALTPATH, so the debug file is named without its folder. When several prefixes match, rustc takes the last, so the broadest (the user folder)
 * comes first and the repository last. Passed as CARGO_ENCODED_RUSTFLAGS (parts separated by the character 0x1F), which keeps a space in a path whole.
 */
export function folderFlags(home = homedir(), env = process.env, repo = root) {
  const folders = [
    [home, "/home"],
    [env.CARGO_HOME || join(home, ".cargo"), "/cargo"],
    [env.RUSTUP_HOME || join(home, ".rustup"), "/rustup"],
    [repo, "/openstage-package-doctor"],
  ];
  return [...folders.map(([folder, name]) => `--remap-path-prefix=${folder}=${name}`), "-Clink-arg=/PDBALTPATH:%_PDB%"];
}

function rustEnv(more = {}) {
  const env = { ...process.env, ...more };
  delete env.RUSTFLAGS;
  env.CARGO_ENCODED_RUSTFLAGS = folderFlags().join("\x1f");
  return env;
}

/** The files among `files` that name this computer's user folder (as text or as UTF-16, either kind of slash, any case). */
export function namingUserFolder(files, home = homedir()) {
  const needles = [...new Set([home.toLowerCase(), home.replace(/\\/g, "/").toLowerCase()])];
  return files.filter((file) => {
    const text = readFileSync(file).toString("latin1").toLowerCase();
    const wide = readFileSync(file).toString("utf16le").toLowerCase();
    return needles.some((n) => text.includes(n) || wide.includes(n));
  });
}

/** How Tauri's installer script gets the web view's setup: the value of `!define INSTALLWEBVIEW2MODE`. The lines for the other modes are in it too, each inside an `!if`. */
export function webviewMode(script) {
  const found = /^\s*!define\s+INSTALLWEBVIEW2MODE\s+"?([A-Za-z]+)"?\s*$/m.exec(script);
  return found ? found[1] : null;
}

function git(args) {
  const done = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: done.status === 0, out: (done.stdout ?? "").trim() };
}

/** Why this checkout is not the release's tagged commit with nothing changed, or null when it is. */
export function notTagged(tag, status = git(["status", "--porcelain"]), described = git(["describe", "--exact-match", "--tags", "HEAD"])) {
  if (!status.ok) return "git could not say whether anything is uncommitted";
  if (status.out) return `something is uncommitted or untracked:\n${status.out}`;
  if (!described.ok || described.out !== tag) return `the commit checked out is not tagged ${tag}${described.ok ? ` (it is tagged ${described.out})` : ""}`;
  return null;
}

function run(program, args, options = {}) {
  say(`  > ${program} ${args.join(" ")}`);
  const done = spawnSync(program, args, { stdio: "inherit", ...options });
  return done.status ?? 1;
}

function programsIn(folder) {
  const out = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && PROGRAM.test(entry.name)) out.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out.sort();
}

function checkSignatures(files, publisher) {
  if (files.length === 0) return { ok: true, words: "" };
  const env = { ...process.env };
  if (publisher) env.OPENSTAGE_SIGN_PUBLISHER = publisher;
  else delete env.OPENSTAGE_SIGN_PUBLISHER;
  const done = spawnSync("python", ["-I", signScript, "--check", ...files], { env, encoding: "utf8" });
  return { ok: done.status === 0, words: `${done.stdout ?? ""}${done.stderr ?? ""}`.trim() };
}

function checkSetup(setup, sign) {
  if (!existsSync(sevenZip)) fail(`7-Zip is not at ${sevenZip} (set OPENSTAGE_7ZIP), so the programs inside the setup could not be checked.`);
  const work = mkdtempSync(join(tmpdir(), "package-doctor-setup-check-"));
  try {
    const unpacked = spawnSync(sevenZip, ["x", "-y", `-o${work}`, setup], { encoding: "utf8" });
    if (unpacked.status !== 0) fail(`7-Zip could not unpack the setup: ${(unpacked.stdout + unpacked.stderr).slice(-400)}`);
    const inside = programsIn(work);
    const named = namingUserFolder(inside);
    if (named.length > 0) fail(`these programs in the setup name this computer's user folder: ${named.map((f) => relative(work, f)).join(", ")}`);
    say(`  ${inside.length} programs in the setup; none names this computer's user folder`);
    if (!sign) return;
    const theirs = inside.filter((f) => MAKERS_FILES.has(f.split(/[\\/]/).pop().toLowerCase()));
    const ours = [setup, ...inside.filter((f) => !theirs.includes(f))];
    const publisher = process.env.OPENSTAGE_SIGN_PUBLISHER || undefined;
    const mine = checkSignatures(ours, publisher);
    if (!mine.ok) fail(`the signed setup did not pass:\n${mine.words}`);
    const makers = checkSignatures(theirs, undefined);
    if (!makers.ok) fail(`a program its maker signs does not carry a valid signature:\n${makers.words}`);
    say(`  the setup and ${ours.length - 1} programs in it are signed and timestamped${publisher ? ` by ${publisher}` : ""}; ${theirs.length} kept their makers' signatures`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(argv) {
  const sign = argv.includes("--sign");

  say("1. The version.");
  const found = versions();
  const version = found["app/src-tauri/tauri.conf.json"];
  const differ = Object.entries(found).filter(([, v]) => v !== version);
  if (!version || differ.length > 0) fail(`the version is not the same everywhere: ${Object.entries(found).map(([f, v]) => `${f} ${v}`).join(", ")}`);
  const tag = `v${version}`;
  say(`  ${version} everywhere`);
  say(`OpenStage Package Doctor ${version}: building the installer${sign ? ` and signing it, from the commit tagged ${tag}` : " (not signed)"}.`);
  if (sign) {
    const why = notTagged(tag);
    if (why) fail(`a signed build is made only from the release's tagged commit with nothing changed, and ${why}`);
    say(`  the tree is clean and HEAD is ${tag}`);
  }

  let signConfig = null;
  if (sign) {
    mkdirSync(signDir, { recursive: true });
    const ready = spawnSync("python", ["-I", signScript, "--ready"], { stdio: "inherit", env: { ...process.env, OPENSTAGE_SIGN_METADATA: join(signDir, "metadata.json") } });
    if (ready.status !== 0) fail("signing is not ready (what is missing is listed above).");
    signConfig = join(signDir, "tauri-sign.json");
    writeFileSync(signConfig, JSON.stringify({ bundle: { windows: { signCommand: { cmd: "python", args: ["-I", signScript, "--description", "OpenStage Package Doctor", "%1"] } } } }, null, 1) + "\n");
  }

  say("2. The program and the installer.");
  if (existsSync(bundleDir)) for (const name of readdirSync(bundleDir)) if (name.endsWith("-setup.exe")) rmSync(join(bundleDir, name));
  const tauri = [join(appDir, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", ...(signConfig ? ["--config", signConfig] : [])];
  if (run(process.execPath, tauri, { cwd: appDir, env: rustEnv({ OPENSTAGE_SIGN_METADATA: join(signDir, "metadata.json") }) }) !== 0) {
    fail("the program or the installer did not build. What Tauri said is above.");
  }
  const setups = existsSync(bundleDir) ? readdirSync(bundleDir).filter((n) => n.endsWith("-setup.exe")) : [];
  if (setups.length !== 1) fail(`expected one setup file in ${bundleDir}, found ${setups.length}.`);
  const setup = join(bundleDir, setups[0]);

  say("3. Checks.");
  if (namingUserFolder([appExe]).length > 0) fail(`the program names this computer's user folder: ${appExe}`);
  say("  the program does not name this computer's user folder");
  const mode = existsSync(nsisScript) ? webviewMode(readFileSync(nsisScript, "utf8")) : null;
  if (mode !== "embedBootstrapper" && mode !== "offlineInstaller") {
    fail(`the installer would get the web view's setup by ${mode ?? "an unknown way"}, which downloads it while installing. tauri.conf.json must embed it.`);
  }
  say(`  the installer carries the web view's setup (${mode}); it downloads nothing`);
  checkSetup(setup, sign);

  if (sign) {
    say("4. The tree and the tag again.");
    const why = notTagged(tag);
    if (why) {
      rmSync(setup, { force: true });
      fail(`after the build, ${why}. The setup was removed: it would not be a build of the tagged commit.`);
    }
    say(`  still clean, still ${tag}`);
  }

  mkdirSync(outDir, { recursive: true });
  const name = `OpenStage-Package-Doctor-${version}-Setup.exe`;
  const final = join(outDir, name);
  copyFileSync(setup, final);
  const digest = createHash("sha256").update(readFileSync(final)).digest("hex");
  writeFileSync(`${final}.sha256.txt`, `${digest}  ${name}\n`);
  say(`Done: ${final} (${statSync(final).size.toLocaleString("en-US")} bytes)\n  SHA-256 ${digest}`);
}

// Run only when started as a program, not when a test imports it.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) main(process.argv.slice(2));
