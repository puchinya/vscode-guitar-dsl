//! End-to-end synthetic pipeline tests (generated audio only).

use crate::beat_nn::BeatModel;
use crate::chroma::PITCH_NAMES;
use crate::error::MirError;
use crate::mel::N_MELS;
use crate::pipeline::{analyze, analyze_to_json, analyze_with, AnalysisParams, BeatTracker};
use crate::synth::{add_clicks, click_track, midi_hz, render, wav_bytes, Voice};
use crate::Analysis;

const SR: u32 = 44_100;
const BPM: f32 = 120.0;
const BEAT: f32 = 60.0 / BPM;
const BAR: f32 = 4.0 * BEAT;
/// Two pickup beats (bar positions 3 and 4) before the first complete measure.
const PICKUP_START: f32 = 0.5;
const FIRST_BAR: f32 = PICKUP_START + 2.0 * BEAT;

struct Segment {
    root: &'static str,
    /// Chord tones as semitones above the root.
    tones: &'static [i32],
    start_tick16: u32,
    end_tick16: u32,
}

struct Bar {
    segments: Vec<Segment>,
    grid: u32,
    slots: &'static [u32],
}

fn pc(name: &str) -> i32 {
    PITCH_NAMES.iter().position(|&p| p == name).unwrap() as i32
}

fn seg(root: &'static str, tones: &'static [i32], start_tick16: u32, end_tick16: u32) -> Segment {
    Segment {
        root,
        tones,
        start_tick16,
        end_tick16,
    }
}

/// `| Dmaj7 | C#m7 | F#sus4 F#m |` twice, with eighth / sixteenth strum patterns.
/// Every beat carries a strum (percussion clicks on beats also leak into harmonic flux).
fn progression() -> Vec<Bar> {
    let mut bars = Vec::new();
    for _ in 0..2 {
        bars.push(Bar {
            segments: vec![seg("D", &[0, 4, 7, 11], 0, 16)],
            grid: 8,
            slots: &[0, 2, 3, 4, 6, 7],
        });
        bars.push(Bar {
            segments: vec![seg("C#", &[0, 3, 7, 10], 0, 16)],
            grid: 16,
            slots: &[0, 3, 4, 7, 8, 11, 12, 15],
        });
        bars.push(Bar {
            segments: vec![seg("F#", &[0, 5, 7], 0, 8), seg("F#", &[0, 3, 7], 8, 16)],
            grid: 8,
            slots: &[0, 2, 4, 5, 6],
        });
    }
    bars
}

/// Ascending voicing from octave 5 with at least 3 semitones between neighbors.
/// Closer intervals beat inside the 2048-point rhythm STFT main lobe and produce
/// spurious harmonic flux (a documented PoC limitation), which this fixture avoids.
fn spread_voicing(root: i32, tones: &[i32]) -> Vec<i32> {
    let mut out: Vec<i32> = Vec::new();
    for &t in tones {
        let mut m = 72 + (root + t) % 12;
        if let Some(&prev) = out.last() {
            while m < prev + 3 {
                m += 12;
            }
        }
        out.push(m);
    }
    out
}

fn render_song() -> Vec<u8> {
    let bars = progression();
    let seconds = FIRST_BAR + bars.len() as f32 * BAR + 1.2;
    let mut voices = Vec::new();
    for (i, bar) in bars.iter().enumerate() {
        let bar_start = FIRST_BAR + i as f32 * BAR;
        let attacks: Vec<f32> = bar
            .slots
            .iter()
            .map(|&s| bar_start + s as f32 * BAR / bar.grid as f32)
            .collect();
        for seg in &bar.segments {
            let s = bar_start + seg.start_tick16 as f32 * BAR / 16.0;
            let e = bar_start + seg.end_tick16 as f32 * BAR / 16.0;
            let seg_attacks: Vec<f32> = attacks
                .iter()
                .copied()
                .filter(|&a| a >= s && a < e)
                .collect();
            let root = pc(seg.root);
            for m in spread_voicing(root, seg.tones) {
                voices.push(
                    Voice::sustained(midi_hz(m), 0.12, 1)
                        .span(s, e)
                        .strummed(seg_attacks.clone(), 0.35),
                );
            }
            voices.push(Voice::sustained(midi_hz(48 + root), 0.04, 2).span(s, e));
        }
    }
    let mut samples = render(&voices, seconds, SR);
    let beats = ((seconds - PICKUP_START - 0.3) / BEAT) as usize;
    add_clicks(&mut samples, &click_track(BPM, beats, PICKUP_START, 2), SR);
    wav_bytes(&[samples], SR, 16)
}

