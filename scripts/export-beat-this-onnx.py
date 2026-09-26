#!/usr/bin/env python3
"""Export the Beat This! `small0` beat tracker to ONNX for the Audio MIR WASM core (#56).

Development-only and not shipped. Requires `torch`, `torchaudio`, `onnx`, `numpy`, `soxr` and
`beat_this` (https://github.com/CPJKU/beat_this, MIT). Usage:

    python scripts/export-beat-this-onnx.py <out-dir> [--checkpoint small0] [--fixtures <dir>]

Writes `<out-dir>/beat_this_small0.onnx`: input `spect` [1, time, 128] (log-mel frames,
see LogMelSpect), output `beat` [1, time] (frame-wise beat logits at 50 fps). The time axis
is symbolic; the runtime fixes it per chunk length (1500, or shorter for a short piece, as
upstream `split_piece` produces) before optimizing. With `--fixtures`, it also writes the
generated-signal reference fixtures used by the Rust parity tests.
"""

import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np
import torch

from beat_this.inference import load_checkpoint, load_model
from beat_this.preprocessing import LogMelSpect

CHUNK = 1500
N_MELS = 128
OPSET = 17


class BeatOnly(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, spect):
        return self.model(spect)["beat"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def test_signal(sr=22050, seconds=6.0):
    """Deterministic chirp + decaying clicks at 120 BPM (generated, no recorded audio)."""
    t = np.arange(int(sr * seconds)) / sr
    chirp = 0.3 * np.sin(2 * np.pi * (110 * t + 0.5 * (880 - 110) / seconds * t * t))
    clicks = np.zeros_like(t)
    for k in range(int(seconds * 2)):
        start = int(k * 0.5 * sr)
        n = min(len(t) - start, int(0.03 * sr))
        clicks[start:start + n] += 0.6 * np.exp(-np.arange(n) / (0.004 * sr)) * np.sin(
            2 * np.pi * 2000 * np.arange(n) / sr)
    return (chirp + clicks).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--checkpoint", default="small0")
    ap.add_argument("--fixtures")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    torch.manual_seed(0)
    model = load_model(args.checkpoint, "cpu")
    wrapped = BeatOnly(model).eval()
    out = os.path.join(args.out_dir, f"beat_this_{args.checkpoint}.onnx")
    dummy = torch.zeros(1, CHUNK, N_MELS)
    with torch.inference_mode():
        torch.onnx.export(
            wrapped, (dummy,), out, input_names=["spect"], output_names=["beat"],
            opset_version=OPSET, dynamo=False, do_constant_folding=True,
            dynamic_axes={"spect": {1: "time"}, "beat": {1: "time"}},
        )
    import onnx
    onnx.checker.check_model(onnx.load(out))
    print(f"onnx {out} sha256 {sha256(out)} bytes {os.path.getsize(out)}")

    if args.fixtures:
        os.makedirs(args.fixtures, exist_ok=True)
        signal = test_signal()
        mel = LogMelSpect()(torch.from_numpy(signal))  # [frames, 128]
        # One short piece: upstream split_piece pads 6 frames on both sides.
        spect = torch.nn.functional.pad(mel, (0, 0, 6, 6)).unsqueeze(0)
        with torch.inference_mode():
            logits = wrapped(spect)[0][6:-6]
        rows = (0, 1, 25, 150, int(mel.shape[0]) - 1)
        fixture = {
            "sample_rate": 22050,
            "signal": "chirp 110->880 Hz (0.3) + 2 kHz clicks every 0.5 s (0.6), 6 s",
            "frames": int(mel.shape[0]),
            "mel_rows": {str(i): mel[i].tolist() for i in rows},
            "logits_first": logits[: mel.shape[0]].tolist(),
            "resampled": {},
        }
        # The same analytic signal at the supported WAV rates, resampled like upstream (soxr).
        import soxr
        for sr in (44100, 48000):
            native = test_signal(sr).astype(np.float64)
            down = soxr.resample(native, in_rate=sr, out_rate=22050).astype(np.float32)
            rmel = LogMelSpect()(torch.from_numpy(down))
            rspect = torch.nn.functional.pad(rmel, (0, 0, 6, 6)).unsqueeze(0)
            with torch.inference_mode():
                rlogits = wrapped(rspect)[0][6:-6]
            fixture["resampled"][str(sr)] = {
                "frames": int(rmel.shape[0]),
                "mel_rows": {str(i): rmel[i].tolist() for i in (1, 25, 150)},
                "logits": rlogits.tolist(),
            }
        path = os.path.join(args.fixtures, "beat_this_reference.json")
        with open(path, "w") as f:
            json.dump(fixture, f)
        print(f"fixture {path} frames {mel.shape[0]}")


if __name__ == "__main__":
    sys.exit(main())
