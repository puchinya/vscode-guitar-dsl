//! End-to-end analysis: one streaming feature pass, then tempo / downbeat / chord /
//! rhythm / key decoding over the retained time-series features.

use rustfft::FftPlanner;

use crate::chord::{
    chord_name, decode_chords, event_confidence, SeventhGate, SlotFeature, TemplateChordClassifier,
};
use crate::chroma::{l2_normalize, Chroma, ChromaMapper, ChromaParams};
use crate::error::{MirError, MirResult};
use crate::hpss::{HpssFrame, StreamingHpss, HPSS_WIDTH};
use crate::key::estimate_key;
use crate::result::{
    AttackResult, AudioMirResultV1, ChordResult, KeyInfo, MeasureResult, SourceInfo, TempoInfo,
    TrimInfo,
};
use crate::rhythm::{
    assign_to_measures, choose_subdivisions, detect_attacks, quantize, MeasureBeats,
};
use crate::stft::{
    bin_at_or_above, bin_at_or_below, frame_center_seconds, RollingStft, HARMONY_FFT, HARMONY_HOP,
    RHYTHM_FFT, RHYTHM_HOP,
};
use crate::tempo::{downbeat_phase, normalize_max, robust_normalize, smooth3, track_beats};
use crate::wav::{open_wav, WavInfo};

const RHYTHM_LO_HZ: f32 = 40.0;
const RHYTHM_HI_HZ: f32 = 12_000.0;
const LOW_BAND_LO_HZ: f32 = 40.0;
const LOW_BAND_HI_HZ: f32 = 150.0;
const SLOTS_PER_BEAT: usize = 4;
const SLOTS_PER_MEASURE: usize = 16;

#[derive(Debug, Clone, Copy)]
pub struct HarmonyFrame {
    pub time: f64,
    pub chroma: Chroma,
    pub bass: Chroma,
}

/// Retained time series; no spectrogram and no decoded PCM.
pub struct Features {
    pub info: WavInfo,
    pub harmony: Vec<HarmonyFrame>,
    pub total_chroma: Chroma,
    /// Positive log-magnitude flux of the percussive rhythm spectrum (beat tracking).
    pub percussive_flux: Vec<f32>,
    /// Positive log-magnitude flux of the harmonic rhythm spectrum (strum attacks).
    pub harmonic_flux: Vec<f32>,
    /// Summed full-spectrum magnitude in 40..150 Hz per rhythm frame (downbeat).
    pub low_band: Vec<f32>,
    pub rhythm_fps: f64,
}

impl Features {
    pub fn rhythm_time(&self, frame: usize) -> f64 {
        frame_center_seconds(frame, RHYTHM_FFT, RHYTHM_HOP, self.info.sample_rate)
    }
}

fn log_mag(m: f32) -> f32 {
    (1.0 + 10.0 * m).ln()
}

struct FluxState {
    lo: usize,
    hi: usize,
    prev: Option<Vec<f32>>,
}

impl FluxState {
    fn next(&mut self, mag: &[f32]) -> f32 {
        let cur: Vec<f32> = mag[self.lo..self.hi].iter().map(|&m| log_mag(m)).collect();
        let flux = match &self.prev {
            Some(p) => cur.iter().zip(p).map(|(c, p)| (c - p).max(0.0)).sum(),
            None => 0.0,
        };
        self.prev = Some(cur);
        flux
    }
}

struct Extractor {
    sample_rate: u32,
    mapper: ChromaMapper,
    harmony: Vec<HarmonyFrame>,
    total: Chroma,
    percussive: FluxState,
    harmonic: FluxState,
    percussive_flux: Vec<f32>,
    harmonic_flux: Vec<f32>,
    low_band: Vec<f32>,
    low_lo: usize,
    low_hi: usize,
}

impl Extractor {
    fn on_harmony(&mut self, fr: HpssFrame) {
        let (chroma, bass) = self.mapper.compute(&fr.harmonic);
        for (t, c) in self.total.iter_mut().zip(chroma) {
            *t += c;
        }
        self.harmony.push(HarmonyFrame {
            time: frame_center_seconds(fr.index, HARMONY_FFT, HARMONY_HOP, self.sample_rate),
            chroma,
            bass,
        });
    }

    fn on_rhythm(&mut self, fr: HpssFrame) {
        self.percussive_flux
            .push(self.percussive.next(&fr.percussive));
        self.harmonic_flux.push(self.harmonic.next(&fr.harmonic));
        self.low_band
            .push(fr.full[self.low_lo..self.low_hi].iter().sum());
    }
}

