//! Main (65..4200 Hz) and bass (41..330 Hz) 12-bin chroma from a harmonic magnitude
//! spectrum. These vectors are the replacement seam for a future learned classifier.

use crate::stft::{bin_at_or_above, bin_at_or_below, bin_frequency};

pub const PITCH_NAMES: [&str; 12] = [
    "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
];

pub const MAIN_LO_HZ: f32 = 65.0;
pub const MAIN_HI_HZ: f32 = 4200.0;
pub const BASS_LO_HZ: f32 = 41.0;
pub const BASS_HI_HZ: f32 = 330.0;
const SIGMA_SEMITONES: f32 = 0.25;
const MIN_WEIGHT: f32 = 1e-4;

pub type Chroma = [f32; 12];

struct BinWeights {
    bin: usize,
    weights: Vec<(usize, f32)>,
}

pub struct ChromaMapper {
    main: Vec<BinWeights>,
    bass: Vec<BinWeights>,
}

/// Fractional MIDI pitch of a frequency.
pub fn midi_pitch(hz: f32) -> f32 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

fn pitch_class_weights(hz: f32) -> Vec<(usize, f32)> {
    let midi = midi_pitch(hz);
    let mut out = Vec::new();
    for pc in 0..12 {
        let r = (midi - pc as f32).rem_euclid(12.0);
        let d = r.min(12.0 - r);
        let w = (-0.5 * (d / SIGMA_SEMITONES).powi(2)).exp();
        if w >= MIN_WEIGHT {
            out.push((pc, w));
        }
    }
    out
}

fn band(lo_hz: f32, hi_hz: f32, n_fft: usize, sample_rate: u32) -> Vec<BinWeights> {
    let lo = bin_at_or_above(lo_hz, n_fft, sample_rate).max(1);
    let hi = bin_at_or_below(hi_hz, n_fft, sample_rate);
    (lo..=hi)
        .map(|bin| BinWeights {
            bin,
            weights: pitch_class_weights(bin_frequency(bin, n_fft, sample_rate)),
        })
        .collect()
}

/// L2-normalizes in place when the norm is non-zero.
pub fn l2_normalize(v: &mut Chroma) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

pub fn cosine(a: &Chroma, b: &Chroma) -> f32 {
    let na = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>() / (na * nb)
}

impl ChromaMapper {
    pub fn new(n_fft: usize, sample_rate: u32) -> Self {
        ChromaMapper {
            main: band(MAIN_LO_HZ, MAIN_HI_HZ, n_fft, sample_rate),
            bass: band(BASS_LO_HZ, BASS_HI_HZ, n_fft, sample_rate),
        }
    }

    /// Highest bin the mapper reads (inclusive).
    pub fn max_bin(&self) -> usize {
        self.main
            .iter()
            .chain(self.bass.iter())
            .map(|b| b.bin)
            .max()
            .unwrap_or(0)
    }

    /// Lowest bin the mapper reads.
    pub fn min_bin(&self) -> usize {
        self.main
            .iter()
            .chain(self.bass.iter())
            .map(|b| b.bin)
            .min()
            .unwrap_or(0)
    }

    fn accumulate(bins: &[BinWeights], mag: &[f32]) -> Chroma {
        let mut c = [0.0f32; 12];
        for b in bins {
            let m = mag.get(b.bin).copied().unwrap_or(0.0);
            if m == 0.0 {
                continue;
            }
            for &(pc, w) in &b.weights {
                c[pc] += m * w;
            }
        }
        l2_normalize(&mut c);
        c
    }

    /// Returns `(main, bass)` chroma, each independently L2-normalized.
    pub fn compute(&self, harmonic_mag: &[f32]) -> (Chroma, Chroma) {
        (
            Self::accumulate(&self.main, harmonic_mag),
            Self::accumulate(&self.bass, harmonic_mag),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::extract_features;
    use crate::synth::{midi_hz, render, wav_bytes, Voice};

    fn mean_chroma(voices: &[Voice], seconds: f32) -> (Chroma, Chroma) {
        let sr = 44_100;
        let samples = render(voices, seconds, sr);
        let feats = extract_features(&wav_bytes(&[samples], sr, 16)).unwrap();
        let mut main = [0.0f32; 12];
        let mut bass = [0.0f32; 12];
        let n = feats.harmony.len();
        for f in &feats.harmony[n / 4..3 * n / 4] {
            for i in 0..12 {
                main[i] += f.chroma[i];
                bass[i] += f.bass[i];
            }
        }
        l2_normalize(&mut main);
        l2_normalize(&mut bass);
        (main, bass)
    }

    fn argmax(c: &Chroma) -> usize {
        (0..12).fold(0, |b, i| if c[i] > c[b] { i } else { b })
    }

    #[test]
    fn a4_maps_to_pitch_class_a() {
        let (main, _) = mean_chroma(&[Voice::sustained(440.0, 0.5, 4)], 2.0);
        assert_eq!(PITCH_NAMES[argmax(&main)], "A");
    }

    #[test]
    fn c_major_triad_dominates_c_e_g() {
        let voices: Vec<Voice> = [60, 64, 67]
            .iter()
            .map(|&m| Voice::sustained(midi_hz(m + 12), 0.3, 4))
            .collect();
        let (main, _) = mean_chroma(&voices, 2.0);
        let mut order: Vec<usize> = (0..12).collect();
        order.sort_by(|&a, &b| main[b].total_cmp(&main[a]));
        let mut top3 = order[..3].to_vec();
        top3.sort();
        assert_eq!(top3, vec![0, 4, 7], "chroma {main:?}");
    }

    #[test]
    fn dmaj7_mixture_carries_c_sharp_energy() {
        let voices: Vec<Voice> = [62, 66, 69, 73]
            .iter()
            .map(|&m| Voice::sustained(midi_hz(m + 12), 0.3, 4))
            .collect();
        let (main, _) = mean_chroma(&voices, 2.0);
        // C# (1) must be comparable to chord tones and far above non-chord classes.
        assert!(
            main[1] > 0.5 * main[2],
            "C# {:.3} vs D {:.3}",
            main[1],
            main[2]
        );
        assert!(
            main[1] > 4.0 * main[0],
            "C# {:.3} vs C {:.3}",
            main[1],
            main[0]
        );
    }

    #[test]
    fn low_root_appears_in_bass_chroma() {
        // E2 bass under a G-B-D upper triad: bass chroma must point to E.
        let mut voices: Vec<Voice> = [67, 71, 74]
            .iter()
            .map(|&m| Voice::sustained(midi_hz(m + 12), 0.3, 4))
            .collect();
        voices.push(Voice::sustained(midi_hz(40), 0.6, 2));
        let (main, bass) = mean_chroma(&voices, 2.0);
        assert_eq!(PITCH_NAMES[argmax(&bass)], "E");
        assert_ne!(PITCH_NAMES[argmax(&main)], "E");
    }

    #[test]
    fn normalized_vectors_have_unit_norm() {
        let mut c = [0.0f32; 12];
        c[3] = 2.0;
        c[7] = 2.0;
        l2_normalize(&mut c);
        let norm: f32 = c.iter().map(|x| x * x).sum();
        assert!((norm - 1.0).abs() < 1e-6);
        let mut z = [0.0f32; 12];
        l2_normalize(&mut z);
        assert!(z.iter().all(|&x| x == 0.0));
    }
}
