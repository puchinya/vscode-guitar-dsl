//! Strum attack detection, per-measure 8 / 12 / 16 grid selection and quantization.
//! Down/up direction is not inferred here; the TypeScript adapter assigns it from slots.

use crate::tempo::{local_median_mad, LOCAL_WINDOW};

pub const GRIDS: [u8; 3] = [8, 12, 16];
const COMPLEXITY: [f32; 3] = [0.00, 0.03, 0.05];
const MAX_SLOT_DISTANCE: f32 = 0.20;
const MISS_WEIGHT: f32 = 0.20;
const SWITCH_COST: f32 = 0.08;
const ONSET_MAD_FACTOR: f32 = 1.5;
const ACCENT_MAD_FACTOR: f32 = 1.0;
pub const MIN_ATTACK_GAP_SECONDS: f64 = 0.040;
/// Numerical floor relative to the song's maximum flux, so that tiny positive
/// fluctuations inside silence (median = MAD = 0) are not accepted as attacks.
const NOISE_FLOOR_RATIO: f32 = 0.02;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Attack {
    pub time: f64,
    /// Peak flux divided by the song maximum, in [0, 1].
    pub strength: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QuantizedAttack {
    pub slot: u8,
    pub strength: f32,
    pub accent: bool,
}

/// Local maxima of harmonic flux above `median + 1.5 * MAD`, at least 40 ms apart.
pub fn detect_attacks(flux: &[f32], frame_time: impl Fn(usize) -> f64) -> Vec<Attack> {
    if flux.len() < 3 {
        return Vec::new();
    }
    let (med, mad) = local_median_mad(flux, LOCAL_WINDOW);
    let max = flux.iter().copied().fold(0.0f32, f32::max);
    if max <= 0.0 {
        return Vec::new();
    }
    let floor = NOISE_FLOOR_RATIO * max;
    let mut out: Vec<Attack> = Vec::new();
    for t in 1..flux.len() - 1 {
        let v = flux[t];
        if !(v > flux[t - 1] && v >= flux[t + 1]) {
            continue;
        }
        if v <= med[t] + ONSET_MAD_FACTOR * mad[t] || v <= floor {
            continue;
        }
        let time = frame_time(t);
        if let Some(prev) = out.last() {
            if time - prev.time < MIN_ATTACK_GAP_SECONDS {
                continue;
            }
        }
        out.push(Attack {
            time,
            strength: v / max,
        });
    }
    out
}

/// Beat times of one measure: `beats[0]` is the downbeat, `beats[4]` the next downbeat.
pub type MeasureBeats = [f64; 5];

/// Attack position in slot units from the measure start for `grid` slots per bar.
pub fn slot_position(beats: &MeasureBeats, t: f64, grid: u8) -> f64 {
    let per_beat = f64::from(grid) / 4.0;
    if t < beats[0] {
        return (t - beats[0]) / (beats[1] - beats[0]) * per_beat;
    }
    let j = (0..4).rev().find(|&j| t >= beats[j]).unwrap_or(0);
    j as f64 * per_beat + (t - beats[j]) / (beats[j + 1] - beats[j]) * per_beat
}

/// Attacks belonging to a measure: from 1/8 beat before its downbeat to 1/8 beat
/// before the next downbeat (so a slightly early attack lands on slot 0).
pub fn assign_to_measures(measures: &[MeasureBeats], attacks: &[Attack]) -> Vec<Vec<Attack>> {
    measures
        .iter()
        .map(|b| {
            let start = b[0] - 0.125 * (b[1] - b[0]);
            let end = b[4] - 0.125 * (b[4] - b[3]);
            attacks
                .iter()
                .filter(|a| a.time >= start && a.time < end)
                .copied()
                .collect()
        })
        .collect()
}

fn nearest(beats: &MeasureBeats, a: &Attack, grid: u8) -> (i64, f32) {
    let u = slot_position(beats, a.time, grid);
    let n = u.round();
    (n as i64, (u - n).abs() as f32)
}

/// Local cost of explaining a measure's attacks with a grid.
pub fn grid_cost(beats: &MeasureBeats, attacks: &[Attack], grid_index: usize) -> f32 {
    let grid = GRIDS[grid_index];
    let complexity = COMPLEXITY[grid_index];
    if attacks.is_empty() {
        return complexity;
    }
    let mut weighted = 0.0;
    let mut weight = 0.0;
    let mut misses = 0;
    for a in attacks {
        let (_, d) = nearest(beats, a, grid);
        weighted += a.strength * d;
        weight += a.strength;
        if d > MAX_SLOT_DISTANCE {
            misses += 1;
        }
    }
    let timing = if weight > 0.0 { weighted / weight } else { 0.0 };
    let miss_rate = misses as f32 / attacks.len() as f32;
    timing + MISS_WEIGHT * miss_rate + complexity
}

/// Song-level dynamic programming over per-measure grid costs.
pub fn choose_subdivisions(measures: &[MeasureBeats], attacks: &[Vec<Attack>]) -> Vec<u8> {
    let n = measures.len();
    if n == 0 {
        return Vec::new();
    }
    let local: Vec<[f32; 3]> = (0..n)
        .map(|m| [0, 1, 2].map(|g| grid_cost(&measures[m], &attacks[m], g)))
        .collect();
    let mut cost = local[0];
    let mut back = vec![[0usize; 3]; n];
    for m in 1..n {
        let mut next = [0.0f32; 3];
        for g in 0..3 {
            let mut best = f32::INFINITY;
            for (p, &c) in cost.iter().enumerate() {
                let v = c + if p == g { 0.0 } else { SWITCH_COST };
                if v < best {
                    best = v;
                    back[m][g] = p;
                }
            }
            next[g] = best + local[m][g];
        }
        cost = next;
    }
    let mut g = (0..3).fold(0, |b, i| if cost[i] < cost[b] { i } else { b });
    let mut out = vec![0u8; n];
    for m in (0..n).rev() {
        out[m] = GRIDS[g];
        g = back[m][g];
    }
    out
}

fn median(v: &mut [f32]) -> f32 {
    let mid = v.len() / 2;
    let (_, m, _) = v.select_nth_unstable_by(mid, |a, b| a.total_cmp(b));
    *m
}

/// Quantizes attacks within 0.20 slot of a grid slot; one attack per slot (strongest).
pub fn quantize(beats: &MeasureBeats, attacks: &[Attack], grid: u8) -> Vec<QuantizedAttack> {
    let mut by_slot: Vec<Option<f32>> = vec![None; grid as usize];
    for a in attacks {
        let (slot, d) = nearest(beats, a, grid);
        if d > MAX_SLOT_DISTANCE || slot < 0 || slot >= i64::from(grid) {
            continue;
        }
        let cell = &mut by_slot[slot as usize];
        if cell.is_none_or(|s| a.strength > s) {
            *cell = Some(a.strength);
        }
    }
    let mut out: Vec<QuantizedAttack> = by_slot
        .iter()
        .enumerate()
        .filter_map(|(slot, s)| {
            s.map(|strength| QuantizedAttack {
                slot: slot as u8,
                strength,
                accent: false,
            })
        })
        .collect();
    if !out.is_empty() {
        let mut strengths: Vec<f32> = out.iter().map(|q| q.strength).collect();
        let med = median(&mut strengths);
        for s in strengths.iter_mut() {
            *s = (*s - med).abs();
        }
        let mad = median(&mut strengths);
        for q in out.iter_mut() {
            q.accent = q.strength > med + ACCENT_MAD_FACTOR * mad;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEATS: MeasureBeats = [1.0, 1.5, 2.0, 2.5, 3.0];

    fn at(slots: &[f64], grid: f64, strength: f32) -> Vec<Attack> {
        slots
            .iter()
            .map(|&s| Attack {
                time: 1.0 + s * 2.0 / grid,
                strength,
            })
            .collect()
    }

    fn best_grid(attacks: &[Attack]) -> u8 {
        choose_subdivisions(&[BEATS], &[attacks.to_vec()])[0]
    }

    #[test]
    fn eighth_pattern_selects_8() {
        let a = at(&[0.0, 2.0, 3.0, 5.0, 6.0, 7.0], 8.0, 0.6);
        assert_eq!(best_grid(&a), 8);
    }

    #[test]
    fn sixteenth_pattern_selects_16() {
        let a = at(&[0.0, 3.0, 6.0, 7.0, 10.0, 13.0, 15.0], 16.0, 0.6);
        assert_eq!(best_grid(&a), 16);
    }

    #[test]
    fn triplet_pattern_selects_12() {
        let a = at(&[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 7.0, 8.0, 10.0], 12.0, 0.6);
        assert_eq!(best_grid(&a), 12);
    }

    #[test]
    fn empty_measure_prefers_simplest_grid() {
        assert_eq!(best_grid(&[]), 8);
    }

    #[test]
    fn syncopated_attacks_quantize_to_expected_slots_with_jitter() {
        // 16th syncopation: slots 0, 3, 6, 10, 11 with +-12 ms jitter.
        let slots = [0.0, 3.0, 6.0, 10.0, 11.0];
        let jitter = [0.012, -0.010, 0.008, -0.012, 0.011];
        let a: Vec<Attack> = slots
            .iter()
            .zip(jitter)
            .map(|(&s, j)| Attack {
                time: 1.0 + s * 2.0 / 16.0 + j,
                strength: 0.5,
            })
            .collect();
        let q = quantize(&BEATS, &a, 16);
        assert_eq!(
            q.iter().map(|x| x.slot).collect::<Vec<_>>(),
            vec![0, 3, 6, 10, 11]
        );
    }

    #[test]
    fn duplicate_attacks_keep_the_strongest() {
        let a = vec![
            Attack {
                time: 1.25,
                strength: 0.3,
            },
            Attack {
                time: 1.26,
                strength: 0.9,
            },
            Attack {
                time: 1.24,
                strength: 0.5,
            },
        ];
        let q = quantize(&BEATS, &a, 8);
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].slot, 1);
        assert_eq!(q[0].strength, 0.9);
    }

    #[test]
    fn off_grid_attack_is_not_quantized() {
        // 0.5 of an eighth slot away from any slot.
        let a = vec![Attack {
            time: 1.0 + 0.75 * 0.25,
            strength: 0.5,
        }];
        assert!(quantize(&BEATS, &a, 8).is_empty());
    }

    #[test]
    fn accent_marks_only_the_strong_attack() {
        let mut a = at(&[0.0, 1.0, 2.0, 3.0], 8.0, 0.3);
        a[2].strength = 1.0;
        let q = quantize(&BEATS, &a, 8);
        let accents: Vec<bool> = q.iter().map(|x| x.accent).collect();
        assert_eq!(accents, vec![false, false, true, false]);
    }

    #[test]
    fn slightly_early_downbeat_attack_belongs_to_the_measure() {
        let m = [BEATS, [3.0, 3.5, 4.0, 4.5, 5.0]];
        let a = vec![Attack {
            time: 2.98,
            strength: 0.5,
        }];
        let per = assign_to_measures(&m, &a);
        assert!(per[0].is_empty());
        assert_eq!(quantize(&m[1], &per[1], 8)[0].slot, 0);
    }

    #[test]
    fn detects_peaks_above_local_threshold_and_min_gap() {
        let mut flux = vec![0.0f32; 400];
        for &t in &[50usize, 100, 102, 200, 300] {
            flux[t] = 1.0;
        }
        flux[102] = 0.8;
        // 86 frames/s: frames 100 and 102 are 23 ms apart, so 102 is dropped.
        let attacks = detect_attacks(&flux, |t| t as f64 / 86.0);
        let frames: Vec<usize> = attacks
            .iter()
            .map(|a| (a.time * 86.0).round() as usize)
            .collect();
        assert_eq!(frames, vec![50, 100, 200, 300]);
        assert!(attacks.iter().all(|a| (0.0..=1.0).contains(&a.strength)));
    }
}
