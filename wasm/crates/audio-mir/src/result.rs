//! `AudioMirResultV1`: the provider-independent JSON schema returned to TypeScript.

use serde::Serialize;

use crate::error::{MirError, MirResult};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMirResultV1 {
    pub version: u32,
    pub source: SourceInfo,
    pub trim: TrimInfo,
    pub tempo: TempoInfo,
    pub key: KeyInfo,
    pub measures: Vec<MeasureResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub duration_seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimInfo {
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoInfo {
    pub bpm: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    pub name: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasureResult {
    pub index: u32,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub subdivision: u8,
    pub chords: Vec<ChordResult>,
    pub attacks: Vec<AttackResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordResult {
    pub tick16: u8,
    pub name: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttackResult {
    pub slot: u8,
    pub strength: f64,
    pub accent: bool,
}

impl AudioMirResultV1 {
    /// True when every numeric field is finite (serde_json would emit `null` for NaN).
    pub fn is_finite(&self) -> bool {
        let head = [
            self.source.duration_seconds,
            self.trim.start_seconds,
            self.trim.end_seconds,
            self.tempo.bpm,
            self.tempo.confidence,
            self.key.confidence,
        ];
        head.iter().all(|v| v.is_finite())
            && self.measures.iter().all(|m| {
                m.start_seconds.is_finite()
                    && m.end_seconds.is_finite()
                    && m.chords.iter().all(|c| c.confidence.is_finite())
                    && m.attacks.iter().all(|a| a.strength.is_finite())
            })
    }

    /// Serializes to JSON; non-finite internal values are an analysis failure.
    pub fn to_json(&self) -> MirResult<String> {
        if !self.is_finite() {
            return Err(MirError::AnalysisFailed);
        }
        serde_json::to_string(self).map_err(|_| MirError::AnalysisFailed)
    }
}
