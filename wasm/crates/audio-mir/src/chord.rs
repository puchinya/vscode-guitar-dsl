//! Chord classification behind a replaceable `ChordClassifier` seam, plus the
//! 16th-slot Viterbi decoder and short-run suppression.
//!
//! Scores are purely acoustic: no key, scale or progression prior is used.

use crate::chroma::{cosine, Chroma, PITCH_NAMES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Major,
    Minor,
    Dom7,
    Maj7,
    Min7,
    Sus2,
    Sus4,
    Dim,
    Aug,
}

/// Contract order; also the tie-break order.
pub const QUALITIES: [Quality; 9] = [
    Quality::Major,
    Quality::Minor,
    Quality::Dom7,
    Quality::Maj7,
    Quality::Min7,
    Quality::Sus2,
    Quality::Sus4,
    Quality::Dim,
    Quality::Aug,
];

pub const NUM_STATES: usize = 12 * QUALITIES.len();

const W_ROOT: f32 = 1.00;
const W_THIRD: f32 = 0.85;
const W_SUS: f32 = 0.85;
const W_FIFTH: f32 = 0.65;
const W_SEVENTH: f32 = 0.80;
const W_ALTERED_FIFTH: f32 = 0.75;

impl Quality {
    /// `(semitones above root, template weight)`.
    pub fn components(self) -> &'static [(usize, f32)] {
        match self {
            Quality::Major => &[(0, W_ROOT), (4, W_THIRD), (7, W_FIFTH)],
            Quality::Minor => &[(0, W_ROOT), (3, W_THIRD), (7, W_FIFTH)],
            Quality::Dom7 => &[(0, W_ROOT), (4, W_THIRD), (7, W_FIFTH), (10, W_SEVENTH)],
            Quality::Maj7 => &[(0, W_ROOT), (4, W_THIRD), (7, W_FIFTH), (11, W_SEVENTH)],
            Quality::Min7 => &[(0, W_ROOT), (3, W_THIRD), (7, W_FIFTH), (10, W_SEVENTH)],
            Quality::Sus2 => &[(0, W_ROOT), (2, W_SUS), (7, W_FIFTH)],
            Quality::Sus4 => &[(0, W_ROOT), (5, W_SUS), (7, W_FIFTH)],
            Quality::Dim => &[(0, W_ROOT), (3, W_THIRD), (6, W_ALTERED_FIFTH)],
            Quality::Aug => &[(0, W_ROOT), (4, W_THIRD), (8, W_ALTERED_FIFTH)],
        }
    }

    pub fn suffix(self) -> &'static str {
        match self {
            Quality::Major => "",
            Quality::Minor => "m",
            Quality::Dom7 => "7",
            Quality::Maj7 => "maj7",
            Quality::Min7 => "m7",
            Quality::Sus2 => "sus2",
            Quality::Sus4 => "sus4",
            Quality::Dim => "dim",
            Quality::Aug => "aug",
        }
    }
}

/// State index = root * 9 + quality index, so ascending index is the tie-break order.
pub fn state_of(root: usize, quality: Quality) -> usize {
    root * QUALITIES.len() + QUALITIES.iter().position(|&q| q == quality).unwrap()
}

pub fn state_root(state: usize) -> usize {
    state / QUALITIES.len()
}

pub fn state_quality(state: usize) -> Quality {
    QUALITIES[state % QUALITIES.len()]
}

pub fn chord_name(state: usize) -> String {
    format!(
        "{}{}",
        PITCH_NAMES[state_root(state)],
        state_quality(state).suffix()
    )
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChordCandidate {
    pub state: usize,
    pub score: f32,
}

impl ChordCandidate {
    pub fn name(&self) -> String {
        chord_name(self.state)
    }
}

/// Orders by higher score, then lower root, then contract quality order.
pub fn rank(scores: &[f32; NUM_STATES]) -> Vec<ChordCandidate> {
    let mut all: Vec<ChordCandidate> = scores
        .iter()
        .enumerate()
        .map(|(state, &score)| ChordCandidate { state, score })
        .collect();
    all.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.state.cmp(&b.state)));
    all
}

