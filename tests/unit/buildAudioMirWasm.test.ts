import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repositoryRoot = process.cwd();
const buildScript = path.join(repositoryRoot, "scripts", "build-audio-mir-wasm.mjs");
const suite = process.platform === "win32" ? describe.skip : describe;

function writeExecutable(filePath: string, source: string): void {
  writeFileSync(filePath, source, "utf8");
  chmodSync(filePath, 0o755);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "guitardsl-audio-mir-build-"));
  const bin = path.join(root, "bin");
  const targetLibdir = path.join(root, "target-libs");
  const toolLog = path.join(root, "wasm-pack.log");
  mkdirSync(bin);
  mkdirSync(targetLibdir);
  writeFileSync(path.join(targetLibdir, "libstd-test.rlib"), "stub");

  return {
    root,
    bin,
    targetLibdir,
    toolLog,
    env: (extra: Record<string, string> = {}) => ({
      PATH: bin,
      TOOL_LOG: toolLog,
      FAKE_WASM_LIBDIR: targetLibdir,
      HOMEBREW_PREFIX: "",
      ...extra,
    }),
    run: (extra: Record<string, string> = {}) => spawnSync(
      process.execPath,
      [buildScript],
      { cwd: repositoryRoot, env: { ...process.env, ...{ HOMEBREW_PREFIX: "" }, ...extra, PATH: extra.PATH ?? bin },
        encoding: "utf8" },
    ),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function addPathToolchain(bin: string): void {
  writeExecutable(path.join(bin, "rustc"), "#!/bin/sh\nif [ \"$1\" = \"--print\" ]; then printf '%s\\n' \"$FAKE_WASM_LIBDIR\"; exit 0; fi\nexit 0\n");
  writeExecutable(path.join(bin, "cargo"), "#!/bin/sh\nexit 0\n");
  writeExecutable(path.join(bin, "wasm-pack"), "#!/bin/sh\nprintf 'CARGO=%s\\nRUSTC=%s\\nARGS=%s\\n' \"$CARGO\" \"$RUSTC\" \"$*\" > \"$TOOL_LOG\"\n");
}

suite("Audio MIR WASM build tool selection", () => {
  it("uses valid non-Homebrew Rust and wasm-pack from PATH without invoking Homebrew", () => {
    const fixture = makeFixture();
    try {
      addPathToolchain(fixture.bin);
      const result = fixture.run(fixture.env());
      assert.equal(result.status, 0, result.stderr);
      const log = readFileSync(fixture.toolLog, "utf8");
      assert.ok(log.includes(`CARGO=${realpathSync(path.join(fixture.bin, "cargo"))}`), log);
      assert.ok(log.includes(`RUSTC=${realpathSync(path.join(fixture.bin, "rustc"))}`), log);
      assert.ok(log.includes("build wasm/crates/audio-mir --target nodejs --release"));
    } finally {
      fixture.cleanup();
    }
  });

  it("prefers rustup's active toolchain over shadowing Rust tools on PATH", () => {
    const fixture = makeFixture();
    try {
      addPathToolchain(fixture.bin);
      const rustupHome = path.join(fixture.root, "rustup-home");
      const toolchainBin = path.join(rustupHome, "toolchains", "stable", "bin");
      mkdirSync(toolchainBin, { recursive: true });
      writeExecutable(path.join(toolchainBin, "rustc"), "#!/bin/sh\nexit 0\n");
      writeExecutable(path.join(toolchainBin, "cargo"), "#!/bin/sh\nexit 0\n");
      writeExecutable(path.join(fixture.bin, "rustup"), [
        "#!/bin/sh",
        "if [ \"$1 $2\" = \"show active-toolchain\" ]; then echo 'stable (default)'; exit 0; fi",
        "if [ \"$1 $2\" = \"which rustc\" ]; then echo \"$RUSTUP_HOME/toolchains/stable/bin/rustc\"; exit 0; fi",
        "if [ \"$1 $2\" = \"which cargo\" ]; then echo \"$RUSTUP_HOME/toolchains/stable/bin/cargo\"; exit 0; fi",
        "if [ \"$1 $2 $3\" = \"target list --installed\" ]; then echo wasm32-unknown-unknown; exit 0; fi",
        "exit 1",
        "",
      ].join("\n"));

      const result = fixture.run(fixture.env({ RUSTUP_HOME: rustupHome }));
      assert.equal(result.status, 0, result.stderr);
      const log = readFileSync(fixture.toolLog, "utf8");
      assert.ok(log.includes(`CARGO=${realpathSync(path.join(toolchainBin, "cargo"))}`), log);
      assert.ok(log.includes(`RUSTC=${realpathSync(path.join(toolchainBin, "rustc"))}`), log);
      assert.ok(!log.includes(`RUSTC=${realpathSync(path.join(fixture.bin, "rustc"))}`));
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects Homebrew-resolved Rust tools before running the build", () => {
    for (const homebrewTool of ["rustup", "rustc", "cargo", "wasm-pack"]) {
      const fixture = makeFixture();
      try {
        const homebrewRoot = path.join(fixture.root, "homebrew");
        const homebrewBin = path.join(homebrewRoot, "bin");
        const safeBin = path.join(fixture.root, "safe-bin");
        mkdirSync(homebrewBin, { recursive: true });
        mkdirSync(safeBin);
        addPathToolchain(safeBin);
        writeExecutable(path.join(homebrewBin, homebrewTool), "#!/bin/sh\nexit 0\n");
        const result = fixture.run(fixture.env({
          PATH: `${homebrewBin}${path.delimiter}${safeBin}`,
          HOMEBREW_PREFIX: homebrewRoot,
        }));
        assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, new RegExp(`${homebrewTool} resolves inside Homebrew prefix`));
        assert.equal(existsSync(fixture.toolLog), false);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it("fails with an actionable message when the wasm target standard library is missing", () => {
    const fixture = makeFixture();
    try {
      addPathToolchain(fixture.bin);
      rmSync(path.join(fixture.targetLibdir, "libstd-test.rlib"));
      const result = fixture.run(fixture.env());
      assert.equal(result.status, 1);
      assert.match(result.stderr, /lacks the wasm32-unknown-unknown standard library/);
      assert.equal(existsSync(fixture.toolLog), false);
    } finally {
      fixture.cleanup();
    }
  });
});
