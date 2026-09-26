//! Tempo, beat and 4/4 downbeat estimation from the rhythm onset envelope.

use crate::error::{MirError, MirResult};

pub const MIN_BPM: f64 = 55.0;
pub const MAX_BPM: f64 = 220.0;
const CANDIDATES: usize = 6;
const MIN_BEATS: usize = 8;
const INTERVAL_TOLERANCE: f64 = 0.20;
const PENALTY_WEIGHT: f64 = 4.0;
const PAIR_RATIO_TOLERANCE: f64 = 0.02;
const PAIR_SCORE_TOLERANCE: f64 = 0.05;
const MAX_PREFERRED_BPM: f64 = 210.0;
const EPSILON: f64 = 1e-9;
/// Local statistics window (frames) for robust normalization (~1.5 s at the rhythm hop).
pub const LOCAL_WINDOW: usize = 129;

#[derive(Debug, Clone, PartialEq)]
pub struct BeatTrack {
    /// Beat positions as rhythm-frame indices.
    pub beats: Vec<usize>,
    /// Exact beat times in seconds when the tracker is finer than the rhythm frames
    /// (Beat This!); `None` means the rhythm-frame centers are the beat times.
    pub seconds: Option<Vec<f64>>,
    pub bpm: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone)]
struct Candidate {
    bpm: f64,
    beats: Vec<usize>,
    score: f64,
}

/// Centered 3-frame moving average.
pub fn smooth3(x: &[f32]) -> Vec<f32> {
    (0..x.len())
        .map(|i| {
            let lo = i.saturating_sub(1);
            let hi = (i + 1).min(x.len() - 1);
            x[lo..=hi].iter().sum::<f32>() / (hi - lo + 1) as f32
        })
        .collect()
}

fn median_of(buf: &mut [f32]) -> f32 {
    let mid = buf.len() / 2;
    let (_, m, _) = buf.select_nth_unstable_by(mid, |a, b| a.total_cmp(b));
    *m
}

/// Local median and median absolute deviation over a centered window.
pub fn local_median_mad(x: &[f32], window: usize) -> (Vec<f32>, Vec<f32>) {
    let half = window / 2;
    let mut med = Vec::with_capacity(x.len());
    let mut mad = Vec::with_capacity(x.len());
    let mut buf = Vec::with_capacity(window);
    for i in 0..x.len() {
        let lo = i.saturating_sub(half);
        let hi = (i + half).min(x.len() - 1);
        buf.clear();
        buf.extend_from_slice(&x[lo..=hi]);
        let m = median_of(&mut buf);
        for v in buf.iter_mut() {
            *v = (*v - m).abs();
        }
        med.push(m);
        mad.push(median_of(&mut buf));
    }
    (med, mad)
}

/// Half-saturation z-score of the soft compression `z / (z + Z_HALF)`. Compressing
/// clearly-present onsets toward 1 keeps accented beats (1 and 3) from out-scoring the
/// weaker beats they share a path with, which would bias tracking toward half time,
/// while preserving the peak frame within an onset.
const Z_HALF: f32 = 3.0;
/// Candidates whose normalized path scores are within this relative margin of the best
/// are treated as tied; ties resolve to the faster tempo (at most 210 BPM). Exact
/// metrical multiples of a clean pulse otherwise differ only by integer-lag rounding.
const SCORE_TIE_TOLERANCE: f64 = 0.01;
/// Normalized onset value of `z = Z_HALF`.
const EDGE_ONSET: f32 = 0.5;

/// Robust local normalization to [0, 1): `z = (x - median) / (1.4826 * MAD)` clipped at
/// 0, then `z / (z + Z_HALF)`. A small floor relative to the global maximum keeps
/// silent stretches (MAD = 0) finite.
pub fn robust_normalize(x: &[f32]) -> Vec<f32> {
    if x.is_empty() {
        return Vec::new();
    }
    let (med, mad) = local_median_mad(x, LOCAL_WINDOW);
    let global_max = x.iter().copied().fold(0.0f32, f32::max);
    let floor = 1e-3 * global_max + 1e-12;
    x.iter()
        .zip(med.iter().zip(&mad))
        .map(|(&v, (&m, &d))| {
            let z = ((v - m) / (1.4826 * d + floor)).max(0.0);
            z / (z + Z_HALF)
        })
        .collect()
}