#[test]
fn synthetic_song_end_to_end() {
    let bytes = render_song();
    let result = analyze(&bytes).expect("analysis succeeds");
    assert_eq!(result.version, 1);
    assert_eq!(result.source.sample_rate, SR);
    assert!(
        (result.tempo.bpm - f64::from(BPM)).abs() <= 2.0,
        "bpm {}",
        result.tempo.bpm
    );
    assert!(!result.measures.is_empty());

    // The first complete measure starts at the first accented downbeat; pickups are trimmed.
    let first = &result.measures[0];
    assert!(
        (first.start_seconds - f64::from(FIRST_BAR)).abs() < 0.06,
        "first bar at {}",
        first.start_seconds
    );
    assert!((result.trim.start_seconds - first.start_seconds).abs() < 1e-9);

    let expected_chords = [
        vec![(0u8, "Dmaj7")],
        vec![(0, "C#m7")],
        vec![(0, "F#sus4"), (8, "F#m")],
    ];
    let expected_grids = [8u8, 16, 8];
    let expected_slots: [&[u8]; 3] = [
        &[0, 2, 3, 4, 6, 7],
        &[0, 3, 4, 7, 8, 11, 12, 15],
        &[0, 2, 4, 5, 6],
    ];
    let n = result.measures.len().min(6);
    assert!(
        n >= 5,
        "expected at least 5 complete measures, got {}",
        result.measures.len()
    );
    for (m, measure) in result.measures.iter().take(n).enumerate() {
        let got: Vec<(u8, &str)> = measure
            .chords
            .iter()
            .map(|c| (c.tick16, c.name.as_str()))
            .collect();
        assert_eq!(got, expected_chords[m % 3], "measure {m} chords");
        // Attack positions in 48ths of a measure do not depend on the chosen grid.
        let at48 = |slots: &[u8], grid: u8| -> Vec<u32> {
            slots
                .iter()
                .map(|&s| u32::from(s) * 48 / u32::from(grid))
                .collect()
        };
        let slots: Vec<u8> = measure.attacks.iter().map(|a| a.slot).collect();
        assert_eq!(
            at48(&slots, measure.subdivision),
            at48(expected_slots[m % 3], expected_grids[m % 3]),
            "measure {m} attack positions"
        );
        // The song-level grid DP may keep the previous grid on the last analyzed measure
        // when both grids fit its attacks (switch-cost boundary effect).
        if m + 1 < n {
            assert_eq!(
                measure.subdivision,
                expected_grids[m % 3],
                "measure {m} grid"
            );
            assert_eq!(slots, expected_slots[m % 3], "measure {m} attack slots");
        }
        for c in &measure.chords {
            assert!((0.0..=1.0).contains(&c.confidence));
        }
    }
    let json = result.to_json().unwrap();
    assert!(json.starts_with("{\"version\":1,"));
}

#[test]
fn analysis_is_deterministic() {
    let bytes = render_song();
    assert_eq!(analyze(&bytes).unwrap(), analyze(&bytes).unwrap());
}

#[test]
fn silence_has_no_stable_beat() {
    let bytes = wav_bytes(&[vec![0.0f32; SR as usize * 6]], SR, 16);
    assert_eq!(analyze(&bytes).err(), Some(MirError::NoStableBeat));
}

#[test]
fn invalid_bytes_are_rejected_not_panicking() {
    assert_eq!(analyze(b"garbage").err(), Some(MirError::InvalidWav));
}

fn classic(params: AnalysisParams) -> AnalysisParams {
    AnalysisParams {
        beat_tracker: BeatTracker::Classic,
        ..params
    }
}

#[test]
fn classic_tracker_reproduces_issue_52_output() {
    // Golden JSON produced by the #52 build (main @ 86dc629) for the same song.
    let bytes = render_song();
    // Identical apart from the `tempo.tracker` field added by #56.
    let without_tracker = |params: &AnalysisParams| {
        let result = analyze_with(&bytes, params).unwrap();
        assert_eq!(result.tempo.tracker, "classic");
        let mut v: serde_json::Value = serde_json::from_str(&result.to_json().unwrap()).unwrap();
        v["tempo"].as_object_mut().unwrap().remove("tracker");
        v
    };
    let golden = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap();
    assert_eq!(
        without_tracker(&AnalysisParams::BASELINE),
        golden(include_str!("../tests/fixtures/classic_song_baseline.json"))
    );
    assert_eq!(
        without_tracker(&classic(AnalysisParams::default())),
        golden(include_str!("../tests/fixtures/classic_song_52.json"))
    );
}

