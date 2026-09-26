//! Main (65..4200 Hz) and bass (41..330 Hz) 12-bin chroma from a harmonic magnitude
//! spectrum. These vectors are the replacement seam for a future learned classifier.
//!
//! The spectrum is first mapped to semitones (MIDI 28..108). Overtones are then peeled
//! greedily from low to high pitch before folding into pitch classes, so the 3rd harmonic
//! of a chord's third is not mistaken for its major seventh.

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
/// Semitone spectrum range: E1 (41.2 Hz) .. C8 (4186 Hz).
const MIDI_LO: i32 = 28;
const MIDI_HI: i32 = 108;
const N_PITCHES: usize = (MIDI_HI - MIDI_LO + 1) as usize;
/// `(harmonic number, semitones above the fundamental)` peeled for every pitch.
const OVERTONES: [(i32, usize); 5] = [(2, 12), (3, 19), (4, 24), (5, 28), (6, 31)];

pub type Chroma = [f32; 12];

/// Overtone peeling: each selected harmonic `h` of pitch `p` is assumed to carry
/// `alpha * gamma^(h-1) * s[p]` and is subtracted from the pitch it lands on.
/// `alpha = 0` reproduces the plain (#50 baseline) chroma.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChromaParams {
    pub overtone_alpha: f32,
    pub overtone_gamma: f32,
    /// Harmonics peeled, as a bit set: bit `h - 2` for harmonic `h` in 2..=6
    /// (default [`HARMONICS_3_5_6`]).
    pub peel_mask: u8,
}

/// Peel harmonics 3, 5 and 6: the harmonics that land on a different pitch class (a
/// fifth or a major third above). Octave harmonics (2, 4) carry the same pitch class,
/// so peeling them only weakens that class (typically the root doubled by the bass).
/// Selected by `examples/tune_harmony.rs` on the tune splits (Issue #52).
pub const HARMONICS_3_5_6: u8 = 0b1_1010;

impl ChromaParams {
    pub const BASELINE: ChromaParams = ChromaParams {
        overtone_alpha: 0.0,
        overtone_gamma: 0.0,
        peel_mask: 0,
    };
}

impl Default for ChromaParams {
    fn default() -> Self {
        ChromaParams {
            overtone_alpha: 0.6,
            overtone_gamma: 0.7,
            peel_mask: HARMONICS_3_5_6,
        }
    }
}

struct BinWeights {
    bin: usize,
    /// `(pitch index, weight)` into the semitone spectrum, or `(pitch class, weight)` in
    /// the #50 direct fold.
    weights: Vec<(usize, f32)>,
}

enum Folding {
    /// #50 behavior, used when peeling is disabled: each band's bins fold directly into
    /// pitch classes (bands selected by bin frequency).
    Direct {
        main: Vec<BinWeights>,
        bass: Vec<BinWeights>,
    },
    /// Semitone spectrum -> overtone peeling -> fold (bands selected by pitch center).
    Peeled {
        bins: Vec<BinWeights>,
        main: (usize, usize),
        bass: (usize, usize),
        peel: [f32; OVERTONES.len()],
    },
}

pub struct ChromaMapper {
    folding: Folding,
    /// Bin range read from the spectrum; identical to #50 in both modes.
    read_lo: usize,
    read_hi: usize,
}

/// Fractional MIDI pitch of a frequency.
pub fn midi_pitch(hz: f32) -> f32 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

fn midi_hz(midi: i32) -> f32 {
    440.0 * 2f32.powf((midi - 69) as f32 / 12.0)
}

/// #50 pitch-class weights: Gaussian on the circular distance to the pitch class.
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

/// #50 band: bins whose frequency lies within `[lo_hz, hi_hz]`.
fn direct_band(lo_hz: f32, hi_hz: f32, n_fft: usize, sample_rate: u32) -> Vec<BinWeights> {
    let lo = bin_at_or_above(lo_hz, n_fft, sample_rate).max(1);
    let hi = bin_at_or_below(hi_hz, n_fft, sample_rate);
    (lo..=hi)
        .map(|bin| BinWeights {
            bin,
            weights: pitch_class_weights(bin_frequency(bin, n_fft, sample_rate)),
        })
        .collect()
}

