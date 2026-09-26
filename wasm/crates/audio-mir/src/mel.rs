//! Beat This! model input (#56): streaming resampling to 22,050 Hz and the upstream
//! `LogMelSpect` (torchaudio `MelSpectrogram`: periodic Hann 1024 / hop 441, centered with
//! reflect padding, `frame_length` normalization, magnitude, 128 Slaney mel bands
//! 30..11,000 Hz without filter normalization, then `ln(1 + 1000 x)`).

use std::f64::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

use crate::stft::hann;

pub const MODEL_RATE: u32 = 22_050;
pub const MEL_FFT: usize = 1024;
pub const MEL_HOP: usize = 441;
pub const N_MELS: usize = 128;
/// Model frames per second (22,050 / 441).
pub const MODEL_FPS: f64 = 50.0;
const F_MIN: f64 = 30.0;
const F_MAX: f64 = 11_000.0;
const LOG_MULTIPLIER: f32 = 1000.0;

/// Cutoff (-6 dB point) as a fraction of the output Nyquist frequency: the middle of
/// soxr's default transition band (passband end 0.913, stopband at 1.0).
const RESAMPLE_ROLLOFF: f64 = 0.9565;
/// Sinc zero crossings on each side of the kernel center; sets a transition band of
/// about 9% of the output Nyquist frequency like soxr (the model's top mel band ends at
/// 11 kHz, right below the 11,025 Hz Nyquist frequency).
const RESAMPLE_ZEROS: f64 = 64.0;
const KAISER_BETA: f64 = 9.0;

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// Zeroth-order modified Bessel function of the first kind (power series).
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..64 {
        term *= q / (k * k) as f64;
        sum += term;
        if term < 1e-12 * sum {
            break;
        }
    }
    sum
}

/// Deterministic polyphase windowed-sinc resampler from `in_rate` to 22,050 Hz
/// (Kaiser window). Output sample `n` sits at input time `n * in_rate / 22050`; samples
/// before the start and after the end are zero.
pub struct Resampler {
    up: u64,
    down: u64,
    half: usize,
    /// `phases[p][k]` weights input `i - half + 1 + k` for output phase `p` (`i` = floor time).
    phases: Vec<Vec<f32>>,
    input: Vec<f32>,
    /// Absolute index of `input[0]`.
    base: u64,
    total_in: u64,
    next_out: u64,
}

impl Resampler {
    pub fn new(in_rate: u32) -> Self {
        let g = gcd(u64::from(in_rate), u64::from(MODEL_RATE));
        let up = u64::from(MODEL_RATE) / g;
        let down = u64::from(in_rate) / g;
        // Cutoff relative to the input rate; never above the input Nyquist frequency.
        let w = (RESAMPLE_ROLLOFF * f64::from(MODEL_RATE) / f64::from(in_rate)).min(1.0);
        let half = (RESAMPLE_ZEROS / w).ceil() as usize;
        let taps = 2 * half;
        let phases = (0..up)
            .map(|p| {
                let frac = p as f64 / up as f64;
                let mut h: Vec<f64> = (0..taps)
                    .map(|k| {
                        let tau = (k as f64 - half as f64 + 1.0) - frac;
                        let x = w * tau;
                        let sinc = if x.abs() < 1e-12 {
                            1.0
                        } else {
                            (PI * x).sin() / (PI * x)
                        };
                        let r = tau / half as f64;
                        let win = if r.abs() >= 1.0 {
                            0.0
                        } else {
                            bessel_i0(KAISER_BETA * (1.0 - r * r).sqrt()) / bessel_i0(KAISER_BETA)
                        };
                        w * sinc * win
                    })
                    .collect();
                let sum: f64 = h.iter().sum();
                for v in h.iter_mut() {
                    *v /= sum;
                }
                h.into_iter().map(|v| v as f32).collect()
            })
            .collect();
        Resampler {
            up,
            down,
            half,
            phases,
            input: Vec::new(),
            base: 0,
            total_in: 0,
            next_out: 0,
        }
    }

    fn sample(&self, abs: i64) -> f32 {
        if abs < self.base as i64 {
            0.0
        } else {
            self.input
                .get((abs - self.base as i64) as usize)
                .copied()
                .unwrap_or(0.0)
        }
    }

