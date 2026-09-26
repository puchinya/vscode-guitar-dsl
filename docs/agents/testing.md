# Testing and Verification Guide

This document is the sole verification command authority for `vscode-guitar-dsl`.

## Test Rules and Directory Structure

All automated tests must be placed in designated directories based on their scope:

| Test Type | Directory | Execution Environment | Target Scope |
|---|---|---|---|
| **Unit Tests** | `tests/unit/**/*.test.ts` | Node.js (Mocha + tsx) | Pure logic independent of VS Code runtime (e.g. `src/compiler.ts` parsing/rendering, `src/symbols.ts` formatters). Fast and standalone. |
| **E2E Tests** | `tests/e2e/**/*.test.ts` | VS Code Extension Host (`@vscode/test-electron`) | Extension activation, registered commands (`guitardsl.showPreview`, `guitardsl.exportPdf`), language contribution, document symbol providers, and webview interactions. |

### Test Conventions
- Test file naming: `*.test.ts`.
- Unit tests must be completely runnable standalone without launching VS Code or requiring external network access.
- E2E tests run inside a headless VS Code instance managed by `@vscode/test-electron`.

---

## Verification Commands

### 1. Unit Tests
Run standalone unit tests:
```bash
npm run test:unit
```
- Fast iteration check for parser, data structures, and HTML/SVG generation.
- Zero VS Code launch overhead.

### 2. E2E Tests
Run integration tests in VS Code runtime:
```bash
npm run test:e2e
```
- Compiles the extension and test files (`npm run compile:all`).
- Launches VS Code and runs the E2E test suite.

### 3. Full Test Suite
Run both unit and E2E tests:
```bash
npm test
```

---

## Mandatory Verification Gate

Every extension-changing task must pass the mandatory verification gate before PR delivery and after stable review remediation:

### 1. Mandatory TypeScript Compilation Gate
Run:
```bash
npm run compile
```
- Must compile cleanly (`tsc -p ./`) with exit code 0.
- Zero TypeScript diagnostics / errors.
- Generates/updates `./out/extension.js`, `./out/compiler.js`, and `./out/symbols.js`.

### 2. Mandatory Automated Test Gate
Run:
```bash
npm test
```
- All unit tests (`npm run test:unit`) must pass.
- All E2E tests (`npm run test:e2e`) must pass.

### 3. Syntax & Grammar Verification
When modifying `syntaxes/guitardsl.tmLanguage.json` or `language-configuration.json`:
- JSON syntax must be valid (`python3 -m json.tool syntaxes/guitardsl.tmLanguage.json > /dev/null`).
- Scopes must match TextMate naming conventions (e.g. `keyword.control`, `string.quoted`, `comment.line`).

### 4. Packaging & Prepublish Sanity Check
Run:
```bash
npm run vscode:prepublish
```
- Verifies compilation completes without errors before packaging.
- Optionally run `npx @vscode/vsce ls` to ensure package files are resolved correctly.
- Packaged contents are controlled by `.vscodeignore`: the VSIX must contain only runtime files (`out/**/*.js` excluding `out/tests/`, `package.json`, `package.nls*.json`, `README.md`, `language-configuration.json`, `syntaxes/`, `media/`, production `node_modules/`). Development/agent paths (`.agent-state/`, `.vscode-test/`, `src/`, `tests/`, `docs/`, `scripts/`, `samples/`, `*.ts`, `*.map`) must not appear in `vsce ls`.

