//! Local tempo and beat evaluation of the classic (#50 / #52) and Beat This! (#56) trackers.
//!
//!   cargo run --release --manifest-path wasm/Cargo.toml --example eval_beats -- \
//!       [--labset <dir> [--split all|tune|report]] \
//!       [--guitarset <dir> [--players 03,04,05] [--subset comp|solo|all]]
//!
//! `--labset` reads the synthetic set (`meta.json`: bpm, band flag, split); its reference
//! beats are the generator grid `k * 60 / bpm` up to the end of the music (one lead bar
//! plus 16 bars). `--guitarset` reads GuitarSet JAMS `tempo` and `beat_position`; the
//! released Beat This! models were trained on GuitarSet comping, so those rows are
//! reference values only. Datasets stay local and are never committed.
//!
//! Metrics per group and tracker: tempo Acc1 (within 4%), Acc2 (within 4% of the
//! reference x {1/3, 1/2, 1, 2, 3}), median absolute BPM error, and the mean beat
//! F-measure (±70 ms, beats before 5 s discarded, as mir_eval defaults).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use guitardsl_audio_mir::beat_nn;
use guitardsl_audio_mir::pipeline::{
    classic_beats, extract_features_with, neural_or_classic_beats, AnalysisParams, Features,
};
use serde_json::Value;

const TOLERANCE: f64 = 0.04;
const WINDOW: f64 = 0.07;
const MIN_BEAT_TIME: f64 = 5.0;

struct Piece {
    id: String,
    groups: Vec<String>,
    wav: PathBuf,
    bpm: f64,
    beats: Vec<f64>,
}

fn load_labset(dir: &Path, split: &str) -> Vec<Piece> {
    let meta: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).expect("meta.json"))
            .expect("meta.json is JSON");
    meta["songs"]
        .as_array()
        .expect("songs array")
        .iter()
        .filter(|s| split == "all" || s["split"] == split)
        .filter_map(|s| {
            let id = s["id"].as_str()?.to_string();
            let bpm = s["bpm"].as_f64()?;
            let band = if s["band"].as_bool()? {
                "band"
            } else {
                "noband"
            };
            let beat = 60.0 / bpm;
            // One lead bar plus 16 bars of music (scripts/generate-audio-mir-synth-set.mjs).
            let end = 17.0 * 4.0 * beat;
            let beats = (0..)
                .map(|k| k as f64 * beat)
                .take_while(|&t| t < end - 1e-9)
                .collect();
            Some(Piece {
                groups: vec![
                    format!("synth/{band}"),
                    format!("synth/{band}/{}", s["instrument"].as_str().unwrap_or("?")),
                ],
                wav: dir.join(format!("{id}.wav")),
                id,
                bpm,
                beats,
            })
        })
        .collect()
}

fn load_guitarset(dir: &Path, players: &[String], subset: &str) -> Vec<Piece> {
    let mut names: Vec<String> = fs::read_dir(dir.join("annotation"))
        .expect("GuitarSet annotation dir")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".jams"))
        .collect();
    names.sort();
    names
        .into_iter()
        .filter_map(|name| {
            let id = name.trim_end_matches(".jams").to_string();
            if subset != "all" && !id.ends_with(&format!("_{subset}")) {
                return None;
            }
            if !players.iter().any(|p| id.starts_with(p.as_str())) {
                return None;
            }
            let jams: Value =
                serde_json::from_str(&fs::read_to_string(dir.join("annotation").join(&name)).ok()?)
                    .ok()?;
            let annos = jams["annotations"].as_array()?;
            let find = |ns: &str| annos.iter().find(|a| a["namespace"] == ns);
            let bpm = find("tempo")?["data"][0]["value"].as_f64()?;
            let beats = find("beat_position")?["data"]
                .as_array()?
                .iter()
                .filter_map(|o| o["time"].as_f64())
                .collect();
            let style = id
                .split('_')
                .nth(1)?
                .trim_end_matches(|c: char| !c.is_ascii_alphabetic());
            let style: String = style
                .chars()
                .take_while(|c| c.is_ascii_alphabetic())
                .collect();
            let wav = dir.join("audio_mono-mic").join(format!("{id}_mic.wav"));
            wav.exists().then(|| Piece {
                groups: vec![
                    "guitarset (in Beat This! training data)".into(),
                    format!("guitarset/{style}"),
                ],
                id,
                wav,
                bpm,
                beats,
            })
        })
        .collect()
}