/// Up to 6 strongest autocorrelation local maxima in the 55..220 BPM lag range,
/// as fractional lags (parabolic refinement).
fn tempo_candidates(onset: &[f32], fps: f64) -> Vec<f64> {
    let lag_min = (60.0 * fps / MAX_BPM).ceil() as usize;
    let lag_max = (60.0 * fps / MIN_BPM).floor() as usize;
    if onset.len() <= lag_max + 2 || lag_min < 2 {
        return Vec::new();
    }
    let ac: Vec<f64> = (0..=lag_max + 1)
        .map(|lag| {
            if lag < lag_min - 1 {
                return 0.0;
            }
            let n = onset.len() - lag;
            let s: f64 = (0..n)
                .map(|t| f64::from(onset[t]) * f64::from(onset[t + lag]))
                .sum();
            s / n as f64
        })
        .collect();
    let mut peaks: Vec<(usize, f64)> = (lag_min..=lag_max)
        .filter(|&l| ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > 0.0)
        .map(|l| (l, ac[l]))
        .collect();
    peaks.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    peaks.truncate(CANDIDATES);
    peaks
        .into_iter()
        .map(|(l, _)| {
            let (a, b, c) = (ac[l - 1], ac[l], ac[l + 1]);
            let denom = a - 2.0 * b + c;
            let delta = if denom.abs() > EPSILON {
                (0.5 * (a - c) / denom).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            l as f64 + delta
        })
        .collect()
}

/// Dynamic-programming beat path for one expected period; returns beats and
/// the per-beat normalized path score.
fn beat_path(onset: &[f32], period: f64) -> Option<(Vec<usize>, f64)> {
    let lo = ((1.0 - INTERVAL_TOLERANCE) * period).ceil() as usize;
    let hi = ((1.0 + INTERVAL_TOLERANCE) * period).floor() as usize;
    let n = onset.len();
    if lo == 0 || n <= hi {
        return None;
    }
    let mut score = vec![0.0f64; n];
    let mut back: Vec<Option<usize>> = vec![None; n];
    for t in 0..n {
        let mut best: Option<(f64, usize)> = None;
        if t >= lo {
            let first = t.saturating_sub(hi);
            for (p, &s) in score.iter().enumerate().take(t - lo + 1).skip(first) {
                let ratio = (t - p) as f64 / period;
                let v = s - PENALTY_WEIGHT * ratio.ln().powi(2);
                if best.is_none_or(|(b, _)| v > b) {
                    best = Some((v, p));
                }
            }
        }
        let local = f64::from(onset[t]);
        match best {
            Some((v, p)) => {
                score[t] = local + v;
                back[t] = Some(p);
            }
            None => score[t] = local,
        }
    }
    // Cumulative scores only grow along onsets, so the best end is the last well-supported beat.
    let end = (0..n).fold(0, |b, t| if score[t] > score[b] { t } else { b });
    let mut beats = Vec::new();
    let mut cur = Some(end);
    while let Some(t) = cur {
        beats.push(t);
        cur = back[t];
    }
    beats.reverse();
    // Edge beats over silence or residual noise (onset not clearly present, z < Z_HALF)
    // must not dilute the per-beat score; inner weak beats are kept.
    let first = beats.iter().position(|&b| onset[b] >= EDGE_ONSET)?;
    let last = beats.iter().rposition(|&b| onset[b] >= EDGE_ONSET)?;
    let beats = beats[first..=last].to_vec();
    let penalties: f64 = beats
        .windows(2)
        .map(|w| PENALTY_WEIGHT * ((w[1] - w[0]) as f64 / period).ln().powi(2))
        .sum();
    let rewards: f64 = beats.iter().map(|&b| f64::from(onset[b])).sum();
    let normalized = (rewards - penalties) / beats.len() as f64;
    Some((beats, normalized))
}

fn is_pair(a: f64, b: f64) -> bool {
    let ratio = a.max(b) / a.min(b);
    (ratio - 2.0).abs() <= 2.0 * PAIR_RATIO_TOLERANCE
}

/// Estimates tempo and beats; fails with `NO_STABLE_BEAT` when fewer than 8 beats
/// or no positive-scoring path exists.
pub fn track_beats(onset: &[f32], fps: f64) -> MirResult<BeatTrack> {
    let mut cands: Vec<Candidate> = tempo_candidates(onset, fps)
        .into_iter()
        .filter_map(|lag| {
            let (beats, score) = beat_path(onset, lag)?;
            if beats.len() < MIN_BEATS || !score.is_finite() || score <= 0.0 {
                return None;
            }
            let span = (beats[beats.len() - 1] - beats[0]) as f64;
            let bpm = 60.0 * fps * (beats.len() - 1) as f64 / span;
            Some(Candidate { bpm, beats, score })
        })
        .collect();
    if cands.is_empty() {
        return Err(MirError::NoStableBeat);
    }
    cands.sort_by(|a, b| b.score.total_cmp(&a.score).then(b.bpm.total_cmp(&a.bpm)));
    let top = cands[0].score;
    let best = (0..cands.len())
        .filter(|&i| {
            cands[i].score >= top - SCORE_TIE_TOLERANCE * top.abs()
                && cands[i].bpm <= MAX_PREFERRED_BPM
        })
        .fold(0, |b, i| if cands[i].bpm > cands[b].bpm { i } else { b });
    let mut chosen = best;
    for (i, c) in cands.iter().enumerate().skip(1) {
        if is_pair(cands[best].bpm, c.bpm) {
            let diff = (cands[best].score - c.score).abs();
            if diff <= PAIR_SCORE_TOLERANCE * cands[best].score.abs() {
                let higher = if c.bpm > cands[best].bpm { i } else { best };
                if cands[higher].bpm <= MAX_PREFERRED_BPM {
                    chosen = higher;
                }
            }
            break;
        }
    }
    let chosen_score = cands[chosen].score;
    let second = cands
        .iter()
        .enumerate()
        .filter(|&(i, _)| i != chosen)
        .map(|(_, c)| c.score)
        .fold(f64::NEG_INFINITY, f64::max);
    let confidence = if second.is_finite() {
        ((chosen_score - second) / chosen_score.abs().max(EPSILON)).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let c = cands.swap_remove(chosen);
    Ok(BeatTrack {
        beats: c.beats,
        seconds: None,
        bpm: c.bpm,
        confidence,
    })
}

/// Picks the beat index (0..4) that is beat 1; exact ties go to the lower phase.
pub fn downbeat_phase(beats: &[usize], low_band: &[f32], onset: &[f32]) -> usize {
    let at = |series: &[f32], phase: usize| -> f32 {
        let vals: Vec<f32> = beats
            .iter()
            .enumerate()
            .filter(|(i, _)| i % 4 == phase)
            .map(|(_, &f)| series.get(f).copied().unwrap_or(0.0))
            .collect();
        if vals.is_empty() {
            0.0
        } else {
            vals.iter().sum::<f32>() / vals.len() as f32
        }
    };
    let mut best = 0;
    let mut best_score = f32::NEG_INFINITY;
    for phase in 0..4 {
        let score =
            1.5 * at(low_band, phase) + 1.0 * at(onset, phase) + 0.5 * at(onset, (phase + 2) % 4);
        if score > best_score {
            best_score = score;
            best = phase;
        }
    }
    best
}

/// Scales by the maximum so values lie in [0, 1].
pub fn normalize_max(x: &[f32]) -> Vec<f32> {
    let m = x.iter().copied().fold(0.0f32, f32::max);
    if m > 0.0 {
        x.iter().map(|v| v / m).collect()
    } else {
        vec![0.0; x.len()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{extract_features, Features};
    use crate::synth::{add_clicks, click_track, render, wav_bytes, Voice};

    fn click_features(
        bpm: f32,
        seconds: f32,
        offset: f32,
        first_in_bar: usize,
    ) -> (Features, Vec<f32>) {
        let sr = 44_100;
        let period = 60.0 / bpm;
        let beats = ((seconds - offset - 0.1) / period) as usize;
        let clicks = click_track(bpm, beats, offset, first_in_bar);
        // Quiet sustained pad so the harmonic path is not silent.
        let mut samples = render(&[Voice::sustained(220.0, 0.05, 3)], seconds, sr);
        add_clicks(&mut samples, &clicks, sr);
        let feats = extract_features(&wav_bytes(&[samples], sr, 16)).unwrap();
        (feats, clicks.iter().map(|c| c.time).collect())
    }

    fn track(feats: &Features) -> MirResult<BeatTrack> {
        let onset = robust_normalize(&smooth3(&feats.percussive_flux));
        track_beats(&onset, feats.rhythm_fps)
    }

    #[test]
    fn detects_120_bpm_within_2_bpm_and_50_ms() {
        let (feats, clicks) = click_features(120.0, 12.0, 0.5, 0);
        let bt = track(&feats).unwrap();
        assert!((bt.bpm - 120.0).abs() <= 2.0, "bpm {}", bt.bpm);
        let times: Vec<f64> = bt.beats.iter().map(|&f| feats.rhythm_time(f)).collect();
        for t in times.iter().filter(|&&t| t > 1.0 && t < 11.0) {
            let nearest = clicks
                .iter()
                .map(|&c| (f64::from(c) - t).abs())
                .fold(f64::INFINITY, f64::min);
            assert!(
                nearest <= 0.05,
                "beat {t:.3}s is {nearest:.3}s from a click"
            );
        }
        assert!((0.0..=1.0).contains(&bt.confidence));
    }

    #[test]
    fn detects_186_bpm_not_half_time() {
        let (feats, _) = click_features(186.0, 12.0, 0.3, 0);
        let bt = track(&feats).unwrap();
        assert!((bt.bpm - 186.0).abs() <= 3.0, "bpm {}", bt.bpm);
    }

    #[test]
    fn keeps_72_bpm_instead_of_double_time() {
        let (feats, _) = click_features(72.0, 16.0, 0.4, 0);
        let bt = track(&feats).unwrap();
        assert!((bt.bpm - 72.0).abs() <= 2.0, "bpm {}", bt.bpm);
    }

    #[test]
    fn too_few_beats_is_no_stable_beat() {
        let (feats, _) = click_features(120.0, 3.0, 0.3, 0);
        assert_eq!(track(&feats).err(), Some(MirError::NoStableBeat));
        let silent = vec![0.0f32; 400];
        assert_eq!(
            track_beats(&silent, 86.0).err(),
            Some(MirError::NoStableBeat)
        );
    }

    #[test]
    fn downbeat_phase_follows_accented_beat_one() {
        for first_in_bar in 0..4 {
            let (feats, clicks) = click_features(120.0, 12.0, 0.5, first_in_bar);
            let bt = track(&feats).unwrap();
            let onset = robust_normalize(&smooth3(&feats.percussive_flux));
            let low = normalize_max(&feats.low_band);
            let phase = downbeat_phase(&bt.beats, &low, &onset);
            let t = feats.rhythm_time(bt.beats[phase]);
            // The chosen beat must be a click that carries the kick (bar position 0).
            let idx = clicks
                .iter()
                .enumerate()
                .min_by(|a, b| {
                    (f64::from(*a.1) - t)
                        .abs()
                        .total_cmp(&(f64::from(*b.1) - t).abs())
                })
                .unwrap()
                .0;
            assert_eq!((idx + first_in_bar) % 4, 0, "first_in_bar {first_in_bar}");
        }
    }

    #[test]
    fn pair_policy_prefers_higher_tempo_only_within_limits() {
        assert!(is_pair(93.0, 186.0));
        assert!(is_pair(186.0, 93.5));
        assert!(!is_pair(120.0, 180.0));
    }
}
