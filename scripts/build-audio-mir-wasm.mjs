import { spawnSync } from "node:child_process";
import { realpathSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = "wasm32-unknown-unknown";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`Audio MIR WASM build: ${message}`);
  process.exit(1);
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function homebrewPrefixes(env) {
  return [
    env.HOMEBREW_PREFIX,
    env.HOMEBREW_CELLAR,
    env.HOMEBREW_REPOSITORY,
    "/opt/homebrew",
    "/home/linuxbrew/.linuxbrew",
    "/usr/local/Cellar",
    "/usr/local/opt",
    "/usr/local/Homebrew",
  ].filter(Boolean).map((prefix) => {
    const resolved = path.resolve(prefix);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  });
}

function rejectHomebrew(name, filePath, env) {
  const resolved = realpathSync(filePath);
  const prefix = homebrewPrefixes(env).find((candidate) => inside(candidate, resolved));
  if (prefix) {
    fail(`${name} resolves inside Homebrew prefix ${prefix}: ${resolved}. Select a non-Homebrew ${name} on PATH.`);
  }
  return resolved;
}

function findOnPath(name, env) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = `${name}${suffix}`;
  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, executable);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== "win32" && (statSync(candidate).mode & 0o111) === 0) continue;
      return rejectHomebrew(name, candidate, env);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      throw error;
    }
  }
  return undefined;
}

function capture(command, args, env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, windowsHide: true });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    fail(`${path.basename(command)} ${args.join(" ")} failed${details ? `:\n${details}` : "."}`);
  }
  return result.stdout.trim();
}

function requireWasmTargetWithRustup(rustup, env) {
  const installed = capture(rustup, ["target", "list", "--installed"], env).split(/\s+/);
  if (!installed.includes(target)) {
    fail(`the selected Rust toolchain lacks ${target}; install that target before building.`);
  }
}

function requireWasmTargetWithRustc(rustc, env) {
  const libdir = capture(rustc, ["--print", "target-libdir", "--target", target], env);
  let hasStandardLibrary = false;
  try {
    hasStandardLibrary = readdirSync(libdir).some((entry) => /^libstd-[^/]+\.rlib$/.test(entry));
  } catch {
    // The target may be known by rustc but its standard library is not installed.
  }
  if (!hasStandardLibrary) {
    fail(`the selected Rust compiler lacks the ${target} standard library; install the target before building.`);
  }
}

const rustup = findOnPath("rustup", process.env);
const wasmPack = findOnPath("wasm-pack", process.env);
if (!wasmPack) fail("wasm-pack was not found on PATH. Install it with a non-Homebrew toolchain.");

let cargo;
let rustc;
let env = { ...process.env };
if (rustup) {
  const activeToolchain = capture(rustup, ["show", "active-toolchain"], env).split(/\s+/)[0];
  if (!activeToolchain) fail("rustup did not report an active toolchain.");
  env.RUSTUP_TOOLCHAIN = activeToolchain;
  rustc = rejectHomebrew("rustc", capture(rustup, ["which", "rustc"], env), env);
  cargo = rejectHomebrew("cargo", capture(rustup, ["which", "cargo"], env), env);
  requireWasmTargetWithRustup(rustup, env);
} else {
  rustc = findOnPath("rustc", env);
  cargo = findOnPath("cargo", env);
  if (!rustc) fail("rustc was not found on PATH. Install Rust or provide a non-Homebrew compiler.");
  if (!cargo) fail("cargo was not found on PATH. Install Cargo or provide a non-Homebrew executable.");
  requireWasmTargetWithRustc(rustc, env);
}

// Pin the selected tools for wasm-pack and any Cargo subprocesses. This script
// never invokes Homebrew and rejects tool paths resolved inside its prefixes.
env = {
  ...env,
  PATH: [path.dirname(cargo), path.dirname(rustc), process.env.PATH].filter(Boolean).join(path.delimiter),
  CARGO: cargo,
  RUSTC: rustc,
};
delete env.CARGO_BUILD_RUSTC;

console.log(`Building Audio MIR WASM (wasm-pack ${wasmPack}; cargo ${cargo}; rustc ${rustc})`);
const build = spawnSync(
  wasmPack,
  [
    "build",
    "wasm/crates/audio-mir",
    "--target",
    "nodejs",
    "--release",
    "--out-dir",
    "../../../media/audio-mir-wasm",
    "--out-name",
    "guitardsl_audio_mir",
  ],
  { cwd: projectRoot, env, stdio: "inherit", windowsHide: true },
);

if (build.error) fail(`could not run wasm-pack: ${build.error.message}`);
if (build.status !== 0) process.exit(build.status ?? 1);
