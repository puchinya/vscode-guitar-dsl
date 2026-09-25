//! Bounded rolling STFT: holds exactly one FFT window of samples and emits one
//! magnitude frame per hop. Frames start at sample 0 without padding; frame `k`
//! covers samples `[k*hop, k*hop + n)` and is timestamped at its center.

use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

pub const HARMONY_FFT: usize = 8192;
pub const HARMONY_HOP: usize = 1024;
pub const RHYTHM_FFT: usize = 2048;
pub const RHYTHM_HOP: usize = 512;

pub struct RollingStft {
    n: usize,
    hop: usize,
    window: Vec<f32>,
    ring: Vec<f32>,
    write: usize,
    total: u64,
    fft: Arc<dyn Fft<f32>>,
    buf: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    mag: Vec<f32>,
    scale: f32,
}

/// Periodic Hann window.
pub fn hann(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / n as f32).cos())
        .collect()
}

/// Center timestamp (seconds) of frame `index`.
pub fn frame_center_seconds(index: usize, n: usize, hop: usize, sample_rate: u32) -> f64 {
    (index * hop + n / 2) as f64 / f64::from(sample_rate)
}

/// Frequency (Hz) of FFT bin `k`.
pub fn bin_frequency(k: usize, n: usize, sample_rate: u32) -> f32 {
    k as f32 * sample_rate as f32 / n as f32
}

/// Smallest bin index whose frequency is >= `hz`.
pub fn bin_at_or_above(hz: f32, n: usize, sample_rate: u32) -> usize {
    (hz * n as f32 / sample_rate as f32).ceil() as usize
}

/// Largest bin index whose frequency is <= `hz`.
pub fn bin_at_or_below(hz: f32, n: usize, sample_rate: u32) -> usize {
    (hz * n as f32 / sample_rate as f32).floor() as usize
}

impl RollingStft {
    /// `max_bin` is the exclusive upper bin of the returned magnitude slice.
    /// The FFT plan comes from a planner shared by one analysis invocation.
    pub fn new(planner: &mut FftPlanner<f32>, n: usize, hop: usize, max_bin: usize) -> Self {
        let fft = planner.plan_fft_forward(n);
        let scratch = vec![Complex::new(0.0, 0.0); fft.get_inplace_scratch_len()];
        let window = hann(n);
        // A full-scale sinusoid centered on a bin yields magnitude ~= its amplitude.
        let scale = 2.0 / window.iter().sum::<f32>();
        RollingStft {
            n,
            hop,
            window,
            ring: vec![0.0; n],
            write: 0,
            total: 0,
            fft,
            buf: vec![Complex::new(0.0, 0.0); n],
            scratch,
            mag: vec![0.0; max_bin.min(n / 2 + 1)],
            scale,
        }
    }

    /// Pushes one sample; returns the magnitude spectrum when a frame completes.
    pub fn push(&mut self, x: f32) -> Option<&[f32]> {
        self.ring[self.write] = x;
        self.write = (self.write + 1) % self.n;
        self.total += 1;
        let n = self.n as u64;
        if self.total < n || !(self.total - n).is_multiple_of(self.hop as u64) {
            return None;
        }
        // After the increment `write` points at the oldest sample.
        for i in 0..self.n {
            let s = self.ring[(self.write + i) % self.n];
            self.buf[i] = Complex::new(s * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buf, &mut self.scratch);
        for (k, m) in self.mag.iter_mut().enumerate() {
            *m = self.buf[k].norm() * self.scale;
        }
        Some(&self.mag)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames_for(samples: &[f32], n: usize, hop: usize, max_bin: usize) -> Vec<Vec<f32>> {
        let mut planner = FftPlanner::new();
        let mut stft = RollingStft::new(&mut planner, n, hop, max_bin);
        let mut out = Vec::new();
        for &x in samples {
            if let Some(m) = stft.push(x) {
                out.push(m.to_vec());
            }
        }
        out
    }

    #[test]
    fn emits_one_frame_per_hop_after_first_window() {
        let samples = vec![0.0f32; 4096 + 512 * 3];
        let frames = frames_for(&samples, 2048, 512, 100);
        // frames at starts 0, 512, ..., 2048+1536 => (5632-2048)/512 + 1 = 8
        assert_eq!(frames.len(), 8);
        assert_eq!(frames[0].len(), 100);
    }

    #[test]
    fn sine_peaks_at_expected_bin_with_unit_amplitude() {
        let sr = 44_100u32;
        let f = 1000.0f32;
        let samples: Vec<f32> = (0..8192)
            .map(|i| (2.0 * PI * f * i as f32 / sr as f32).sin())
            .collect();
        let frames = frames_for(&samples, 2048, 512, 1025);
        let m = &frames[0];
        let (peak, val) =
            m.iter().enumerate().fold(
                (0, 0.0f32),
                |acc, (k, &v)| if v > acc.1 { (k, v) } else { acc },
            );
        let expected = (f * 2048.0 / sr as f32).round() as usize;
        assert!(
            peak.abs_diff(expected) <= 1,
            "peak bin {peak} vs {expected}"
        );
        assert!(val > 0.6 && val < 1.1, "peak magnitude {val}");
    }

    #[test]
    fn frame_timestamps_are_monotonic_for_both_rates() {
        for sr in [44_100u32, 48_000] {
            let mut prev = -1.0;
            for k in 0..50 {
                let t = frame_center_seconds(k, HARMONY_FFT, HARMONY_HOP, sr);
                assert!(t > prev);
                let expected = (k * HARMONY_HOP + HARMONY_FFT / 2) as f64 / f64::from(sr);
                assert!((t - expected).abs() < 1e-12);
                prev = t;
            }
            let step = frame_center_seconds(1, RHYTHM_FFT, RHYTHM_HOP, sr)
                - frame_center_seconds(0, RHYTHM_FFT, RHYTHM_HOP, sr);
            assert!((step - RHYTHM_HOP as f64 / f64::from(sr)).abs() < 1e-12);
        }
    }
}
