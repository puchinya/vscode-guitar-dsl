//! Krumhansl-Schmuckler key estimate from total harmonic chroma.
//! Metadata only: never fed back into chord classification or decoding.

use crate::chroma::{Chroma, PITCH_NAMES};

const MAJOR_PROFILE: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

fn pearson(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let ma = a.iter().sum::<f32>() / 12.0;
    let mb = b.iter().sum::<f32>() / 12.0;
    let mut num = 0.0;
    let mut da = 0.0;
    let mut db = 0.0;
    for i in 0..12 {
        let x = a[i] - ma;
        let y = b[i] - mb;
        num += x * y;
        da += x * x;
        db += y * y;
    }
    if da == 0.0 || db == 0.0 {
        return 0.0;
    }
    num / (da.sqrt() * db.sqrt())
}

/// Returns the canonical key name (`C`..`B`, `Cm`..`Bm`) and a [0, 1] confidence
/// (the winning correlation, clipped). Ties go to the first key in major-then-minor order.
pub fn estimate_key(total: &Chroma) -> (String, f64) {
    let mut best_name = String::from("C");
    let mut best = f32::NEG_INFINITY;
    for (profile, suffix) in [(&MAJOR_PROFILE, ""), (&MINOR_PROFILE, "m")] {
        for tonic in 0..12 {
            let mut rotated = [0.0f32; 12];
            for (pc, r) in rotated.iter_mut().enumerate() {
                *r = profile[(pc + 12 - tonic) % 12];
            }
            let r = pearson(total, &rotated);
            if r > best {
                best = r;
                best_name = format!("{}{}", PITCH_NAMES[tonic], suffix);
            }
        }
    }
    (best_name, f64::from(best.clamp(0.0, 1.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scale(tonic: usize, intervals: &[usize], weights: &[f32]) -> Chroma {
        let mut c = [0.0f32; 12];
        for (i, &iv) in intervals.iter().enumerate() {
            c[(tonic + iv) % 12] += weights[i];
        }
        c
    }

    #[test]
    fn estimates_major_and_minor_keys() {
        let major = [0, 2, 4, 5, 7, 9, 11];
        let w = [3.0, 1.0, 2.0, 1.0, 2.5, 1.0, 1.0];
        let (name, conf) = estimate_key(&scale(2, &major, &w));
        assert_eq!(name, "D");
        assert!(conf > 0.5 && conf <= 1.0);

        let minor = [0, 2, 3, 5, 7, 8, 10];
        let (name, _) = estimate_key(&scale(9, &minor, &w));
        assert_eq!(name, "Am");
    }

    #[test]
    fn uses_canonical_flat_spellings() {
        let major = [0, 2, 4, 5, 7, 9, 11];
        let w = [3.0, 1.0, 2.0, 1.0, 2.5, 1.0, 1.0];
        assert_eq!(estimate_key(&scale(3, &major, &w)).0, "Eb");
        assert_eq!(estimate_key(&scale(10, &major, &w)).0, "Bb");
    }

    #[test]
    fn silent_input_is_finite() {
        let (name, conf) = estimate_key(&[0.0; 12]);
        assert_eq!(name, "C");
        assert_eq!(conf, 0.0);
    }
}
