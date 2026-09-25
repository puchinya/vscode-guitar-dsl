//! Sequential PCM WAV decoding with strict input validation.
//!
//! Samples are downmixed to mono and handed to a callback one at a time; the decoded
//! song is never materialized as a second buffer.

use std::io::Cursor;

use hound::{SampleFormat, WavReader};

use crate::error::{MirError, MirResult};

pub const MAX_FILE_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_DURATION_SECONDS: u64 = 15 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    /// Number of sample frames (per-channel samples) declared by the data chunk.
    pub frames: u32,
}

impl WavInfo {
    pub fn duration_seconds(&self) -> f64 {
        f64::from(self.frames) / f64::from(self.sample_rate)
    }
}

pub struct WavStream<'a> {
    reader: WavReader<Cursor<&'a [u8]>>,
    info: WavInfo,
}

fn map_hound_error(err: hound::Error) -> MirError {
    match err {
        hound::Error::Unsupported => MirError::UnsupportedFormat,
        _ => MirError::InvalidWav,
    }
}

/// Validates the header and returns a sequential reader. Rejects instead of reinterpreting.
pub fn open_wav(bytes: &[u8]) -> MirResult<WavStream<'_>> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(MirError::AudioTooLong);
    }
    let reader = WavReader::new(Cursor::new(bytes)).map_err(map_hound_error)?;
    let spec = reader.spec();
    if spec.sample_format != SampleFormat::Int {
        return Err(MirError::UnsupportedFormat);
    }
    if spec.bits_per_sample != 16 && spec.bits_per_sample != 24 {
        return Err(MirError::UnsupportedBitDepth);
    }
    if spec.channels != 1 && spec.channels != 2 {
        return Err(MirError::UnsupportedChannels);
    }
    if spec.sample_rate != 44_100 && spec.sample_rate != 48_000 {
        return Err(MirError::UnsupportedSampleRate);
    }
    let frames = reader.duration();
    if u64::from(frames) > MAX_DURATION_SECONDS * u64::from(spec.sample_rate) {
        return Err(MirError::AudioTooLong);
    }
    let info = WavInfo {
        sample_rate: spec.sample_rate,
        channels: spec.channels,
        bits_per_sample: spec.bits_per_sample,
        frames,
    };
    Ok(WavStream { reader, info })
}

