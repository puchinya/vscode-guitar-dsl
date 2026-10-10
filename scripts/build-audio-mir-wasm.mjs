import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const rustupPath = path.join(cargoBin, `rustup${executableSuffix}`);
const wasmPackPath = path.join(cargoBin, `wasm-pack${executableSuffix}`);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`Audio MIR WASM build: ${message}`);
  process.exit(1);
}

function capture(command, args, env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, windowsHide: true });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    fail(`${command} ${args.join(" ")} failed${details ? `:\n${details}` : "."}`);
  }
  return result.stdout.trim();
}

function assertRustupManagedTool(name, filePath, rustupHome) {
  if (!existsSync(filePath)) fail(`${filePath} is missing. Install rustup and ${name} under ~/.cargo/bin.`);

  const resolved = realpathSync(filePath);
  const toolchainRoot = path.resolve(rustupHome, "toolchains");
  const relative = path.relative(toolchainRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`rustup resolved ${name} outside its managed toolchains: ${resolved}`);
  }
  return resolved;
}

function assertInside(directory, filePath, name) {
  const root = path.resolve(directory);
  const resolved = realpathSync(filePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${name} resolves outside ${root}: ${resolved}`);
  }
  return resolved;
}

if (!existsSync(rustupPath)) {
  fail(`rustup was not found at ${rustupPath}; the build will not fall back to Rust from PATH or Homebrew.`);
}
if (!existsSync(wasmPackPath)) {
  fail(`wasm-pack was not found at ${wasmPackPath}; install it under ~/.cargo/bin. The build will not fall back to PATH or Homebrew.`);
}
assertInside(cargoBin, rustupPath, "rustup");
const wasmPack = assertInside(cargoBin, wasmPackPath, "wasm-pack");

const activeToolchain = capture(rustupPath, ["show", "active-toolchain"], process.env).split(/\s+/)[0];
if (!activeToolchain) fail("rustup did not report an active toolchain.");

const rustupEnv = {
  ...process.env,
  RUSTUP_TOOLCHAIN: activeToolchain,
};
const rustupHome = process.env.RUSTUP_HOME || path.join(os.homedir(), ".rustup");
const rustcPath = assertRustupManagedTool("rustc", capture(rustupPath, ["which", "rustc"], rustupEnv), rustupHome);
const cargoPath = assertRustupManagedTool("cargo", capture(rustupPath, ["which", "cargo"], rustupEnv), rustupHome);

const installedTargets = capture(rustupPath, ["target", "list", "--installed"], rustupEnv).split(/\s+/);
if (!installedTargets.includes("wasm32-unknown-unknown")) {
  fail(`rustup toolchain ${activeToolchain} lacks wasm32-unknown-unknown; install that target with rustup before building.`);
}

// Put the selected toolchain's binaries first and pin rustc explicitly. This
// bypasses both Homebrew binaries and any inherited RUSTC override.
const env = {
  ...rustupEnv,
  PATH: [path.dirname(cargoPath), cargoBin, process.env.PATH].filter(Boolean).join(path.delimiter),
  RUSTC: rustcPath,
};
delete env.CARGO_BUILD_RUSTC;

console.log(`Building Audio MIR WASM with rustup ${activeToolchain} (wasm-pack ${wasmPack}; cargo ${cargoPath}; rustc ${rustcPath})`);
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