/// Replacement seam for a future learned model: consumes main and bass chroma only.
pub trait ChordClassifier {
    /// Score of every chord state (used as Viterbi emissions).
    fn score_all(&self, chroma: &Chroma, bass_chroma: &Chroma) -> [f32; NUM_STATES];

    /// Top-3 candidates with stable tie ordering.
    fn classify(&self, chroma: &Chroma, bass_chroma: &Chroma) -> Vec<ChordCandidate> {
        let mut ranked = rank(&self.score_all(chroma, bass_chroma));
        ranked.truncate(3);
        ranked
    }
}

/// Seventh evidence gate: a 7 / maj7 / m7 candidate loses up to `lambda` when its
/// seventh is weaker than `theta` times the mean of its triad tones
/// (penalty `lambda * max(0, 1 - ratio / theta)`). Purely acoustic; no key prior.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeventhGate {
    pub theta: f32,
    pub lambda: f32,
}

impl SeventhGate {
    /// Disabled gate (#50 baseline behavior).
    pub const OFF: SeventhGate = SeventhGate {
        theta: 0.0,
        lambda: 0.0,
    };
}

impl Default for SeventhGate {
    fn default() -> Self {
        SeventhGate {
            theta: 0.6,
            lambda: 0.3,
        }
    }
}

pub struct TemplateChordClassifier {
    templates: Vec<Chroma>,
    members: Vec<[bool; 12]>,
    /// `(seventh pitch class, triad pitch classes)` for seventh-quality states.
    sevenths: Vec<Option<(usize, [usize; 3])>>,
    gate: SeventhGate,
}

impl Default for TemplateChordClassifier {
    fn default() -> Self {
        Self::new()
    }
}

impl TemplateChordClassifier {
    pub fn new() -> Self {
        Self::with_gate(SeventhGate::default())
    }

    pub fn with_gate(gate: SeventhGate) -> Self {
        let mut templates = Vec::with_capacity(NUM_STATES);
        let mut members = Vec::with_capacity(NUM_STATES);
        let mut sevenths = Vec::with_capacity(NUM_STATES);
        for root in 0..12 {
            for &q in QUALITIES.iter() {
                let comps = q.components();
                sevenths.push(if comps.len() == 4 {
                    let pc = |i: usize| (root + comps[i].0) % 12;
                    Some((pc(3), [pc(0), pc(1), pc(2)]))
                } else {
                    None
                });
                let mut t = [0.0f32; 12];
                let mut m = [false; 12];
                for &(interval, w) in q.components() {
                    let pc = (root + interval) % 12;
                    t[pc] = w;
                    m[pc] = true;
                }
                let norm = t.iter().map(|x| x * x).sum::<f32>().sqrt();
                for x in t.iter_mut() {
                    *x /= norm;
                }
                templates.push(t);
                members.push(m);
            }
        }
        TemplateChordClassifier {
            templates,
            members,
            sevenths,
            gate,
        }
    }

    fn seventh_penalty(&self, state: usize, chroma: &Chroma) -> f32 {
        let Some((seventh, triad)) = self.sevenths[state] else {
            return 0.0;
        };
        if self.gate.lambda <= 0.0 || self.gate.theta <= 0.0 {
            return 0.0;
        }
        let triad_mean = triad.iter().map(|&p| chroma[p]).sum::<f32>() / 3.0;
        if triad_mean <= 0.0 {
            return 0.0;
        }
        let ratio = chroma[seventh] / triad_mean;
        self.gate.lambda * (1.0 - ratio / self.gate.theta).max(0.0)
    }
}

impl ChordClassifier for TemplateChordClassifier {
    fn score_all(&self, chroma: &Chroma, bass_chroma: &Chroma) -> [f32; NUM_STATES] {
        let mut out = [0.0f32; NUM_STATES];
        for (state, score) in out.iter_mut().enumerate() {
            let cos = cosine(chroma, &self.templates[state]);
            let leak: f32 = (0..12)
                .filter(|&p| !self.members[state][p])
                .map(|p| chroma[p])
                .sum();
            let bass = bass_chroma[state_root(state)];
            *score = cos - 0.15 * leak + 0.10 * bass - self.seventh_penalty(state, chroma);
        }
        out
    }
}