/// Tunable harmony parameters. `Default` is the shipped configuration; `BASELINE`
/// reproduces the #50 template baseline for evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AnalysisParams {
    pub chroma: ChromaParams,
    pub seventh_gate: SeventhGate,
}

impl AnalysisParams {
    pub const BASELINE: AnalysisParams = AnalysisParams {
        chroma: ChromaParams::BASELINE,
        seventh_gate: SeventhGate::OFF,
    };
}

/// Single sequential pass over the WAV producing the retained features.
pub fn extract_features(bytes: &[u8]) -> MirResult<Features> {
    extract_features_with(bytes, &AnalysisParams::default())
}

pub fn extract_features_with(bytes: &[u8], params: &AnalysisParams) -> MirResult<Features> {
    let stream = open_wav(bytes)?;
    let info = stream.info();
    let sr = info.sample_rate;

    // One planner per invocation; each size is planned once and reused for all frames.
    let mut planner = FftPlanner::<f32>::new();
    let mapper = ChromaMapper::new(HARMONY_FFT, sr, params.chroma);
    let h_lo = mapper.min_bin();
    let h_hi = mapper.max_bin() + 1;
    let mut h_stft = RollingStft::new(&mut planner, HARMONY_FFT, HARMONY_HOP, h_hi + HPSS_WIDTH);
    let mut h_hpss = StreamingHpss::new(h_lo, h_hi);

    let r_lo = bin_at_or_above(RHYTHM_LO_HZ, RHYTHM_FFT, sr);
    let r_hi = bin_at_or_below(RHYTHM_HI_HZ, RHYTHM_FFT, sr) + 1;
    let mut r_stft = RollingStft::new(&mut planner, RHYTHM_FFT, RHYTHM_HOP, r_hi + HPSS_WIDTH);
    let mut r_hpss = StreamingHpss::new(r_lo, r_hi);

    let mut ex = Extractor {
        sample_rate: sr,
        mapper,
        harmony: Vec::new(),
        total: [0.0; 12],
        percussive: FluxState {
            lo: r_lo,
            hi: r_hi,
            prev: None,
        },
        harmonic: FluxState {
            lo: r_lo,
            hi: r_hi,
            prev: None,
        },
        percussive_flux: Vec::new(),
        harmonic_flux: Vec::new(),
        low_band: Vec::new(),
        low_lo: bin_at_or_above(LOW_BAND_LO_HZ, RHYTHM_FFT, sr),
        low_hi: bin_at_or_below(LOW_BAND_HI_HZ, RHYTHM_FFT, sr) + 1,
    };

    stream.for_each_mono(|x| {
        if let Some(mag) = h_stft.push(x) {
            if let Some(fr) = h_hpss.push(mag) {
                ex.on_harmony(fr);
            }
        }
        if let Some(mag) = r_stft.push(x) {
            if let Some(fr) = r_hpss.push(mag) {
                ex.on_rhythm(fr);
            }
        }
    })?;
    for fr in h_hpss.flush() {
        ex.on_harmony(fr);
    }
    for fr in r_hpss.flush() {
        ex.on_rhythm(fr);
    }

    Ok(Features {
        info,
        harmony: ex.harmony,
        total_chroma: ex.total,
        percussive_flux: ex.percussive_flux,
        harmonic_flux: ex.harmonic_flux,
        low_band: ex.low_band,
        rhythm_fps: f64::from(sr) / RHYTHM_HOP as f64,
    })
}

/// Averages harmony frames whose center lies in each 16th slot; an empty slot
/// repeats the previous slot's features.
fn slot_features(measures: &[MeasureBeats], harmony: &[HarmonyFrame]) -> Vec<SlotFeature> {
    let mut out = Vec::with_capacity(measures.len() * SLOTS_PER_MEASURE);
    let mut cursor = 0;
    let mut prev = SlotFeature {
        chroma: [0.0; 12],
        bass: [0.0; 12],
    };
    for b in measures {
        for j in 0..4 {
            let step = (b[j + 1] - b[j]) / SLOTS_PER_BEAT as f64;
            for q in 0..SLOTS_PER_BEAT {
                let start = b[j] + q as f64 * step;
                let end = start + step;
                while cursor < harmony.len() && harmony[cursor].time < start {
                    cursor += 1;
                }
                let mut chroma = [0.0f32; 12];
                let mut bass = [0.0f32; 12];
                let mut n = 0;
                let mut k = cursor;
                while k < harmony.len() && harmony[k].time < end {
                    for i in 0..12 {
                        chroma[i] += harmony[k].chroma[i];
                        bass[i] += harmony[k].bass[i];
                    }
                    n += 1;
                    k += 1;
                }
                let feature = if n == 0 {
                    prev
                } else {
                    l2_normalize(&mut chroma);
                    l2_normalize(&mut bass);
                    SlotFeature { chroma, bass }
                };
                out.push(feature);
                prev = feature;
            }
        }
    }
    out
}

