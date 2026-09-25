//! Stable machine error codes crossing the WASM boundary.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MirError {
    InvalidWav,
    UnsupportedFormat,
    UnsupportedSampleRate,
    UnsupportedChannels,
    UnsupportedBitDepth,
    AudioTooLong,
    NoStableBeat,
    NoCompleteMeasure,
    AnalysisFailed,
}

impl MirError {
    /// Machine code sent to TypeScript; never localized or extended with free text.
    pub fn code(self) -> &'static str {
        match self {
            MirError::InvalidWav => "INVALID_WAV",
            MirError::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            MirError::UnsupportedSampleRate => "UNSUPPORTED_SAMPLE_RATE",
            MirError::UnsupportedChannels => "UNSUPPORTED_CHANNELS",
            MirError::UnsupportedBitDepth => "UNSUPPORTED_BIT_DEPTH",
            MirError::AudioTooLong => "AUDIO_TOO_LONG",
            MirError::NoStableBeat => "NO_STABLE_BEAT",
            MirError::NoCompleteMeasure => "NO_COMPLETE_MEASURE",
            MirError::AnalysisFailed => "ANALYSIS_FAILED",
        }
    }
}

impl fmt::Display for MirError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for MirError {}

pub type MirResult<T> = Result<T, MirError>;
