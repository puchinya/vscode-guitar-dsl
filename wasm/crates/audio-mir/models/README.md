# Audio MIR models

## `beat_this_small0.onnx`

The Beat This! beat tracker (Foscarin, Schlüter and Widmer, ISMIR 2024), `small0` checkpoint, exported to ONNX for the Audio MIR WASM core (#56). It is embedded into the `.wasm` with `include_bytes!` and inferred through `tract-onnx`.

| item | value |
|---|---|
| Upstream | https://github.com/CPJKU/beat_this, commit `b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c` (package 1.1.0) |
| Checkpoint | `small0` (`https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt`), SHA-256 `6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b` |
| ONNX | opset 17, fp32. Input `spect` `[1, time, 128]`; output `beat` `[1, time]` (beat logits at 50 fps). SHA-256 `4d385c057bac459597cca324eaa4fc1b0ade5df893c53fc7ac09fe95cae0c2e2`, 10,555,596 bytes |
| Export environment | Python 3.13, torch 2.14.0, torchaudio 2.11.0, onnx 1.23.0 |
| License | MIT, © 2024 Institute of Computational Perception, JKU Linz (see [`LICENSE-beat_this`](LICENSE-beat_this) and the repository `THIRD_PARTY_NOTICES.md`) |

To reproduce the file and the test fixtures (the export is deterministic; compare the printed SHA-256):

```bash
python -m venv .venv && .venv/bin/pip install torch torchaudio onnx onnxscript soxr "git+https://github.com/CPJKU/beat_this.git@b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c"
.venv/bin/python scripts/export-beat-this-onnx.py wasm/crates/audio-mir/models --fixtures wasm/crates/audio-mir/tests/fixtures
```

The upstream README notes that some of the training data is fully copyrighted or under limited Creative Commons licenses. The published weights themselves are MIT licensed. The released models were trained on every upstream dataset except GTZAN, including the GuitarSet comping tracks, so GuitarSet results for this model are reference values only.