pub fn analyze(bytes: &[u8]) -> MirResult<AudioMirResultV1> {
    analyze_with(bytes, &AnalysisParams::default())
}

pub fn analyze_with(bytes: &[u8], params: &AnalysisParams) -> MirResult<AudioMirResultV1> {
    let feats = extract_features_with(bytes, params)?;
    analyze_features(&feats, params.seventh_gate)
}

/// Decoding stage over already extracted features (lets tuning reuse one extraction
/// for several classifier settings).
pub fn analyze_features(
    feats: &Features,
    seventh_gate: SeventhGate,
) -> MirResult<AudioMirResultV1> {
    let info = feats.info;

    let onset = robust_normalize(&smooth3(&feats.percussive_flux));
    let beats = track_beats(&onset, feats.rhythm_fps)?;
    let low = normalize_max(&feats.low_band);
    let phase = downbeat_phase(&beats.beats, &low, &onset);
    let beat_times: Vec<f64> = beats.beats.iter().map(|&f| feats.rhythm_time(f)).collect();

    let mut measures: Vec<MeasureBeats> = Vec::new();
    let mut i = phase;
    while i + 4 < beat_times.len() {
        let mut b = [0.0f64; 5];
        b.copy_from_slice(&beat_times[i..i + 5]);
        measures.push(b);
        i += 4;
    }
    if measures.is_empty() {
        return Err(MirError::NoCompleteMeasure);
    }

    let slots = slot_features(&measures, &feats.harmony);
    let decoding = decode_chords(&TemplateChordClassifier::with_gate(seventh_gate), &slots);

    let attacks = detect_attacks(&feats.harmonic_flux, |t| feats.rhythm_time(t));
    let per_measure = assign_to_measures(&measures, &attacks);
    let subdivisions = choose_subdivisions(&measures, &per_measure);

    let mut out_measures = Vec::with_capacity(measures.len());
    for (m, b) in measures.iter().enumerate() {
        let base = m * SLOTS_PER_MEASURE;
        let states = &decoding.states[base..base + SLOTS_PER_MEASURE];
        let mut chords = Vec::new();
        let mut start = 0;
        for tick in 1..=SLOTS_PER_MEASURE {
            if tick == SLOTS_PER_MEASURE || states[tick] != states[start] {
                chords.push(ChordResult {
                    tick16: start as u8,
                    name: chord_name(states[start]),
                    confidence: event_confidence(&decoding.top_margin[base + start..base + tick]),
                });
                start = tick;
            }
        }
        let grid = subdivisions[m];
        let attacks = quantize(b, &per_measure[m], grid)
            .into_iter()
            .map(|q| AttackResult {
                slot: q.slot,
                strength: f64::from(q.strength),
                accent: q.accent,
            })
            .collect();
        out_measures.push(MeasureResult {
            index: m as u32,
            start_seconds: b[0],
            end_seconds: b[4],
            subdivision: grid,
            chords,
            attacks,
        });
    }

    let (key_name, key_confidence) = estimate_key(&feats.total_chroma);
    let duration = info.duration_seconds();
    let last_end = measures[measures.len() - 1][4];
    Ok(AudioMirResultV1 {
        version: 1,
        source: SourceInfo {
            sample_rate: info.sample_rate,
            channels: info.channels,
            bits_per_sample: info.bits_per_sample,
            duration_seconds: duration,
        },
        trim: TrimInfo {
            start_seconds: measures[0][0],
            end_seconds: (duration - last_end).max(0.0),
        },
        tempo: TempoInfo {
            bpm: beats.bpm,
            confidence: beats.confidence,
        },
        key: KeyInfo {
            name: key_name,
            confidence: key_confidence,
        },
        measures: out_measures,
    })
}

pub fn analyze_to_json(bytes: &[u8]) -> MirResult<String> {
    analyze(bytes)?.to_json()
}