impl WavStream<'_> {
    pub fn info(&self) -> WavInfo {
        self.info
    }

    /// Streams normalized mono samples in [-1, 1]; stereo is `(left + right) / 2`.
    /// A truncated data chunk is reported as `INVALID_WAV`.
    pub fn for_each_mono<F: FnMut(f32)>(mut self, mut f: F) -> MirResult<()> {
        let scale = 1.0 / (1u32 << (self.info.bits_per_sample - 1)) as f32;
        let stereo = self.info.channels == 2;
        let mut samples = self.reader.samples::<i32>();
        loop {
            let left = match samples.next() {
                None => break,
                Some(s) => s.map_err(map_hound_error)?,
            };
            if stereo {
                let right = match samples.next() {
                    None => return Err(MirError::InvalidWav),
                    Some(s) => s.map_err(map_hound_error)?,
                };
                f((left + right) as f32 * scale * 0.5);
            } else {
                f(left as f32 * scale);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::{wav_bytes, wav_bytes_float};

    fn decode(bytes: &[u8]) -> MirResult<(WavInfo, Vec<f32>)> {
        let stream = open_wav(bytes)?;
        let info = stream.info();
        let mut out = Vec::new();
        stream.for_each_mono(|x| out.push(x))?;
        Ok((info, out))
    }

    fn ramp(len: usize) -> Vec<f32> {
        (0..len).map(|i| (i as f32 / len as f32) - 0.5).collect()
    }

    #[test]
    fn accepts_44k_mono_16bit() {
        let bytes = wav_bytes(&[ramp(441)], 44_100, 16);
        let (info, out) = decode(&bytes).unwrap();
        assert_eq!(
            (
                info.sample_rate,
                info.channels,
                info.bits_per_sample,
                info.frames
            ),
            (44_100, 1, 16, 441)
        );
        assert_eq!(out.len(), 441);
        assert!((out[0] + 0.5).abs() < 1e-3);
    }

    #[test]
    fn accepts_44k_stereo_16bit_and_downmixes() {
        let left = vec![0.5f32; 100];
        let right = vec![-0.25f32; 100];
        let bytes = wav_bytes(&[left, right], 44_100, 16);
        let (info, out) = decode(&bytes).unwrap();
        assert_eq!(info.channels, 2);
        assert_eq!(out.len(), 100);
        for x in out {
            assert!((x - 0.125).abs() < 1e-3, "downmix {x}");
        }
    }

    #[test]
    fn accepts_48k_24bit_mono_and_stereo() {
        let mono = wav_bytes(&[vec![0.75f32; 480]], 48_000, 24);
        let (info, out) = decode(&mono).unwrap();
        assert_eq!((info.sample_rate, info.bits_per_sample), (48_000, 24));
        assert!((out[10] - 0.75).abs() < 1e-5);

        let stereo = wav_bytes(&[vec![0.75f32; 480], vec![0.25f32; 480]], 48_000, 24);
        let (info, out) = decode(&stereo).unwrap();
        assert_eq!(info.channels, 2);
        assert!((out[10] - 0.5).abs() < 1e-5);
    }

    #[test]
    fn full_scale_is_normalized_to_unit_range() {
        let bytes = wav_bytes(&[vec![-1.0f32, 1.0]], 44_100, 16);
        let (_, out) = decode(&bytes).unwrap();
        assert!(out.iter().all(|x| (-1.0..=1.0).contains(x)));
        assert!((out[0] + 1.0).abs() < 1e-4);
    }

    #[test]
    fn rejects_unsupported_sample_rate() {
        let bytes = wav_bytes(&[vec![0.0f32; 100]], 22_050, 16);
        assert_eq!(decode(&bytes).err(), Some(MirError::UnsupportedSampleRate));
    }

    #[test]
    fn rejects_more_than_two_channels() {
        let ch = vec![0.0f32; 100];
        let bytes = wav_bytes(&[ch.clone(), ch.clone(), ch], 44_100, 16);
        assert_eq!(decode(&bytes).err(), Some(MirError::UnsupportedChannels));
    }

    #[test]
    fn rejects_unsupported_bit_depths() {
        for bits in [8u16, 32] {
            let bytes = wav_bytes(&[vec![0.0f32; 100]], 44_100, bits);
            assert_eq!(
                decode(&bytes).err(),
                Some(MirError::UnsupportedBitDepth),
                "bits {bits}"
            );
        }
    }

    #[test]
    fn rejects_float_wav() {
        let bytes = wav_bytes_float(&[0.0f32; 100], 44_100);
        assert_eq!(decode(&bytes).err(), Some(MirError::UnsupportedFormat));
    }

    fn handcrafted_header(format_tag: u16, data_len: u32, sample_rate: u32) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&(36 + data_len).to_le_bytes());
        v.extend_from_slice(b"WAVE");
        v.extend_from_slice(b"fmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&format_tag.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&sample_rate.to_le_bytes());
        v.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes());
        v.extend_from_slice(&16u16.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&data_len.to_le_bytes());
        v
    }

    #[test]
    fn rejects_compressed_wav() {
        // WAVE_FORMAT_ADPCM (0x0002)
        let mut bytes = handcrafted_header(0x0002, 8, 44_100);
        bytes.extend_from_slice(&[0u8; 8]);
        assert_eq!(decode(&bytes).err(), Some(MirError::UnsupportedFormat));
    }

    #[test]
    fn rejects_truncated_data() {
        let mut bytes = handcrafted_header(1, 1000, 44_100);
        bytes.extend_from_slice(&[0u8; 100]);
        assert_eq!(decode(&bytes).err(), Some(MirError::InvalidWav));
    }

    #[test]
    fn rejects_duration_limit() {
        // Header declares 15 min + 1 s of 16-bit mono data; the check happens before reading.
        let frames = (MAX_DURATION_SECONDS as u32 + 1) * 44_100;
        let bytes = handcrafted_header(1, frames * 2, 44_100);
        assert_eq!(decode(&bytes).err(), Some(MirError::AudioTooLong));
    }

    #[test]
    fn rejects_malformed_bytes_without_panicking() {
        let valid = wav_bytes(&[vec![0.1f32; 64]], 44_100, 16);
        let mut cases: Vec<Vec<u8>> = vec![
            Vec::new(),
            b"RIFF".to_vec(),
            b"RIFX\x00\x00\x00\x00WAVE".to_vec(),
            b"not a wave file at all, just text".to_vec(),
            vec![0xFF; 64],
        ];
        for cut in [4usize, 12, 20, 30, 40] {
            cases.push(valid[..cut].to_vec());
        }
        for bytes in cases {
            let res = decode(&bytes);
            assert!(res.is_err(), "len {} should be rejected", bytes.len());
        }
    }
}
