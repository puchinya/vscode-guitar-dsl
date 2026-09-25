//! Deterministic median-filter HPSS soft masking on a bounded frame window.
//!
//! Harmonic estimate: median over 17 frames at the same bin (centered, clipped at the
//! song edges). Percussive estimate: median over 17 neighboring bins of the same frame.
//! Only 17 magnitude frames are held at any time.

use std::collections::VecDeque;

pub const HPSS_WIDTH: usize = 17;
const HALF: usize = HPSS_WIDTH / 2;
const EPSILON: f32 = 1e-12;

pub struct HpssFrame {
    /// Frame index in the source STFT.
    pub index: usize,
    pub full: Vec<f32>,
    pub harmonic: Vec<f32>,
    pub percussive: Vec<f32>,
}

pub struct StreamingHpss {
    lo: usize,
    hi: usize,
    frames: VecDeque<Vec<f32>>,
    pushed: usize,
    emitted: usize,
}

fn median(values: &mut [f32]) -> f32 {
    let mid = values.len() / 2;
    let (_, m, _) = values.select_nth_unstable_by(mid, |a, b| a.total_cmp(b));
    *m
}

impl StreamingHpss {
    /// Masks are computed for bins `lo..hi`; other bins are zero in the outputs.
    pub fn new(lo: usize, hi: usize) -> Self {
        StreamingHpss {
            lo,
            hi,
            frames: VecDeque::with_capacity(HPSS_WIDTH),
            pushed: 0,
            emitted: 0,
        }
    }

    /// Pushes the next magnitude frame; returns the frame that now has its full
    /// temporal context (8 frames later), if any.
    pub fn push(&mut self, mag: &[f32]) -> Option<HpssFrame> {
        if self.frames.len() == HPSS_WIDTH {
            self.frames.pop_front();
        }
        self.frames.push_back(mag.to_vec());
        self.pushed += 1;
        if self.pushed > HALF {
            let out = self.compute(self.pushed - 1 - HALF);
            self.emitted += 1;
            Some(out)
        } else {
            None
        }
    }

    /// Emits the trailing frames whose future context is clipped by the song end.
    pub fn flush(&mut self) -> Vec<HpssFrame> {
        let mut out = Vec::new();
        while self.emitted < self.pushed {
            out.push(self.compute(self.emitted));
            self.emitted += 1;
        }
        out
    }

    fn compute(&self, index: usize) -> HpssFrame {
        let first = self.pushed - self.frames.len();
        let start = index.saturating_sub(HALF).max(first);
        let end = (index + HALF).min(self.pushed - 1);
        let center = &self.frames[index - first];
        let nb = center.len();
        let mut harmonic = vec![0.0; nb];
        let mut percussive = vec![0.0; nb];
        let mut tmp = [0.0f32; HPSS_WIDTH];
        let hi = self.hi.min(nb);
        for k in self.lo..hi {
            let mut count = 0;
            for f in start..=end {
                tmp[count] = self.frames[f - first][k];
                count += 1;
            }
            let h = median(&mut tmp[..count]);
            let b0 = k.saturating_sub(HALF);
            let b1 = (k + HALF).min(nb - 1);
            let count = b1 - b0 + 1;
            tmp[..count].copy_from_slice(&center[b0..=b1]);
            let p = median(&mut tmp[..count]);
            let h2 = h * h;
            let p2 = p * p;
            let denom = h2 + p2 + EPSILON;
            harmonic[k] = center[k] * (h2 / denom);
            percussive[k] = center[k] * (p2 / denom);
        }
        HpssFrame {
            index,
            full: center.clone(),
            harmonic,
            percussive,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(frames: &[Vec<f32>], lo: usize, hi: usize) -> Vec<HpssFrame> {
        let mut h = StreamingHpss::new(lo, hi);
        let mut out = Vec::new();
        for f in frames {
            if let Some(fr) = h.push(f) {
                out.push(fr);
            }
        }
        out.extend(h.flush());
        out
    }

    #[test]
    fn emits_every_frame_in_order() {
        let frames: Vec<Vec<f32>> = (0..30).map(|i| vec![i as f32; 40]).collect();
        let out = run(&frames, 0, 40);
        assert_eq!(out.len(), 30);
        for (i, f) in out.iter().enumerate() {
            assert_eq!(f.index, i);
            assert_eq!(f.full[0], i as f32);
        }
    }

    #[test]
    fn steady_tone_is_harmonic_and_click_is_percussive() {
        let nb = 64;
        let mut frames = Vec::new();
        for t in 0..40 {
            let mut f = vec![0.0f32; nb];
            f[20] = 1.0; // sustained partial
            if t == 20 {
                for v in f.iter_mut() {
                    *v += 0.8; // broadband click
                }
            }
            frames.push(f);
        }
        let out = run(&frames, 0, nb);
        let tone = &out[10];
        assert!(tone.harmonic[20] > 0.99);
        assert!(tone.percussive[20] < 0.01);
        let click = &out[20];
        assert!(
            click.percussive[40] > 0.7,
            "click percussive {}",
            click.percussive[40]
        );
        assert!(click.harmonic[40] < 0.1);
        // Masks are a soft partition of the full magnitude.
        for k in 0..nb {
            let sum = click.harmonic[k] + click.percussive[k];
            assert!((sum - click.full[k]).abs() < 1e-4);
        }
    }
}