/// mir_eval-style F-measure: one-to-one matches within ±70 ms after discarding beats
/// before 5 s. Greedy matching equals the optimal matching because beats are far more
/// than twice the window apart.
fn f_measure(reference: &[f64], estimate: &[f64]) -> f64 {
    let r: Vec<f64> = reference
        .iter()
        .copied()
        .filter(|&t| t >= MIN_BEAT_TIME)
        .collect();
    let e: Vec<f64> = estimate
        .iter()
        .copied()
        .filter(|&t| t >= MIN_BEAT_TIME)
        .collect();
    if r.is_empty() || e.is_empty() {
        return 0.0;
    }
    let (mut i, mut j, mut hits) = (0, 0, 0usize);
    while i < r.len() && j < e.len() {
        let d = e[j] - r[i];
        if d.abs() <= WINDOW {
            hits += 1;
            i += 1;
            j += 1;
        } else if d < 0.0 {
            j += 1;
        } else {
            i += 1;
        }
    }
    let p = hits as f64 / e.len() as f64;
    let rc = hits as f64 / r.len() as f64;
    if p + rc == 0.0 {
        0.0
    } else {
        2.0 * p * rc / (p + rc)
    }
}

#[derive(Default)]
struct Stats {
    n: usize,
    acc1: usize,
    acc2: usize,
    errors: Vec<f64>,
    f_sum: f64,
}

impl Stats {
    fn add(&mut self, reference_bpm: f64, estimate: Option<(f64, Vec<f64>)>, reference: &[f64]) {
        self.n += 1;
        let Some((bpm, beats)) = estimate else {
            self.errors.push(f64::INFINITY);
            return;
        };
        let within = |m: f64| (bpm / (reference_bpm * m) - 1.0).abs() <= TOLERANCE;
        self.acc1 += usize::from(within(1.0));
        self.acc2 += usize::from([1.0 / 3.0, 0.5, 1.0, 2.0, 3.0].into_iter().any(within));
        self.errors.push((bpm - reference_bpm).abs());
        self.f_sum += f_measure(reference, &beats);
    }

    fn row(&mut self) -> String {
        self.errors.sort_by(f64::total_cmp);
        let median = self
            .errors
            .get(self.errors.len() / 2)
            .copied()
            .unwrap_or(f64::NAN);
        let pct = |k: usize| 100.0 * k as f64 / self.n.max(1) as f64;
        format!(
            "n {:3}  Acc1 {:5.1}%  Acc2 {:5.1}%  median |err| {:7.2} BPM  beat F {:.3}",
            self.n,
            pct(self.acc1),
            pct(self.acc2),
            median,
            self.f_sum / self.n.max(1) as f64
        )
    }
}

fn classic(feats: &Features) -> Option<(f64, Vec<f64>)> {
    let bt = classic_beats(feats).ok()?;
    Some((
        bt.bpm,
        bt.beats.iter().map(|&f| feats.rhythm_time(f)).collect(),
    ))
}

/// The shipped path: Beat This!, falling back to the classic tracker when it finds too few beats.
fn neural(feats: &Features) -> Option<(f64, Vec<f64>)> {
    let logits = beat_nn::infer_piece(feats.model_mel.as_ref()?).ok()?;
    let bt = neural_or_classic_beats(feats, &logits).ok()?;
    let times = match bt.seconds {
        Some(seconds) => seconds,
        None => bt.beats.iter().map(|&f| feats.rhythm_time(f)).collect(),
    };
    Some((bt.bpm, times))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let opt = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let mut pieces = Vec::new();
    if let Some(dir) = opt("--labset") {
        pieces.extend(load_labset(
            Path::new(&dir),
            &opt("--split").unwrap_or_else(|| "all".into()),
        ));
    }
    if let Some(dir) = opt("--guitarset") {
        let players: Vec<String> = opt("--players")
            .unwrap_or_else(|| "03,04,05".into())
            .split(',')
            .map(str::to_string)
            .collect();
        pieces.extend(load_guitarset(
            Path::new(&dir),
            &players,
            &opt("--subset").unwrap_or_else(|| "comp".into()),
        ));
    }
    if pieces.is_empty() {
        eprintln!("usage: eval_beats [--labset <dir> [--split all]] [--guitarset <dir> [--players 03,04,05] [--subset comp]]");
        std::process::exit(2);
    }

    let mut stats: BTreeMap<(String, &str), Stats> = BTreeMap::new();
    for (k, piece) in pieces.iter().enumerate() {
        let bytes = fs::read(&piece.wav).unwrap_or_default();
        let feats = extract_features_with(&bytes, &AnalysisParams::default()).ok();
        let results = [
            ("classic", feats.as_ref().and_then(classic)),
            ("neural", feats.as_ref().and_then(neural)),
        ];
        eprintln!(
            "[{}/{}] {} ref {:.1} | classic {} | neural {}",
            k + 1,
            pieces.len(),
            piece.id,
            piece.bpm,
            results[0]
                .1
                .as_ref()
                .map_or("-".into(), |r| format!("{:.1}", r.0)),
            results[1]
                .1
                .as_ref()
                .map_or("-".into(), |r| format!("{:.1}", r.0)),
        );
        for (tracker, result) in results {
            for g in &piece.groups {
                stats.entry((g.clone(), tracker)).or_default().add(
                    piece.bpm,
                    result.clone(),
                    &piece.beats,
                );
            }
        }
    }
    for ((group, tracker), s) in stats.iter_mut() {
        println!("{group:44} {tracker:8} {}", s.row());
    }
}