    fn emit<F: FnMut(f32)>(&mut self, limit: u64, out: &mut F) {
        let lead = self.half as i64 - 1;
        while self.next_out < limit {
            let pos = self.next_out * self.down;
            let i = (pos / self.up) as i64;
            let p = (pos % self.up) as usize;
            // The kernel needs inputs up to `i + half`; wait for them unless flushing.
            if i + self.half as i64 >= self.total_in as i64 && limit == u64::MAX {
                break;
            }
            let first = i - lead;
            let kernel = &self.phases[p];
            let offset = first - self.base as i64;
            let y: f32 = if offset >= 0 && offset as usize + kernel.len() <= self.input.len() {
                let window = &self.input[offset as usize..offset as usize + kernel.len()];
                kernel.iter().zip(window).map(|(h, x)| h * x).sum()
            } else {
                kernel
                    .iter()
                    .enumerate()
                    .map(|(k, &h)| h * self.sample(first + k as i64))
                    .sum()
            };
            out(y);
            self.next_out += 1;
        }
        // Drop inputs no longer reachable by the next output's kernel.
        let next_i = (self.next_out * self.down / self.up) as i64;
        let keep_from = (next_i - lead).max(0) as u64;
        if keep_from > self.base + 4096 {
            let drop = (keep_from - self.base) as usize;
            self.input.drain(..drop);
            self.base = keep_from;
        }
    }

    pub fn push<F: FnMut(f32)>(&mut self, x: f32, out: &mut F) {
        self.input.push(x);
        self.total_in += 1;
        self.emit(u64::MAX, out);
    }

    /// Emits the remaining `ceil(total_in * 22050 / in_rate)` outputs.
    pub fn flush<F: FnMut(f32)>(&mut self, out: &mut F) {
        let total_out = (self.total_in * self.up).div_ceil(self.down);
        // Zeros past the end: all inputs are known now.
        self.total_in = u64::MAX / 4;
        self.emit(total_out, out);
    }
}

fn hz_to_mel_slaney(f: f64) -> f64 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f64.ln() / 27.0;
    if f >= min_log_hz {
        min_log_mel + (f / min_log_hz).ln() / logstep
    } else {
        f / f_sp
    }
}

fn mel_to_hz_slaney(m: f64) -> f64 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f64.ln() / 27.0;
    if m >= min_log_mel {
        min_log_hz * (logstep * (m - min_log_mel)).exp()
    } else {
        f_sp * m
    }
}

/// torchaudio `melscale_fbanks(n_fft/2+1, 30, 11000, 128, 22050, norm=None, "slaney")`,
/// stored per mel band as `(first_bin, weights)`.
fn mel_filterbank() -> Vec<(usize, Vec<f32>)> {
    let n_freqs = MEL_FFT / 2 + 1;
    let nyquist = f64::from(MODEL_RATE) / 2.0;
    let freqs: Vec<f64> = (0..n_freqs)
        .map(|k| nyquist * k as f64 / (n_freqs - 1) as f64)
        .collect();
    let (m_min, m_max) = (hz_to_mel_slaney(F_MIN), hz_to_mel_slaney(F_MAX));
    let pts: Vec<f64> = (0..N_MELS + 2)
        .map(|i| mel_to_hz_slaney(m_min + (m_max - m_min) * i as f64 / (N_MELS + 1) as f64))
        .collect();
    (0..N_MELS)
        .map(|j| {
            let weights: Vec<f64> = freqs
                .iter()
                .map(|&f| {
                    let down = (f - pts[j]) / (pts[j + 1] - pts[j]);
                    let up = (pts[j + 2] - f) / (pts[j + 2] - pts[j + 1]);
                    down.min(up).max(0.0)
                })
                .collect();
            let first = weights.iter().position(|&w| w > 0.0).unwrap_or(0);
            let last = weights.iter().rposition(|&w| w > 0.0).unwrap_or(0);
            (
                first,
                weights[first..=last.max(first)]
                    .iter()
                    .map(|&w| w as f32)
                    .collect(),
            )
        })
        .collect()
}