pub const CHANGE_EVIDENCE_THRESHOLD: f32 = 0.20;
const COST_CHANGE_SUPPORTED: f32 = 0.35;
const COST_CHANGE_UNSUPPORTED: f32 = 1.25;
const COST_SAME_ROOT_QUALITY_CHANGE: f32 = 0.15;
const CREDIBLE_MARGIN: f32 = 0.12;

#[derive(Debug, Clone, Copy)]
pub struct SlotFeature {
    pub chroma: Chroma,
    pub bass: Chroma,
}

pub struct ChordDecoding {
    /// Decoded state per 16th slot.
    pub states: Vec<usize>,
    /// Classifier score of every state per slot.
    pub scores: Vec<[f32; NUM_STATES]>,
    /// `top1 - top2` classifier score per slot.
    pub top_margin: Vec<f32>,
    /// `1 - cosine(previous, current)` main chroma; 0 for the first slot.
    pub evidence: Vec<f32>,
}

fn transition_cost(from: usize, to: usize, evidence: f32) -> f32 {
    if from == to {
        return 0.0;
    }
    let mut c = if evidence >= CHANGE_EVIDENCE_THRESHOLD {
        COST_CHANGE_SUPPORTED
    } else {
        COST_CHANGE_UNSUPPORTED
    };
    if state_root(from) == state_root(to) {
        c += COST_SAME_ROOT_QUALITY_CHANGE;
    }
    c
}

fn viterbi(scores: &[[f32; NUM_STATES]], evidence: &[f32]) -> Vec<usize> {
    let t_len = scores.len();
    if t_len == 0 {
        return Vec::new();
    }
    let mut cost: Vec<f32> = scores[0].iter().map(|s| -s).collect();
    let mut back = vec![[0u8; NUM_STATES]; t_len];
    for t in 1..t_len {
        let mut next = vec![0.0f32; NUM_STATES];
        for (s, slot) in next.iter_mut().enumerate() {
            let mut best = f32::INFINITY;
            let mut arg = 0;
            for (r, &c) in cost.iter().enumerate() {
                let v = c + transition_cost(r, s, evidence[t]);
                if v < best {
                    best = v;
                    arg = r;
                }
            }
            *slot = best - scores[t][s];
            back[t][s] = arg as u8;
        }
        cost = next;
    }
    let mut state = (0..NUM_STATES).fold(0, |b, s| if cost[s] < cost[b] { s } else { b });
    let mut path = vec![0usize; t_len];
    for t in (0..t_len).rev() {
        path[t] = state;
        state = back[t][state] as usize;
    }
    path
}

/// `(state, start, len)` runs of equal adjacent states.
pub fn runs(states: &[usize]) -> Vec<(usize, usize, usize)> {
    let mut out: Vec<(usize, usize, usize)> = Vec::new();
    for (t, &s) in states.iter().enumerate() {
        match out.last_mut() {
            Some(last) if last.0 == s => last.2 += 1,
            _ => out.push((s, t, 1)),
        }
    }
    out
}

/// Merges runs shorter than 2 slots unless the change is acoustically credible.
fn suppress_short_runs(states: &mut [usize], scores: &[[f32; NUM_STATES]], evidence: &[f32]) {
    loop {
        let rs = runs(states);
        let mut changed = false;
        for (i, &(state, start, len)) in rs.iter().enumerate() {
            if len >= 2 || rs.len() == 1 {
                continue;
            }
            let end = start + len;
            let mut boundary = Vec::new();
            if start > 0 {
                boundary.push(evidence[start]);
            }
            if end < states.len() {
                boundary.push(evidence[end]);
            }
            let mean_evidence = boundary.iter().sum::<f32>() / boundary.len() as f32;
            let margin = (start..end)
                .map(|t| {
                    let other = (0..NUM_STATES)
                        .filter(|&s| s != state)
                        .map(|s| scores[t][s])
                        .fold(f32::NEG_INFINITY, f32::max);
                    scores[t][state] - other
                })
                .sum::<f32>()
                / len as f32;
            if mean_evidence >= CHANGE_EVIDENCE_THRESHOLD && margin >= CREDIBLE_MARGIN {
                continue;
            }
            let prev = if i > 0 { Some(rs[i - 1].0) } else { None };
            let next = rs.get(i + 1).map(|r| r.0);
            let acc = |s: usize| (start..end).map(|t| scores[t][s]).sum::<f32>();
            let target = match (prev, next) {
                (Some(a), Some(b)) => {
                    if acc(b) > acc(a) {
                        b
                    } else {
                        a
                    }
                }
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) => state,
            };
            for s in states.iter_mut().take(end).skip(start) {
                *s = target;
            }
            changed = true;
            break;
        }
        if !changed {
            break;
        }
    }
}