fn pitch_weights(hz: f32) -> Vec<(usize, f32)> {
    let midi = midi_pitch(hz);
    (MIDI_LO..=MIDI_HI)
        .filter_map(|p| {
            let d = midi - p as f32;
            let w = (-0.5 * (d / SIGMA_SEMITONES).powi(2)).exp();
            (w >= MIN_WEIGHT).then_some(((p - MIDI_LO) as usize, w))
        })
        .collect()
}

/// Inclusive pitch-index range whose center frequencies lie within `[lo_hz, hi_hz]`.
fn pitch_range(lo_hz: f32, hi_hz: f32) -> (usize, usize) {
    let lo = (MIDI_LO..=MIDI_HI)
        .find(|&p| midi_hz(p) >= lo_hz)
        .unwrap_or(MIDI_LO);
    let hi = (MIDI_LO..=MIDI_HI)
        .rev()
        .find(|&p| midi_hz(p) <= hi_hz)
        .unwrap_or(MIDI_HI);
    ((lo - MIDI_LO) as usize, (hi - MIDI_LO) as usize)
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
    pub fn new(n_fft: usize, sample_rate: u32, params: ChromaParams) -> Self {
        let main_band = direct_band(MAIN_LO_HZ, MAIN_HI_HZ, n_fft, sample_rate);
        let bass_band = direct_band(BASS_LO_HZ, BASS_HI_HZ, n_fft, sample_rate);
        let read_lo = main_band
            .iter()
            .chain(bass_band.iter())
            .map(|b| b.bin)
            .min()
            .unwrap_or(0);
        let read_hi = main_band
            .iter()
            .chain(bass_band.iter())
            .map(|b| b.bin)
            .max()
            .unwrap_or(0);
        let mut peel = [0.0f32; OVERTONES.len()];
        for (k, &(h, _)) in OVERTONES.iter().enumerate() {
            if params.peel_mask & (1 << (h - 2)) != 0 {
                peel[k] = params.overtone_alpha * params.overtone_gamma.powi(h - 1);
            }
        }
        let folding = if peel.iter().all(|&c| c <= 0.0) {
            Folding::Direct {
                main: main_band,
                bass: bass_band,
            }
        } else {
            Folding::Peeled {
                bins: (read_lo..=read_hi)
                    .map(|bin| BinWeights {
                        bin,
                        weights: pitch_weights(bin_frequency(bin, n_fft, sample_rate)),
                    })
                    .filter(|b| !b.weights.is_empty())
                    .collect(),
                main: pitch_range(MAIN_LO_HZ, MAIN_HI_HZ),
                bass: pitch_range(BASS_LO_HZ, BASS_HI_HZ),
                peel,
            }
        };
        ChromaMapper {
            folding,
            read_lo,
            read_hi,
        }
    }

    /// Highest bin the mapper reads (inclusive).
    pub fn max_bin(&self) -> usize {
        self.read_hi
    }

    /// Lowest bin the mapper reads.
    pub fn min_bin(&self) -> usize {
        self.read_lo
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

    /// Semitone spectrum after greedy low-to-high overtone peeling.
    fn semitones(
        bins: &[BinWeights],
        peel: &[f32; OVERTONES.len()],
        mag: &[f32],
    ) -> [f32; N_PITCHES] {
        let mut s = [0.0f32; N_PITCHES];
        for b in bins {
            let m = mag.get(b.bin).copied().unwrap_or(0.0);
            if m == 0.0 {
                continue;
            }
            for &(p, w) in &b.weights {
                s[p] += m * w;
            }
        }
        for p in 0..N_PITCHES {
            let base = s[p];
            if base <= 0.0 {
                continue;
            }
            for (k, &(_, offset)) in OVERTONES.iter().enumerate() {
                if let Some(v) = s.get_mut(p + offset) {
                    *v = (*v - peel[k] * base).max(0.0);
                }
            }
        }
        s
    }

    fn fold(s: &[f32; N_PITCHES], (lo, hi): (usize, usize)) -> Chroma {
        let mut c = [0.0f32; 12];
        for (p, &v) in s.iter().enumerate().take(hi + 1).skip(lo) {
            c[(p + MIDI_LO as usize) % 12] += v;
        }
        l2_normalize(&mut c);
        c
    }

    /// Returns `(main, bass)` chroma, each independently L2-normalized.
    pub fn compute(&self, harmonic_mag: &[f32]) -> (Chroma, Chroma) {
        match &self.folding {
            Folding::Direct { main, bass } => (
                Self::accumulate(main, harmonic_mag),
                Self::accumulate(bass, harmonic_mag),
            ),
            Folding::Peeled {
                bins,
                main,
                bass,
                peel,
            } => {
                let s = Self::semitones(bins, peel, harmonic_mag);
                (Self::fold(&s, *main), Self::fold(&s, *bass))
            }
        }
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

    /// Verbatim copy of the #50 (PR #51) mapper, frozen as the reference for
    /// `ChromaParams::BASELINE`.
    mod pr51 {
        use super::super::{l2_normalize, midi_pitch, Chroma};
        use crate::stft::{bin_at_or_above, bin_at_or_below, bin_frequency};

        pub struct BinWeights {
            pub bin: usize,
            pub weights: Vec<(usize, f32)>,
        }

        fn pitch_class_weights(hz: f32) -> Vec<(usize, f32)> {
            let midi = midi_pitch(hz);
            let mut out = Vec::new();
            for pc in 0..12 {
                let r = (midi - pc as f32).rem_euclid(12.0);
                let d = r.min(12.0 - r);
                let w = (-0.5 * (d / 0.25f32).powi(2)).exp();
                if w >= 1e-4 {
                    out.push((pc, w));
                }
            }
            out
        }

        pub fn band(lo_hz: f32, hi_hz: f32, n_fft: usize, sample_rate: u32) -> Vec<BinWeights> {
            let lo = bin_at_or_above(lo_hz, n_fft, sample_rate).max(1);
            let hi = bin_at_or_below(hi_hz, n_fft, sample_rate);
            (lo..=hi)
                .map(|bin| BinWeights {
                    bin,
                    weights: pitch_class_weights(bin_frequency(bin, n_fft, sample_rate)),
                })
                .collect()
        }

        pub fn accumulate(bins: &[BinWeights], mag: &[f32]) -> Chroma {
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
    }

    #[test]
    fn baseline_params_reproduce_the_pr51_mapper_exactly() {
        for sr in [44_100u32, 48_000] {
            let n = crate::stft::HARMONY_FFT;
            let mapper = ChromaMapper::new(n, sr, ChromaParams::BASELINE);
            let main = pr51::band(MAIN_LO_HZ, MAIN_HI_HZ, n, sr);
            let bass = pr51::band(BASS_LO_HZ, BASS_HI_HZ, n, sr);
            let lo = main.iter().chain(bass.iter()).map(|b| b.bin).min().unwrap();
            let hi = main.iter().chain(bass.iter()).map(|b| b.bin).max().unwrap();
            assert_eq!((mapper.min_bin(), mapper.max_bin()), (lo, hi));
            let mut seed = 0x9E37_79B9u32;
            for _ in 0..20 {
                let mag: Vec<f32> = (0..=hi + 20)
                    .map(|_| {
                        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                        (seed >> 8) as f32 / (1u32 << 24) as f32
                    })
                    .collect();
                let (m, b) = mapper.compute(&mag);
                assert_eq!(m, pr51::accumulate(&main, &mag));
                assert_eq!(b, pr51::accumulate(&bass, &mag));
            }
        }
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
