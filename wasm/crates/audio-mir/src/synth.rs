//! Test-only deterministic audio synthesis and WAV encoding. No recorded audio is used.

use std::f32::consts::PI;
use std::io::Cursor;

use hound::{SampleFormat, WavSpec, WavWriter};

pub fn midi_hz(midi: i32) -> f32 {
    440.0 * 2f32.powf((midi - 69) as f32 / 12.0)
}

/// A harmonic tone. With `attacks` empty it sounds at constant level over
/// `[start, end)`; otherwise every attack re-triggers an exponential decay.
#[derive(Clone, Debug)]
pub struct Voice {
    pub freq: f32,
    pub amp: f32,
    pub harmonics: usize,
    pub start: f32,
    pub end: f32,
    pub attacks: Vec<f32>,
    pub decay: f32,
}

impl Voice {
    pub fn sustained(freq: f32, amp: f32, harmonics: usize) -> Self {
        Voice {
            freq,
            amp,
            harmonics,
            start: 0.0,
            end: f32::INFINITY,
            attacks: Vec::new(),
            decay: 1.0,
        }
    }

    pub fn span(mut self, start: f32, end: f32) -> Self {
        self.start = start;
        self.end = end;
        self
    }

    pub fn strummed(mut self, attacks: Vec<f32>, decay: f32) -> Self {
        self.attacks = attacks;
        self.decay = decay;
        self
    }
}

/// Short broadband noise burst, optionally with a low "kick" component.
#[derive(Clone, Copy, Debug)]
pub struct Click {
    pub time: f32,
    pub amp: f32,
    pub kick: bool,
}

pub fn render(voices: &[Voice], seconds: f32, sample_rate: u32) -> Vec<f32> {
    let sr = sample_rate as f32;
    let len = (seconds * sr) as usize;
    let mut out = vec![0.0f32; len];
    for v in voices {
        let first = ((v.start * sr).max(0.0) as usize).min(len);
        let last = if v.end.is_finite() {
            ((v.end * sr) as usize).min(len)
        } else {
            len
        };
        let mut next_attack = 0;
        let mut last_attack: Option<f32> = None;
        let mut prev_level = 0.0f32;
        for (i, sample) in out.iter_mut().enumerate().take(last).skip(first) {
            let t = i as f32 / sr;
            while next_attack < v.attacks.len() && v.attacks[next_attack] <= t {
                prev_level = match last_attack {
                    Some(a) => (-(v.attacks[next_attack] - a) / v.decay).exp(),
                    None => 0.0,
                };
                last_attack = Some(v.attacks[next_attack]);
                next_attack += 1;
            }
            // 5 ms linear attack and release ramps, like a real pick or fret release;
            // instantaneous jumps would add broadband clicks that real strums lack.
            let ramp = |dt: f32| (dt / 0.005).clamp(0.0, 1.0);
            let edges = ramp(t - v.start)
                * if v.end.is_finite() {
                    ramp(v.end - t)
                } else {
                    1.0
                };
            let env = edges
                * if v.attacks.is_empty() {
                    1.0
                } else {
                    match (last_attack, prev_level) {
                        (Some(a), level) => {
                            let target = (-(t - a) / v.decay).exp();
                            // Cross-fade from the decayed level into the new strum.
                            level + (target - level) * ramp(t - a)
                        }
                        (None, _) => 0.0,
                    }
                };
            if env < 1e-4 {
                continue;
            }
            // f64 phase: f32 loses ~0.01 rad at t * f ~ 1e4 and adds spurious flux.
            let t64 = i as f64 / f64::from(sample_rate);
            let mut s = 0.0f64;
            for h in 1..=v.harmonics {
                s += (std::f64::consts::TAU * f64::from(v.freq) * h as f64 * t64).sin() / h as f64;
            }
            *sample += v.amp * env * s as f32;
        }
    }
    out
}

pub fn add_clicks(samples: &mut [f32], clicks: &[Click], sample_rate: u32) {
    let sr = sample_rate as f32;
    let mut seed: u32 = 0x1234_5678;
    for c in clicks {
        let start = (c.time * sr) as usize;
        let noise_len = (0.012 * sr) as usize;
        let kick_len = (0.09 * sr) as usize;
        for j in 0..kick_len.max(noise_len) {
            let i = start + j;
            if i >= samples.len() {
                break;
            }
            let t = j as f32 / sr;
            if j < noise_len {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0;
                samples[i] += c.amp * noise * (-t / 0.003).exp();
            }
            if c.kick {
                samples[i] += c.amp * 1.2 * (2.0 * PI * 55.0 * t).sin() * (-t / 0.015).exp();
            }
        }
    }
}

/// Encodes integer PCM. `channels[c][i]` is sample `i` of channel `c`.
pub fn wav_bytes(channels: &[Vec<f32>], sample_rate: u32, bits: u16) -> Vec<u8> {
    let spec = WavSpec {
        channels: channels.len() as u16,
        sample_rate,
        bits_per_sample: bits,
        sample_format: SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut w = WavWriter::new(&mut cursor, spec).unwrap();
        let max = ((1i64 << (bits - 1)) - 1) as f32;
        let len = channels.iter().map(Vec::len).max().unwrap_or(0);
        for i in 0..len {
            for ch in channels {
                let x = ch.get(i).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
                let v = (x * max).round();
                match bits {
                    8 => w.write_sample(v as i8).unwrap(),
                    16 => w.write_sample(v as i16).unwrap(),
                    _ => w.write_sample(v as i32).unwrap(),
                }
            }
        }
        w.finalize().unwrap();
    }
    cursor.into_inner()
}

pub fn wav_bytes_float(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut w = WavWriter::new(&mut cursor, spec).unwrap();
        for &x in samples {
            w.write_sample(x).unwrap();
        }
        w.finalize().unwrap();
    }
    cursor.into_inner()
}

/// Click track: one click per beat from `offset`, beat 1 of each bar accented with a kick.
/// `first_beat_in_bar` is the bar position (0..4) of the first click.
pub fn click_track(bpm: f32, beats: usize, offset: f32, first_beat_in_bar: usize) -> Vec<Click> {
    let period = 60.0 / bpm;
    (0..beats)
        .map(|i| {
            let downbeat = (i + first_beat_in_bar).is_multiple_of(4);
            Click {
                time: offset + i as f32 * period,
                amp: if downbeat { 0.9 } else { 0.45 },
                kick: downbeat,
            }
        })
        .collect()
}