### 5. Audio MIR (Rust/WASM) Gate
Required when a change touches `wasm/`, `src/audioMir/`, the Audio MIR scripts or packaging. Prerequisites: rustup toolchain with the `wasm32-unknown-unknown` target and `wasm-pack` on `PATH`. If Homebrew's `rustc` shadows rustup, put `~/.cargo/bin` first.
```bash
cargo fmt --manifest-path wasm/Cargo.toml --check
cargo test --manifest-path wasm/Cargo.toml
cargo clippy --manifest-path wasm/Cargo.toml --all-targets -- -D warnings
(cd wasm && cargo check --target wasm32-unknown-unknown)   # from wasm/ so wasm/.cargo/config.toml applies
npm run build:audio-mir        # wasm-pack --target nodejs -> media/audio-mir-wasm/
npm run test:audio-mir-wasm    # Node smoke test of the generated WASM (synthetic audio)
npm run compile
npm test
npm run vscode:prepublish      # builds Audio MIR WASM, then compiles TypeScript
npx @vscode/vsce ls
```
- Rust tests use generated audio only. Never commit recorded or copyrighted audio, and never commit reference LAB files unless they are demonstrably redistributable.
- `vsce ls` must include `out/audioMir/*.js` (including `worker.js` and `inferWorker.js`), `media/audio-mir-wasm/guitardsl_audio_mir.js`, `media/audio-mir-wasm/guitardsl_audio_mir_bg.wasm` (with the embedded Beat This! model) and `THIRD_PARTY_NOTICES.md`. It must exclude `wasm/**` (Rust sources and `wasm/target/`), `tests/**`, `scripts/**` and `media/audio-mir-wasm/*.d.ts`.
- `media/audio-mir-wasm/` and `wasm/target/` are build output and are git-ignored. `wasm/Cargo.lock` is committed.
- The wasm32 build enables `simd128` through `wasm/.cargo/config.toml`. Cargo reads `.cargo/config.toml` from the current directory and its parents, not from the `--manifest-path` location, so wasm32 `cargo` commands must run inside `wasm/`. Running them from the repository root with `--manifest-path` silently builds without SIMD. `npm run build:audio-mir` is correct because wasm-pack starts cargo in the crate directory. To confirm the shipped build: `wasm-objdump -d media/audio-mir-wasm/guitardsl_audio_mir_bg.wasm | grep -c v128` must be non-zero. Native commands (`test`, `clippy`, `fmt`) are unaffected.
- Beat This! model (#56): `wasm/crates/audio-mir/models/beat_this_small0.onnx` is committed. Re-export only when the upstream checkpoint or export changes; follow `models/README.md` (`scripts/export-beat-this-onnx.py`, which also regenerates `tests/fixtures/beat_this_reference.json`) and check that the printed SHA-256 matches the README. The Rust tests pin mel parity with torchaudio (at 22,050 Hz, and against soxr for 44.1 and 48 kHz input), logit parity with PyTorch, and that `Classic` reproduces the #52 output (`tests/fixtures/classic_song_*.json`).
- Beat and tempo evaluation (required when a change touches `mel.rs`, `beat_nn.rs`, `tempo.rs`, the model or the beat post-processing). Local data only:
  ```bash
  cargo run --release --manifest-path wasm/Cargo.toml --example eval_beats -- --labset <synth dir> --split all --guitarset <GuitarSet dir> --players 03,04,05
  ```
  It reports tempo Acc1 (within 4%), Acc2 (also ×1/3, ×1/2, ×2, ×3), median absolute error and beat F-measure (±70 ms, beats before 5 s discarded) for `Classic` and the shipped `Neural` path (Beat This!, falling back to `Classic` when it finds fewer than 8 beats) per group. The released Beat This! models were trained on GuitarSet comping, so GuitarSet rows are reference only.
  - Drumless acceptance uses the **pulse set**, where every beat is struck (the default set's no-band songs mostly strike every second beat, so their quarter-note tempo is absent from the audio):
    ```bash
    node scripts/generate-audio-mir-synth-set.mjs <pulse dir> --count 60 --seed 2 --profile pulse
    <tmp>/render <pulse dir>
    cargo run --release --manifest-path wasm/Cargo.toml --example eval_beats -- --labset <pulse dir> --split all
    ```
  - The default set (`--count 72 --seed 1`) checks `synth/band` and the no-band no-regression (Acc2, beat F). The chord evaluators below also print tempo Acc1 / Acc2, and the labset evaluator adds a per-band summary.
- End-to-end timing through the real worker orchestration (analysis worker + parallel inference workers): `npm run build:audio-mir && npm run compile && node scripts/benchmark-audio-mir-job.mjs [--seconds 300]`. It prints wall time and peak RSS. Measure on an otherwise idle machine.
- Optional real-song measurement: `node scripts/evaluate-audio-mir.mjs <audio.wav> <reference.lab> [--bpm <n>]` reports BPM error, duration-weighted chord root / exact / maj-min recall, chord-change P/R/F1 at ±100 ms, analysis time and peak RSS.
- Harmony evaluation datasets are local only and never committed. They are required when a change touches chroma, classifier or decoding parameters:
  - **GuitarSet** (Zenodo 3371780: `annotation/` + `audio_mono-mic/`): `node scripts/evaluate-audio-mir-guitarset.mjs <dir> --players 03,04,05` (report split). Reference chords are the JAMS *performed* annotation. Labels are reduced MIREX-style (approved rule, Issue #52): added degrees and the bass are ignored; 9/11/13 → 7, maj9/11/13 → maj7, min9/11/13 → m7, sixths → triad, dim7 → dim; hdim7, minmaj7 and interval-only chords count toward root recall only. maj/min recall follows mir_eval `majmin` (dim, hdim7, aug and sus are excluded). `tune_harmony` uses the same reduction.
  - **Synthetic multi-instrument set** (macOS GM sound bank):
    ```bash
    node scripts/generate-audio-mir-synth-set.mjs <dir> --count 72 --seed 1
    xcrun swiftc -O scripts/render-audio-mir-synth-set.swift -o <tmp>/render && <tmp>/render <dir>
    node scripts/evaluate-audio-mir-labset.mjs <dir> --split report
    ```
  - Compare against the previous build with `--wasm <other build>/guitardsl_audio_mir.js`.
  - Tuning uses only the tune splits:
    ```bash
    cargo run --release --manifest-path wasm/Cargo.toml --example tune_harmony -- --guitarset <dir> --players 00,01,02 --labset <synth dir> --split tune
    ```
    The default grid is the search that selected the shipped parameters:
    - peel masks 18 = {3,6}, 26 = {3,5,6}, 23 = {2,3,4,6}, 31 = {2..6};
    - α ∈ {0.6, 0.8, 1.0, 1.2}, γ ∈ {0.7, 0.85, 1.0};
    - θ ∈ {0.6, 0.8}, λ ∈ {0.2, 0.3}.

    The `SELECTED` line applies the fixed selection rule: the best overall exact recall among candidates that keep overall root recall and stay within −1.0 pt per group, with ties going to higher root recall. `AnalysisParams::BASELINE` reproduces the #50 pipeline exactly.

## Iteration vs. Final Gate
- During iteration: use focused checks (`npm run test:unit` for logic changes, `npx tsc --noEmit` or `npm run watch`).
- Final gate: run `npm run compile && npm test` and ensure clean build and passing tests.