/// Runs the staged API the extension uses (chunks inferred by separate model instances,
/// completed out of order) and returns the result JSON.
fn staged_json(bytes: &[u8]) -> Result<String, MirError> {
    let mut analysis = Analysis::from_bytes(bytes)?;
    let count = analysis.chunk_count();
    let chunks: Vec<Vec<f32>> = (0..count)
        .map(|i| analysis.chunk_at(i))
        .collect::<Result<_, _>>()?;
    analysis.release_input();
    analysis.extract_with(bytes)?;
    let mut logits = vec![Vec::new(); count];
    for i in (0..count).rev() {
        let model = BeatModel::new(chunks[i].len() / N_MELS)?;
        logits[i] = model.infer(&chunks[i])?;
    }
    analysis.finish_with(&logits.concat())
}

#[test]
fn staged_api_matches_single_call_analysis() {
    let bytes = render_song();
    assert_eq!(
        staged_json(&bytes).unwrap(),
        analyze_to_json(&bytes).unwrap()
    );
}

#[test]
fn staged_api_matches_single_call_across_several_chunks() {
    // 70 s of drumless strumming: three chunks, the last one shifted to the end.
    let bytes = drumless_song(100.0, 70.0);
    let analysis = Analysis::from_bytes(&bytes).unwrap();
    assert_eq!(analysis.chunk_count(), 3);
    assert_eq!(
        staged_json(&bytes).unwrap(),
        analyze_to_json(&bytes).unwrap()
    );
}

#[test]
fn finish_rejects_malformed_logits() {
    let bytes = render_song();
    let mut analysis = Analysis::from_bytes(&bytes).unwrap();
    assert_eq!(
        analysis.finish_with(&[]).err(),
        Some(MirError::AnalysisFailed),
        "finish before extract"
    );
    analysis.extract_with(&bytes).unwrap();
    let frames: usize = (0..analysis.chunk_count())
        .map(|i| analysis.chunk_at(i).unwrap().len() / N_MELS)
        .sum();
    let mut logits = vec![0.0f32; frames];
    assert_eq!(
        analysis.finish_with(&logits[1..]).err(),
        Some(MirError::AnalysisFailed)
    );
    logits[3] = f32::NAN;
    assert_eq!(
        analysis.finish_with(&logits).err(),
        Some(MirError::AnalysisFailed)
    );
    // All-negative logits have no beats at all: the classic tracker takes over.
    let silent = vec![-5.0f32; frames];
    let fallback: serde_json::Value =
        serde_json::from_str(&analysis.finish_with(&silent).unwrap()).unwrap();
    assert_eq!(fallback["tempo"]["tracker"], "classic");
    let neural: serde_json::Value =
        serde_json::from_str(&analyze_to_json(&bytes).unwrap()).unwrap();
    assert_eq!(neural["tempo"]["tracker"], "neural");
}

/// Solo strumming without percussion: down-strums on every beat (bright, louder) and
/// quieter up-strums on the off-beat eighths of a different voicing; the chord changes
/// every bar (C - Am - F - G).
fn drumless_song(bpm: f32, seconds: f32) -> Vec<u8> {
    let beat = 60.0 / bpm;
    let bar = 4.0 * beat;
    let lead = 0.4f32;
    let chords: [&[i32]; 4] = [
        &[48, 55, 60, 64],
        &[45, 52, 57, 60],
        &[41, 48, 53, 57],
        &[43, 50, 55, 59],
    ];
    let mut voices = Vec::new();
    let bars = ((seconds - lead - 0.5) / bar) as usize;
    for b in 0..bars {
        let s = lead + b as f32 * bar;
        let e = s + bar;
        let downs: Vec<f32> = (0..4).map(|k| s + k as f32 * beat).collect();
        let ups: Vec<f32> = (0..4).map(|k| s + (k as f32 + 0.5) * beat).collect();
        for &m in chords[b % 4] {
            voices.push(
                Voice::sustained(midi_hz(m), 0.08, 4)
                    .bright(0.8)
                    .span(s, e)
                    .strummed(downs.clone(), 0.25),
            );
            voices.push(
                Voice::sustained(midi_hz(m + 12), 0.03, 3)
                    .span(s, e)
                    .strummed(ups.clone(), 0.15),
            );
        }
    }
    wav_bytes(&[render(&voices, seconds, SR)], SR, 16)
}

#[test]
fn drumless_strumming_is_tracked_at_the_played_tempo() {
    for bpm in [90.0f32, 150.0] {
        let bytes = drumless_song(bpm, 16.0);
        let result = analyze(&bytes).expect("analysis succeeds");
        let rel = result.tempo.bpm / f64::from(bpm) - 1.0;
        assert!(
            rel.abs() <= 0.03,
            "{bpm} BPM tracked as {:.2}",
            result.tempo.bpm
        );
    }
}