/// Streaming log-mel frames of a 22,050 Hz signal. Frame `k` is centered on sample
/// `k * 441`; the signal is reflect-padded by 512 samples at both ends, so a signal of
/// `n` samples yields `1 + n / 441` frames (`n` must exceed 512, otherwise none).
pub struct LogMel {
    window: Vec<f32>,
    fft: Arc<dyn Fft<f32>>,
    buf: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    fbank: Vec<(usize, Vec<f32>)>,
    samples: Vec<f32>,
    /// Absolute index of `samples[0]`.
    base: usize,
    /// First 513 samples, kept for the start reflection.
    head: Vec<f32>,
    total: usize,
    next_frame: usize,
    frames: Vec<f32>,
}

impl LogMel {
    pub fn new(planner: &mut FftPlanner<f32>) -> Self {
        let fft = planner.plan_fft_forward(MEL_FFT);
        let scratch = vec![Complex::new(0.0, 0.0); fft.get_inplace_scratch_len()];
        LogMel {
            window: hann(MEL_FFT),
            fft,
            buf: vec![Complex::new(0.0, 0.0); MEL_FFT],
            scratch,
            fbank: mel_filterbank(),
            samples: Vec::new(),
            base: 0,
            head: Vec::with_capacity(MEL_FFT / 2 + 1),
            total: 0,
            next_frame: 0,
            frames: Vec::new(),
        }
    }

    /// Sample at absolute index `i` of the reflect-padded signal (end reflection only
    /// once `total` is final).
    fn at(&self, i: i64) -> f32 {
        let n = self.total as i64;
        let j = if i < 0 {
            -i
        } else if i >= n {
            2 * (n - 1) - i
        } else {
            i
        };
        let j = j as usize;
        if j < self.head.len() && j < self.base {
            self.head[j]
        } else {
            self.samples[j - self.base]
        }
    }

    fn frame(&mut self, k: usize) {
        let start = (k * MEL_HOP) as i64 - (MEL_FFT / 2) as i64;
        for i in 0..MEL_FFT {
            let x = self.at(start + i as i64);
            self.buf[i] = Complex::new(x * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buf, &mut self.scratch);
        // torch.stft(normalized=True) scales by 1 / sqrt(n_fft).
        let norm = 1.0 / (MEL_FFT as f32).sqrt();
        for (first, weights) in &self.fbank {
            let mut acc = 0.0f64;
            for (w, c) in weights.iter().zip(&self.buf[*first..]) {
                acc += f64::from(*w) * f64::from(c.norm() * norm);
            }
            self.frames.push((1.0 + LOG_MULTIPLIER * acc as f32).ln());
        }
    }

    pub fn push(&mut self, x: f32) {
        if self.head.len() <= MEL_FFT / 2 {
            self.head.push(x);
        }
        self.samples.push(x);
        self.total += 1;
        // Frame k needs samples up to k*441 + 511 (and the head for the start reflection).
        while self.next_frame * MEL_HOP + MEL_FFT / 2 < self.total && self.total > MEL_FFT / 2 + 1 {
            self.frame(self.next_frame);
            self.next_frame += 1;
        }
        let keep_from = (self.next_frame * MEL_HOP).saturating_sub(MEL_FFT / 2 + 1);
        if keep_from > self.base + 8192 {
            self.samples.drain(..keep_from - self.base);
            self.base = keep_from;
        }
    }

    /// Emits the remaining frames and returns all frames, row-major `[frames][128]`.
    pub fn finish(mut self) -> Vec<f32> {
        if self.total > MEL_FFT / 2 {
            let count = 1 + self.total / MEL_HOP;
            while self.next_frame < count {
                self.frame(self.next_frame);
                self.next_frame += 1;
            }
        }
        self.frames
    }
}

/// Resampler plus log-mel, fed with the normalized mono samples of the WAV pass.
pub struct ModelInput {
    resampler: Option<Resampler>,
    mel: LogMel,
}

impl ModelInput {
    pub fn new(planner: &mut FftPlanner<f32>, sample_rate: u32) -> Self {
        ModelInput {
            resampler: (sample_rate != MODEL_RATE).then(|| Resampler::new(sample_rate)),
            mel: LogMel::new(planner),
        }
    }

