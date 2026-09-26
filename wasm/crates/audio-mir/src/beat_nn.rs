//! Beat This! `small0` beat tracking (#56): chunking and aggregation as upstream
//! `split_piece` / `aggregate_prediction` (`keep_first`, border 6), tract inference of the
//! embedded ONNX model, and upstream `postp_minimal` peak picking.

use tract_onnx::prelude::*;

use crate::error::{MirError, MirResult};
use crate::mel::{MODEL_FPS, N_MELS};
use crate::tempo::BeatTrack;

/// Frames per chunk (30 s at 50 fps), as upstream inference.
pub const CHUNK: usize = 1500;
/// Frames discarded on each side of a chunk prediction.
pub const BORDER: usize = 6;
const MIN_BEATS: usize = 8;
/// IBIs within this relative distance of the median count toward the confidence.
const CONFIDENCE_TOLERANCE: f64 = 0.10;

static MODEL_ONNX: &[u8] = include_bytes!("../models/beat_this_small0.onnx");

type Plan = std::sync::Arc<TypedRunnableModel>;

/// The embedded model, fixed to one chunk length and optimized.
pub struct BeatModel {
    frames: usize,
    plan: Plan,
}

impl BeatModel {
    pub fn new(frames: usize) -> MirResult<Self> {
        let plan = (|| -> TractResult<Plan> {
            tract_onnx::onnx()
                .model_for_read(&mut std::io::Cursor::new(MODEL_ONNX))?
                .with_input_fact(0, f32::fact([1, frames, N_MELS]).into())?
                .into_optimized()?
                .into_runnable()
        })()
        .map_err(|_| MirError::AnalysisFailed)?;
        Ok(BeatModel { frames, plan })
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    /// Beat logits for one chunk (`frames * 128` values, row-major).
    pub fn infer(&self, chunk: &[f32]) -> MirResult<Vec<f32>> {
        if chunk.len() != self.frames * N_MELS {
            return Err(MirError::AnalysisFailed);
        }
        let input = tract_ndarray::Array3::from_shape_vec((1, self.frames, N_MELS), chunk.to_vec())
            .map_err(|_| MirError::AnalysisFailed)?;
        let out = self
            .plan
            .run(tvec!(input.into_tensor().into()))
            .map_err(|_| MirError::AnalysisFailed)?;
        let logits: Vec<f32> = out[0]
            .to_plain_array_view::<f32>()
            .map_err(|_| MirError::AnalysisFailed)?
            .iter()
            .copied()
            .collect();
        if logits.len() != self.frames || logits.iter().any(|v: &f32| !v.is_finite()) {
            return Err(MirError::AnalysisFailed);
        }
        Ok(logits)
    }
}

/// Chunk start frames of a piece of `total` frames (upstream `split_piece` with
/// `avoid_short_end`); starts can be negative (left padding).
pub fn chunk_starts(total: usize) -> Vec<i64> {
    let step = (CHUNK - 2 * BORDER) as i64;
    let total_i = total as i64;
    let mut starts: Vec<i64> = (0..)
        .map(|k| -(BORDER as i64) + k * step)
        .take_while(|&s| s < total_i - BORDER as i64)
        .collect();
    if total_i > step {
        if let Some(last) = starts.last_mut() {
            *last = total_i - (CHUNK - BORDER) as i64;
        }
    }
    starts
}

/// Frames in the chunk starting at `start` (shorter than `CHUNK` only for a short piece).
pub fn chunk_frames(start: i64, total: usize) -> usize {
    let t = total as i64;
    let left = (-start).max(0);
    let body = (start + CHUNK as i64).min(t) - start.max(0);
    let right = (start + CHUNK as i64 - t).clamp(0, BORDER as i64);
    (left + body + right) as usize
}

/// The zero-padded mel chunk starting at `start` (row-major `[frames][128]`).
pub fn chunk(mel: &[f32], total: usize, start: i64) -> Vec<f32> {
    let frames = chunk_frames(start, total);
    let mut out = vec![0.0f32; frames * N_MELS];
    let left = (-start).max(0) as usize;
    let from = start.max(0) as usize;
    let to = ((start + CHUNK as i64) as usize).min(total);
    out[left * N_MELS..(left + to - from) * N_MELS]
        .copy_from_slice(&mel[from * N_MELS..to * N_MELS]);
    out
}

/// Whole-piece beat logits from per-chunk logits (`keep_first`: earlier chunks win).
pub fn aggregate(chunks: &[Vec<f32>], starts: &[i64], total: usize) -> Vec<f32> {
    let mut piece = vec![-1000.0f32; total];
    for (logits, &start) in chunks.iter().zip(starts).rev() {
        let inner = &logits[BORDER..logits.len() - BORDER];
        for (k, &v) in inner.iter().enumerate() {
            let t = start + (BORDER + k) as i64;
            if t >= 0 && (t as usize) < total {
                piece[t as usize] = v;
            }
        }
    }
    piece
}

/// Upstream `deduplicate_peaks(width=1)`: groups of adjacent peaks become their running mean.
fn deduplicate(peaks: &[usize]) -> Vec<f64> {
    let mut out = Vec::new();
    let mut it = peaks.iter();
    let Some(&first) = it.next() else {
        return out;
    };
    let mut p = first as f64;
    let mut c = 1.0;
    for &p2 in it {
        let p2 = p2 as f64;
        if p2 - p <= 1.0 {
            c += 1.0;
            p += (p2 - p) / c;
        } else {
            out.push(p);
            p = p2;
            c = 1.0;
        }
    }
    out.push(p);
    out
}

/// Upstream `postp_minimal` for beats: local maxima within ±3 frames with logit > 0,
/// adjacent peaks merged; returns beat times in seconds.
pub fn beat_times(logits: &[f32]) -> Vec<f64> {
    let n = logits.len();
    let peaks: Vec<usize> = (0..n)
        .filter(|&t| {
            let lo = t.saturating_sub(3);
            let hi = (t + 3).min(n - 1);
            let max = logits[lo..=hi]
                .iter()
                .copied()
                .fold(f32::NEG_INFINITY, f32::max);
            logits[t] == max && logits[t] > 0.0
        })
        .collect();
    deduplicate(&peaks)
        .into_iter()
        .map(|f| f / MODEL_FPS)
        .collect()
}

/// Beat track in rhythm-frame units from beat times. The steady intervals are those within
/// ±10% of the median inter-beat interval; BPM comes from their mean (beat times sit on the
/// 20 ms model grid, so the median alone would be quantized) and the confidence is their share.
pub fn beat_track(times: &[f64], rhythm_frame_of: impl Fn(f64) -> usize) -> MirResult<BeatTrack> {
    if times.len() < MIN_BEATS {
        return Err(MirError::NoStableBeat);
    }
    let mut ibis: Vec<f64> = times.windows(2).map(|w| w[1] - w[0]).collect();
    ibis.sort_by(f64::total_cmp);
    let median = ibis[ibis.len() / 2];
    if !(median.is_finite() && median > 0.0) {
        return Err(MirError::NoStableBeat);
    }
    let steady: Vec<f64> = ibis
        .iter()
        .copied()
        .filter(|&d| (d / median - 1.0).abs() <= CONFIDENCE_TOLERANCE)
        .collect();
    let mean = steady.iter().sum::<f64>() / steady.len() as f64;
    let beats: Vec<usize> = times.iter().map(|&t| rhythm_frame_of(t)).collect();
    Ok(BeatTrack {
        beats,
        seconds: Some(times.to_vec()),
        bpm: 60.0 / mean,
        confidence: (steady.len() as f64 / ibis.len() as f64).clamp(0.0, 1.0),
    })
}

/// Runs every chunk sequentially in this instance (the single-call `analyze_wav` path).
pub fn infer_piece(mel: &[f32]) -> MirResult<Vec<f32>> {
    let total = mel.len() / N_MELS;
    let starts = chunk_starts(total);
    let mut models: Vec<BeatModel> = Vec::new();
    let mut chunks = Vec::with_capacity(starts.len());
    for &s in &starts {
        let c = chunk(mel, total, s);
        let frames = c.len() / N_MELS;
        if !models.iter().any(|m| m.frames() == frames) {
            models.push(BeatModel::new(frames)?);
        }
        let model = models.iter().find(|m| m.frames() == frames).unwrap();
        chunks.push(model.infer(&c)?);
    }
    Ok(aggregate(&chunks, &starts, total))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_matches_split_piece() {
        // Short piece: one chunk padded by the border on both sides.
        assert_eq!(chunk_starts(301), vec![-6]);
        assert_eq!(chunk_frames(-6, 301), 313);
        // Exactly one step: still a single padded chunk.
        assert_eq!(chunk_starts(1488), vec![-6]);
        assert_eq!(chunk_frames(-6, 1488), 1500);
        // Longer pieces: the last chunk is shifted to end at the piece end.
        assert_eq!(chunk_starts(1489), vec![-6, 1489 - 1494]);
        assert_eq!(chunk_starts(4000), vec![-6, 1482, 4000 - 1494]);
        for &s in &chunk_starts(4000) {
            assert_eq!(chunk_frames(s, 4000), 1500);
        }
    }

    #[test]
    fn chunk_copies_mel_with_zero_padding() {
        let total = 10;
        let mel: Vec<f32> = (0..total * N_MELS).map(|i| i as f32).collect();
        let c = chunk(&mel, total, -6);
        assert_eq!(c.len(), (6 + 10 + 6) * N_MELS);
        assert!(c[..6 * N_MELS].iter().all(|&v| v == 0.0));
        assert_eq!(&c[6 * N_MELS..16 * N_MELS], &mel[..]);
        assert!(c[16 * N_MELS..].iter().all(|&v| v == 0.0));
    }

    #[test]
    fn aggregate_keeps_first_chunk_on_overlap() {
        let total = 1600;
        let starts = chunk_starts(total);
        assert_eq!(starts, vec![-6, 106]);
        let chunks = vec![vec![1.0f32; CHUNK], vec![2.0f32; CHUNK]];
        let piece = aggregate(&chunks, &starts, total);
        // First chunk covers frames 0..1488, the shifted last one the rest.
        assert!(piece[..1488].iter().all(|&v| v == 1.0));
        assert!(piece[1488..].iter().all(|&v| v == 2.0));
    }

    #[test]
    fn peak_picking_follows_postp_minimal() {
        let mut logits = vec![-5.0f32; 200];
        logits[10] = 2.0; // clean peak
        logits[50] = 1.0; // plateau of two adjacent maxima -> mean 50.5
        logits[51] = 1.0;
        logits[100] = -0.5; // local maximum below 0.5 probability
        logits[150] = 3.0; // peak with a smaller one 2 frames away (suppressed)
        logits[152] = 2.5;
        let t = beat_times(&logits);
        assert_eq!(t, vec![10.0 / 50.0, 50.5 / 50.0, 150.0 / 50.0]);
    }

    #[test]
    fn beat_track_bpm_is_not_quantized_to_model_frames() {
        // 139 BPM on the 20 ms grid: intervals alternate between 21 and 22 frames.
        let times: Vec<f64> = (0..40)
            .map(|k| (k as f64 * 60.0 / 139.0 * MODEL_FPS).round() / MODEL_FPS)
            .collect();
        let bt = beat_track(&times, |t| (t * 100.0) as usize).unwrap();
        assert!((bt.bpm - 139.0).abs() < 0.2, "bpm {}", bt.bpm);
        // One outlier interval (a missed beat) lowers the confidence but not the tempo.
        let mut gap = times.clone();
        gap.remove(20);
        let bt = beat_track(&gap, |t| (t * 100.0) as usize).unwrap();
        assert!((bt.bpm - 139.0).abs() < 0.2, "bpm {}", bt.bpm);
        assert!(bt.confidence < 1.0);
    }

    #[test]
    fn beat_track_uses_median_interval() {
        let times: Vec<f64> = (0..12).map(|k| 1.0 + 0.5 * k as f64).collect();
        let bt = beat_track(&times, |t| (t * 100.0) as usize).unwrap();
        assert!((bt.bpm - 120.0).abs() < 1e-9);
        assert_eq!(bt.confidence, 1.0);
        assert_eq!(bt.beats[0], 100);
        assert_eq!(
            beat_track(&times[..7], |t| (t * 100.0) as usize).err(),
            Some(MirError::NoStableBeat)
        );
    }

    fn logits_of(sr: u32) -> Vec<f32> {
        let mut planner = rustfft::FftPlanner::new();
        let mut input = crate::mel::ModelInput::new(&mut planner, sr);
        for x in crate::mel::test_signal(sr) {
            input.push(x);
        }
        infer_piece(&input.finish()).unwrap()
    }

    #[test]
    fn resampled_logits_stay_close_to_upstream() {
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/beat_this_reference.json"))
                .unwrap();
        for sr in [44_100u32, 48_000] {
            let reference: Vec<f32> =
                serde_json::from_value(fx["resampled"][sr.to_string()]["logits"].clone()).unwrap();
            let logits = logits_of(sr);
            assert_eq!(logits.len(), reference.len());
            let d = logits
                .iter()
                .zip(&reference)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);
            assert!(d <= 0.02, "{sr} Hz: max logit difference {d}");
            // Same beats after peak picking.
            assert_eq!(beat_times(&logits), beat_times(&reference));
        }
    }

    #[test]
    fn logits_match_pytorch_reference() {
        let fx: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/beat_this_reference.json"))
                .unwrap();
        let mut planner = rustfft::FftPlanner::new();
        let mut input = crate::mel::ModelInput::new(&mut planner, crate::mel::MODEL_RATE);
        for x in crate::mel::test_signal(crate::mel::MODEL_RATE) {
            input.push(x);
        }
        let mel = input.finish();
        let logits = infer_piece(&mel).unwrap();
        let reference: Vec<f32> = serde_json::from_value(fx["logits_first"].clone()).unwrap();
        assert_eq!(logits.len(), reference.len());
        let d = logits
            .iter()
            .zip(&reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(d <= 1e-3, "max logit difference {d}");
    }
}