pub fn decode_chords<C: ChordClassifier>(classifier: &C, slots: &[SlotFeature]) -> ChordDecoding {
    let scores: Vec<[f32; NUM_STATES]> = slots
        .iter()
        .map(|s| classifier.score_all(&s.chroma, &s.bass))
        .collect();
    let top_margin = scores
        .iter()
        .map(|sc| {
            let r = rank(sc);
            r[0].score - r[1].score
        })
        .collect();
    let evidence: Vec<f32> = (0..slots.len())
        .map(|t| {
            if t == 0 {
                0.0
            } else {
                1.0 - cosine(&slots[t - 1].chroma, &slots[t].chroma)
            }
        })
        .collect();
    let mut states = viterbi(&scores, &evidence);
    suppress_short_runs(&mut states, &scores, &evidence);
    ChordDecoding {
        states,
        scores,
        top_margin,
        evidence,
    }
}

/// Acoustic confidence of an emitted chord spanning `slots`.
pub fn event_confidence(top_margin: &[f32]) -> f64 {
    if top_margin.is_empty() {
        return 0.5;
    }
    let mean = top_margin.iter().sum::<f32>() / top_margin.len() as f32;
    f64::from((0.5 + 2.0 * mean).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chroma::l2_normalize;
    use crate::pipeline::{extract_features_with, AnalysisParams};
    use crate::synth::{midi_hz, render, wav_bytes, Voice};

    fn ideal(root: usize, q: Quality) -> SlotFeature {
        let mut c = [0.0f32; 12];
        for &(i, _) in q.components() {
            c[(root + i) % 12] = 1.0;
        }
        l2_normalize(&mut c);
        let mut b = [0.0f32; 12];
        b[root] = 1.0;
        SlotFeature { chroma: c, bass: b }
    }

    fn top(f: &SlotFeature) -> String {
        TemplateChordClassifier::new().classify(&f.chroma, &f.bass)[0].name()
    }

    fn pc(name: &str) -> usize {
        PITCH_NAMES.iter().position(|&p| p == name).unwrap()
    }

    /// Chroma of a synthetic harmonic mixture rendered to audio and analyzed.
    fn audio_feature(root: usize, q: Quality) -> SlotFeature {
        audio_feature_with(root, q, 2, 1.0, &AnalysisParams::default())
    }

    /// Chord rendered with `harmonics` partials (amplitude h^-rolloff) and analyzed with `params`.
    fn audio_feature_with(
        root: usize,
        q: Quality,
        harmonics: usize,
        rolloff: f64,
        params: &AnalysisParams,
    ) -> SlotFeature {
        let mut voices: Vec<Voice> = q
            .components()
            .iter()
            .map(|&(i, _)| {
                // Upper voicing starts at F4 (65) so it stays out of the bass band.
                let mut m = 60 + ((root + i) % 12) as i32;
                if m < 65 {
                    m += 12;
                }
                Voice::sustained(midi_hz(m), 0.2, harmonics).bright(rolloff)
            })
            .collect();
        // Bass in octave 3: below ~100 Hz one 8192-point bin (5.4 Hz) exceeds a semitone.
        voices.push(
            Voice::sustained(midi_hz(48 + root as i32), 0.5, harmonics.min(3)).bright(rolloff),
        );
        let sr = 44_100;
        let bytes = wav_bytes(&[render(&voices, 1.5, sr)], sr, 16);
        let feats = extract_features_with(&bytes, params).unwrap();
        let n = feats.harmony.len();
        let mut c = [0.0f32; 12];
        let mut b = [0.0f32; 12];
        for f in &feats.harmony[n / 4..3 * n / 4] {
            for i in 0..12 {
                c[i] += f.chroma[i];
                b[i] += f.bass[i];
            }
        }
        l2_normalize(&mut c);
        l2_normalize(&mut b);
        SlotFeature { chroma: c, bass: b }
    }

    fn top_with(f: &SlotFeature, params: &AnalysisParams) -> String {
        TemplateChordClassifier::with_gate(params.seventh_gate).classify(&f.chroma, &f.bass)[0]
            .name()
    }

    /// Errors of `params` over 4 roots x 9 qualities rendered with 6 partials of
    /// amplitude h^-rolloff (0.5 is bright, 1.0 is darker).
    fn harmonic_rich_errors(rolloff: f64, params: &AnalysisParams) -> Vec<String> {
        let mut errors = Vec::new();
        for root in [pc("C"), pc("D"), pc("F#"), pc("A")] {
            for &q in QUALITIES.iter() {
                let expected = chord_name(state_of(root, q));
                let got = top_with(&audio_feature_with(root, q, 6, rolloff, params), params);
                if got != expected {
                    errors.push(format!("{expected}>{got}"));
                }
            }
        }
        errors
    }

    /// The 3rd harmonic of a chord's third lands on its major seventh. The #50 baseline
    /// mislabels harmonic-rich triads; overtone peeling and the seventh gate must cut the
    /// errors in every timbre while real seventh chords stay detected.
    #[test]
    fn harmonic_rich_triads_are_not_mislabeled_as_sevenths() {
        for rolloff in [0.5, 0.8, 1.0] {
            let baseline = harmonic_rich_errors(rolloff, &AnalysisParams::BASELINE);
            let shipped = harmonic_rich_errors(rolloff, &AnalysisParams::default());
            eprintln!("rolloff {rolloff}: baseline {baseline:?} shipped {shipped:?}");
            assert!(
                !baseline.is_empty(),
                "rolloff {rolloff}: fixture must reproduce the baseline failure"
            );
            assert!(
                shipped.len() * 2 <= baseline.len() && shipped.len() <= 1,
                "rolloff {rolloff}: baseline {baseline:?} shipped {shipped:?}"
            );
            // Genuine four-note seventh chords must never be lost.
            assert!(
                shipped.iter().all(|e| !e.contains("7>")),
                "rolloff {rolloff}: seventh chord lost {shipped:?}"
            );
        }
    }

    #[test]
    fn seventh_gate_only_penalizes_weak_sevenths() {
        let clf = TemplateChordClassifier::with_gate(SeventhGate {
            theta: 0.5,
            lambda: 0.2,
        });
        let off = TemplateChordClassifier::with_gate(SeventhGate::OFF);
        let full = ideal(pc("D"), Quality::Maj7);
        let dmaj7 = state_of(pc("D"), Quality::Maj7);
        assert_eq!(
            clf.score_all(&full.chroma, &full.bass)[dmaj7],
            off.score_all(&full.chroma, &full.bass)[dmaj7]
        );
        let mut weak = ideal(pc("D"), Quality::Major);
        weak.chroma[pc("C#")] = 0.1;
        let gated = clf.score_all(&weak.chroma, &weak.bass);
        let ungated = off.score_all(&weak.chroma, &weak.bass);
        assert!(gated[dmaj7] < ungated[dmaj7]);
        let d = state_of(pc("D"), Quality::Major);
        assert_eq!(gated[d], ungated[d]);
    }

    #[test]
    fn every_quality_wins_on_ideal_chroma_for_every_root() {
        for root in 0..12 {
            for &q in QUALITIES.iter() {
                let f = ideal(root, q);
                assert_eq!(top(&f), chord_name(state_of(root, q)));
            }
        }
    }

    #[test]
    fn every_quality_wins_on_synthetic_audio_across_roots() {
        for root in [pc("C"), pc("C#"), pc("F#"), pc("A")] {
            for &q in QUALITIES.iter() {
                let f = audio_feature(root, q);
                let expected = chord_name(state_of(root, q));
                assert_eq!(top(&f), expected, "chroma {:?}", f.chroma);
            }
        }
    }

    #[test]
    fn contracted_quality_regressions_are_distinguished() {
        let pairs = [
            ("D", Quality::Major, Quality::Maj7),
            ("F#", Quality::Major, Quality::Sus4),
            ("C#", Quality::Minor, Quality::Dom7),
            ("C", Quality::Major, Quality::Minor),
            ("A", Quality::Minor, Quality::Min7),
        ];
        for (root, a, b) in pairs {
            let r = pc(root);
            let fa = audio_feature(r, a);
            let fb = audio_feature(r, b);
            assert_eq!(top(&fa), chord_name(state_of(r, a)));
            assert_eq!(top(&fb), chord_name(state_of(r, b)));
            assert_ne!(top(&fa), top(&fb));
        }
    }

    #[test]
    fn top3_ordering_is_stable_and_bounded() {
        let clf = TemplateChordClassifier::new();
        let f = ideal(pc("D"), Quality::Maj7);
        let a = clf.classify(&f.chroma, &f.bass);
        let b = clf.classify(&f.chroma, &f.bass);
        assert_eq!(a.len(), 3);
        assert_eq!(a, b);
        assert!(a[0].score >= a[1].score && a[1].score >= a[2].score);
        // Exact ties resolve to lower root, then contract quality order.
        let zero = [0.0f32; 12];
        let tied = clf.classify(&zero, &zero);
        assert_eq!(
            tied.iter().map(|c| c.state).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert!(a.iter().all(|c| c.score.is_finite()));
    }

    #[test]
    fn scores_do_not_depend_on_any_key_context() {
        // F#sus4 is non-diatonic to C major; it must still win when surrounded by C-major chords.
        let clf = TemplateChordClassifier::new();
        let seq = [
            ideal(pc("C"), Quality::Major),
            ideal(pc("C"), Quality::Major),
            ideal(pc("F#"), Quality::Sus4),
            ideal(pc("F#"), Quality::Sus4),
            ideal(pc("G"), Quality::Major),
            ideal(pc("G"), Quality::Major),
        ];
        let isolated = clf.score_all(&seq[2].chroma, &seq[2].bass);
        let d = decode_chords(&clf, &seq);
        assert_eq!(d.scores[2], isolated);
        assert_eq!(chord_name(d.states[2]), "F#sus4");
    }

    #[test]
    fn single_slot_flicker_is_suppressed() {
        let clf = TemplateChordClassifier::new();
        let d_major = ideal(pc("D"), Quality::Major);
        // An ambiguous slot that slightly prefers Dmaj7 (weak C#), with low change evidence.
        let mut blip = d_major;
        blip.chroma[pc("C#")] = 0.45;
        l2_normalize(&mut blip.chroma);
        let mut seq = vec![d_major; 4];
        seq.push(blip);
        seq.extend(vec![d_major; 4]);
        assert_eq!(top(&blip), "Dmaj7", "fixture must actually flicker");
        let d = decode_chords(&clf, &seq);
        assert!(
            d.states.iter().all(|&s| chord_name(s) == "D"),
            "{:?}",
            d.states
        );
    }

    #[test]
    fn two_slot_half_bar_change_survives() {
        let clf = TemplateChordClassifier::new();
        let mut seq = vec![ideal(pc("F#"), Quality::Sus4); 8];
        seq.extend(vec![ideal(pc("F#"), Quality::Minor); 2]);
        let d = decode_chords(&clf, &seq);
        let names: Vec<String> = d.states.iter().map(|&s| chord_name(s)).collect();
        assert_eq!(names[..8], vec!["F#sus4".to_string(); 8][..]);
        assert_eq!(names[8..], vec!["F#m".to_string(); 2][..]);
        let r = runs(&d.states);
        assert_eq!(r[1].1, 8, "change must stay on its 16th boundary");
    }

    #[test]
    fn confidence_is_finite_and_bounded() {
        assert_eq!(event_confidence(&[]), 0.5);
        for m in [-5.0f32, 0.0, 0.1, 0.3, 10.0] {
            let c = event_confidence(&[m, m]);
            assert!(c.is_finite() && (0.0..=1.0).contains(&c));
        }
    }
}