    pub fn push(&mut self, x: f32) {
        let mel = &mut self.mel;
        match &mut self.resampler {
            Some(r) => r.push(x, &mut |y| mel.push(y)),
            None => mel.push(x),
        }
    }

    pub fn finish(mut self) -> Vec<f32> {
        if let Some(r) = &mut self.resampler {
            let mel = &mut self.mel;
            r.flush(&mut |y| mel.push(y));
        }
        self.mel.finish()
    }
}

/// The export script's generated signal (see `scripts/export-beat-this-onnx.py`).
#[cfg(test)]
pub fn test_signal(sr: u32) -> Vec<f32> {
    let seconds = 6.0f64;
    let n = (f64::from(sr) * seconds) as usize;
    let mut x: Vec<f64> = (0..n)
        .map(|i| {
            let t = i as f64 / f64::from(sr);
            0.3 * (2.0 * PI * (110.0 * t + 0.5 * (880.0 - 110.0) / seconds * t * t)).sin()
        })
        .collect();
    for k in 0..(seconds * 2.0) as usize {
        let start = (k as f64 * 0.5 * f64::from(sr)) as usize;
        let len = (n - start).min((0.03 * f64::from(sr)) as usize);
        for j in 0..len {
            let jf = j as f64;
            x[start + j] += 0.6
                * (-jf / (0.004 * f64::from(sr))).exp()
                * (2.0 * PI * 2000.0 * jf / f64::from(sr)).sin();
        }
    }
    x.into_iter().map(|v| v as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/beat_this_reference.json")).unwrap()
    }

    /// First mel band whose upper edge exceeds soxr's passband end (0.913 x 11,025 Hz).
    const TRANSITION_BAND: usize = 124;

    fn mel_of(sr: u32) -> Vec<f32> {
        let mut planner = FftPlanner::new();
        let mut input = ModelInput::new(&mut planner, sr);
        for x in test_signal(sr) {
            input.push(x);
        }
        input.finish()
    }

    /// Maximum absolute difference over the given rows, restricted to `bands`.
    fn max_row_diff(
        frames: &[f32],
        rows: &serde_json::Value,
        bands: std::ops::Range<usize>,
    ) -> f32 {
        let mut worst = 0.0f32;
        for (idx, row) in rows.as_object().unwrap() {
            let i: usize = idx.parse().unwrap();
            for (j, v) in row.as_array().unwrap().iter().enumerate() {
                if bands.contains(&j) {
                    let d = (frames[i * N_MELS + j] - v.as_f64().unwrap() as f32).abs();
                    worst = worst.max(d);
                }
            }
        }
        worst
    }

    #[test]
    fn log_mel_matches_torchaudio_at_model_rate() {
        let fx = reference();
        let frames = mel_of(MODEL_RATE);
        assert_eq!(
            frames.len() / N_MELS,
            fx["frames"].as_u64().unwrap() as usize
        );
        let d = max_row_diff(&frames, &fx["mel_rows"], 0..N_MELS);
        assert!(d <= 1e-3, "max log-mel difference {d}");
    }

    #[test]
    fn resampled_log_mel_is_close_to_soxr_reference() {
        let fx = reference();
        for sr in [44_100u32, 48_000] {
            let r = &fx["resampled"][sr.to_string()];
            let frames = mel_of(sr);
            assert_eq!(
                frames.len() / N_MELS,
                r["frames"].as_u64().unwrap() as usize
            );
            // Below ~10 kHz both resamplers pass the signal unchanged; the top bands lie
            // in the anti-alias transition band, whose exact shape differs from soxr's.
            let pass = max_row_diff(&frames, &r["mel_rows"], 0..TRANSITION_BAND);
            assert!(pass <= 0.02, "{sr} Hz: passband log-mel difference {pass}");
            let top = max_row_diff(&frames, &r["mel_rows"], TRANSITION_BAND..N_MELS);
            assert!(
                top <= 0.15,
                "{sr} Hz: transition-band log-mel difference {top}"
            );
        }
    }

    #[test]
    fn short_signal_has_no_frames() {
        let mut planner = FftPlanner::new();
        let mut mel = LogMel::new(&mut planner);
        for _ in 0..512 {
            mel.push(0.1);
        }
        assert!(mel.finish().is_empty());
    }
}
