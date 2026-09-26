//! GuitarDSL local Audio MIR core (experimental PoC).
//!
//! Entry points across the WASM boundary:
//! - [`analyze_wav`] runs every stage in this instance and returns `AudioMirResultV1` JSON
//!   or throws a stable machine error code string (evaluation tools, smoke tests);
//! - the staged API used by the extension (#56): [`Analysis`] computes the Beat This!
//!   input and hands out chunks, [`BeatModel`] infers one chunk (typically in several
//!   parallel Workers) while [`Analysis::extract`] runs the full feature pass, and
//!   [`Analysis::finish`] aggregates the chunk logits and decodes the result. Both paths
//!   produce identical JSON.

pub mod beat_nn;
pub mod chord;
pub mod chroma;
pub mod error;
pub mod hpss;
pub mod key;
pub mod mel;
pub mod pipeline;
pub mod result;
pub mod rhythm;
pub mod stft;
pub mod tempo;
pub mod wav;

#[cfg(test)]
mod synth;
#[cfg(test)]
mod tests;

use wasm_bindgen::prelude::*;

use crate::error::{MirError, MirResult};
use crate::mel::N_MELS;
use crate::pipeline::{
    decode, extract_features_with, extract_model_input, neural_or_classic_beats, AnalysisParams,
    BeatTracker, Features,
};

fn js_error(e: MirError) -> JsValue {
    JsValue::from_str(e.code())
}

#[wasm_bindgen]
pub fn analyze_wav(bytes: &[u8]) -> Result<String, JsValue> {
    pipeline::analyze_to_json(bytes).map_err(js_error)
}

/// One staged analysis with the shipped parameters: the constructor runs a light WAV pass
/// for the model input so inference can start at once; [`Analysis::extract`] then runs the
/// full feature pass (while other workers infer) before [`Analysis::finish`].
#[wasm_bindgen]
pub struct Analysis {
    mel: Option<Vec<f32>>,
    frames: usize,
    starts: Vec<i64>,
    feats: Option<Features>,
}

impl Analysis {
    pub fn from_bytes(bytes: &[u8]) -> MirResult<Analysis> {
        let mel = extract_model_input(bytes)?;
        let frames = mel.len() / N_MELS;
        Ok(Analysis {
            mel: Some(mel),
            frames,
            starts: beat_nn::chunk_starts(frames),
            feats: None,
        })
    }

    pub fn chunk_at(&self, index: usize) -> MirResult<Vec<f32>> {
        let mel = self.mel.as_ref().ok_or(MirError::AnalysisFailed)?;
        let start = *self.starts.get(index).ok_or(MirError::AnalysisFailed)?;
        Ok(beat_nn::chunk(mel, self.frames, start))
    }

    /// Full feature pass over the same WAV bytes (the model input is not recomputed).
    pub fn extract_with(&mut self, bytes: &[u8]) -> MirResult<()> {
        let params = AnalysisParams {
            beat_tracker: BeatTracker::Classic,
            ..AnalysisParams::default()
        };
        self.feats = Some(extract_features_with(bytes, &params)?);
        Ok(())
    }

    /// `logits` holds every chunk's logits concatenated in chunk order.
    pub fn finish_with(&self, logits: &[f32]) -> MirResult<String> {
        let feats = self.feats.as_ref().ok_or(MirError::AnalysisFailed)?;
        let mut chunks = Vec::with_capacity(self.starts.len());
        let mut offset = 0;
        for &s in &self.starts {
            let n = beat_nn::chunk_frames(s, self.frames);
            let part = logits
                .get(offset..offset + n)
                .ok_or(MirError::AnalysisFailed)?;
            if part.iter().any(|v| !v.is_finite()) {
                return Err(MirError::AnalysisFailed);
            }
            chunks.push(part.to_vec());
            offset += n;
        }
        if offset != logits.len() {
            return Err(MirError::AnalysisFailed);
        }
        let piece = beat_nn::aggregate(&chunks, &self.starts, self.frames);
        let beats = neural_or_classic_beats(feats, &piece)?;
        decode(feats, &beats, AnalysisParams::default().seventh_gate)?.to_json()
    }
}

#[wasm_bindgen]
impl Analysis {
    /// Decodes the WAV and computes the model input (throws an error code string).
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<Analysis, JsValue> {
        Analysis::from_bytes(bytes).map_err(js_error)
    }

    #[wasm_bindgen(js_name = chunkCount)]
    pub fn chunk_count(&self) -> usize {
        self.starts.len()
    }

    /// Frames in chunk `index` (1500, or fewer for a piece shorter than one chunk).
    #[wasm_bindgen(js_name = chunkFrames)]
    pub fn chunk_frames(&self, index: usize) -> usize {
        self.starts
            .get(index)
            .map_or(0, |&s| beat_nn::chunk_frames(s, self.frames))
    }

    /// Chunk `index` as row-major `[frames][128]` log-mel values.
    pub fn chunk(&self, index: usize) -> Result<Vec<f32>, JsValue> {
        self.chunk_at(index).map_err(js_error)
    }

    /// Frees the retained model input once every chunk has been taken.
    #[wasm_bindgen(js_name = releaseInput)]
    pub fn release_input(&mut self) {
        self.mel = None;
    }

    /// Runs the full feature pass; call once with the same bytes before `finish`.
    pub fn extract(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        self.extract_with(bytes).map_err(js_error)
    }

    /// Aggregates the chunk logits (concatenated in chunk order) and returns the result JSON.
    pub fn finish(&self, logits: &[f32]) -> Result<String, JsValue> {
        self.finish_with(logits).map_err(js_error)
    }
}

/// Beat This! model fixed to one chunk length.
#[wasm_bindgen]
pub struct BeatModel {
    inner: beat_nn::BeatModel,
}

#[wasm_bindgen]
impl BeatModel {
    #[wasm_bindgen(constructor)]
    pub fn new(frames: usize) -> Result<BeatModel, JsValue> {
        beat_nn::BeatModel::new(frames)
            .map(|inner| BeatModel { inner })
            .map_err(js_error)
    }

    /// Beat logits of one chunk (`frames * 128` input values).
    pub fn infer(&self, chunk: &[f32]) -> Result<Vec<f32>, JsValue> {
        if !chunk.len().is_multiple_of(N_MELS) {
            return Err(js_error(MirError::AnalysisFailed));
        }
        self.inner.infer(chunk).map_err(js_error)
    }
}
