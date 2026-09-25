//! GuitarDSL local Audio MIR core (experimental PoC).
//!
//! The only runtime entry point across the WASM boundary is [`analyze_wav`], which
//! returns `AudioMirResultV1` JSON or throws a stable machine error code string.

pub mod chord;
pub mod chroma;
pub mod error;
pub mod hpss;
pub mod key;
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

#[wasm_bindgen]
pub fn analyze_wav(bytes: &[u8]) -> Result<String, JsValue> {
    pipeline::analyze_to_json(bytes).map_err(|e| JsValue::from_str(e.code()))
}
