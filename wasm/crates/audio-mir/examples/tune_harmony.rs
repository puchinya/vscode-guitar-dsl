//! Offline parameter search for overtone peeling and the seventh gate on local evaluation
//! data (never committed). Not part of the WASM runtime.
//!
//!   cargo run --release --manifest-path wasm/Cargo.toml --example tune_harmony -- \
//!       [--guitarset <dir> [--players 00,01,02] [--subset comp|solo|all]] \
//!       [--labset <dir> [--split tune|report|all]]
//!
//! `--guitarset` reads GuitarSet JAMS (performed chords) + mono-mic WAVs; `--labset` reads a
//! LAB set with `meta.json` (e.g. the synthetic multi-instrument set). Excerpts are grouped
//! (`guitarset`, or the LAB set's instrument). For every parameter set the tool prints the
//! overall duration-weighted root / exact recall and the worst per-group change against the
//! #50 baseline. Candidates that stay within `-1.0` point in every group are ranked by
//! overall exact recall. The official before/after report uses the evaluator scripts on
//! the built WASM.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use guitardsl_audio_mir::chord::SeventhGate;
use guitardsl_audio_mir::chroma::{ChromaParams, PITCH_NAMES};
use guitardsl_audio_mir::pipeline::{
    analyze_features, extract_features_with, AnalysisParams, Features,
};
use guitardsl_audio_mir::result::AudioMirResultV1;
use serde_json::Value;

/// Allowed per-group drop (percentage points) against the baseline.
const GROUP_TOLERANCE: f64 = 1.0;

struct Segment {
    start: f64,
    end: f64,
    root: Option<usize>,
    quality: Option<&'static str>,
}

struct Excerpt {
    id: String,
    group: String,
    wav: PathBuf,
    chords: Vec<Segment>,
}

fn pitch_class(name: &str) -> Option<usize> {
    if name.is_empty() {
        return None;
    }
    let (letter, rest) = name.split_at(1);
    let base = PITCH_NAMES.iter().position(|&p| p == letter)? as i32;
    let shift = match rest {
        "" => 0,
        "#" => 1,
        "b" => -1,
        _ => return None,
    };
    Some((base + shift).rem_euclid(12) as usize)
}

/// Harte label -> (root, quality in the Audio MIR vocabulary or None), with the same
/// MIREX-style reduction as `scripts/evaluate-audio-mir.mjs` (approved evaluation rule,
/// Issue #52): added/omitted degrees and bass are ignored, 9/11/13 -> 7,
/// maj9/11/13 -> maj7, min9/11/13 -> m7, 6ths -> triad, dim7 -> dim; hdim7, minmaj7 and
/// interval lists are unsupported (root only).
fn parse_harte(label: &str) -> (Option<usize>, Option<&'static str>) {
    if label == "N" || label == "X" {
        return (None, None);
    }
    let body = label.split('/').next().unwrap_or(label);
    let (root, rest) = body.split_once(':').unwrap_or((body, "maj"));
    let shorthand = rest.split('(').next().unwrap_or("");
    let quality = match (rest, shorthand) {
        ("", _) => Some("maj"),
        (_, "maj" | "maj6") => Some("maj"),
        (_, "min" | "min6") => Some("min"),
        (_, "7" | "9" | "11" | "13") => Some("7"),
        (_, "maj7" | "maj9" | "maj11" | "maj13") => Some("maj7"),
        (_, "min7" | "min9" | "min11" | "min13") => Some("min7"),
        (_, "sus2") => Some("sus2"),
        (_, "sus4") => Some("sus4"),
        (_, "dim" | "dim7") => Some("dim"),
        (_, "aug") => Some("aug"),
        _ => None,
    };
    (pitch_class(root), quality)
}

/// GuitarDSL-style Audio MIR name (`F#m7`) -> (root, quality).
fn parse_name(name: &str) -> (Option<usize>, Option<&'static str>) {
    let split = if name.len() > 1 && matches!(&name[1..2], "#" | "b") {
        2
    } else {
        1.min(name.len())
    };
    let (root, suffix) = name.split_at(split);
    let q = match suffix {
        "" => Some("maj"),
        "m" => Some("min"),
        "7" => Some("7"),
        "maj7" => Some("maj7"),
        "m7" => Some("min7"),
        "sus2" => Some("sus2"),
        "sus4" => Some("sus4"),
        "dim" => Some("dim"),
        "aug" => Some("aug"),
        _ => None,
    };
    (pitch_class(root), q)
}

fn sorted_names(dir: &Path, ext: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|_| panic!("cannot read {}", dir.display()))
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(ext))
        .collect();
    names.sort();
    names
}

fn load_guitarset(dir: &Path, players: &[String], subset: &str) -> Vec<Excerpt> {
    sorted_names(&dir.join("annotation"), ".jams")
        .into_iter()
        .filter_map(|name| {
            let id = name.trim_end_matches(".jams").to_string();
            if subset != "all" && !id.ends_with(&format!("_{subset}")) {
                return None;
            }
            if !players.iter().any(|p| id.starts_with(p.as_str())) {
                return None;
            }
            let text = fs::read_to_string(dir.join("annotation").join(&name)).ok()?;
            let jams: Value = serde_json::from_str(&text).ok()?;
            let chord_annos: Vec<&Value> = jams["annotations"]
                .as_array()?
                .iter()
                .filter(|a| a["namespace"] == "chord")
                .collect();
            let performed = chord_annos.get(1).or(chord_annos.first())?;
            let chords = performed["data"]
                .as_array()?
                .iter()
                .filter_map(|o| {
                    let start = o["time"].as_f64()?;
                    let end = start + o["duration"].as_f64()?;
                    let (root, quality) = parse_harte(o["value"].as_str()?);
                    Some(Segment {
                        start,
                        end,
                        root,
                        quality,
                    })
                })
                .collect();
            let wav = dir.join("audio_mono-mic").join(format!("{id}_mic.wav"));
            wav.exists().then(|| Excerpt {
                id,
                group: "guitarset".into(),
                wav,
                chords,
            })
        })
        .collect()
}

fn load_labset(dir: &Path, split: &str) -> Vec<Excerpt> {
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
            let lab = fs::read_to_string(dir.join(format!("{id}.lab"))).ok()?;
            let chords = lab
                .lines()
                .filter_map(|l| {
                    let mut it = l.split_whitespace();
                    let start: f64 = it.next()?.parse().ok()?;
                    let end: f64 = it.next()?.parse().ok()?;
                    let label = it.next()?;
                    let (root, quality) = if label.contains(':') {
                        parse_harte(label)
                    } else {
                        parse_name(label)
                    };
                    Some(Segment {
                        start,
                        end,
                        root,
                        quality,
                    })
                })
                .collect();
            Some(Excerpt {
                group: s["instrument"].as_str().unwrap_or("labset").to_string(),
                wav: dir.join(format!("{id}.wav")),
                id,
                chords,
            })
        })
        .collect()
}

#[derive(Default, Clone, Copy)]
struct Totals {
    root_total: f64,
    root_hit: f64,
    exact_total: f64,
    exact_hit: f64,
}

impl Totals {
    fn add(&mut self, o: &Totals) {
        self.root_total += o.root_total;
        self.root_hit += o.root_hit;
        self.exact_total += o.exact_total;
        self.exact_hit += o.exact_hit;
    }
    fn root(&self) -> f64 {
        100.0 * self.root_hit / self.root_total.max(1e-9)
    }
    fn exact(&self) -> f64 {
        100.0 * self.exact_hit / self.exact_total.max(1e-9)
    }
}

fn score(result: Option<&AudioMirResultV1>, reference: &[Segment]) -> Totals {
    let mut t = Totals::default();
    let mut predicted = Vec::new();
    if let Some(r) = result {
        for m in &r.measures {
            let dur = m.end_seconds - m.start_seconds;
            for (i, c) in m.chords.iter().enumerate() {
                let end_tick = m.chords.get(i + 1).map_or(16, |n| n.tick16);
                predicted.push((
                    m.start_seconds + f64::from(c.tick16) / 16.0 * dur,
                    m.start_seconds + f64::from(end_tick) / 16.0 * dur,
                    parse_name(&c.name),
                ));
            }
        }
    }
    for seg in reference {
        let Some(root) = seg.root else { continue };
        let len = seg.end - seg.start;
        t.root_total += len;
        if seg.quality.is_some() {
            t.exact_total += len;
        }
        for &(s, e, (proot, pq)) in &predicted {
            let ov = (e.min(seg.end) - s.max(seg.start)).max(0.0);
            if ov > 0.0 && proot == Some(root) {
                t.root_hit += ov;
                if seg.quality.is_some() && seg.quality == pq {
                    t.exact_hit += ov;
                }
            }
        }
    }
    t
}

struct Row {
    chroma: ChromaParams,
    gate: SeventhGate,
    overall: Totals,
    groups: BTreeMap<String, Totals>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opt = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let mut excerpts = Vec::new();
    if let Some(dir) = opt("--guitarset") {
        let players: Vec<String> = opt("--players")
            .unwrap_or_else(|| "00,01,02".into())
            .split(',')
            .map(|p| format!("{p:0>2}"))
            .collect();
        let subset = opt("--subset").unwrap_or_else(|| "comp".into());
        excerpts.extend(load_guitarset(Path::new(&dir), &players, &subset));
    }
    if let Some(dir) = opt("--labset") {
        let split = opt("--split").unwrap_or_else(|| "tune".into());
        excerpts.extend(load_labset(Path::new(&dir), &split));
    }
    if excerpts.is_empty() {
        eprintln!("usage: tune_harmony [--guitarset <dir> [--players 00,01,02] [--subset comp]] [--labset <dir> [--split tune]]");
        std::process::exit(2);
    }
    let mut group_counts: BTreeMap<&str, usize> = BTreeMap::new();
    for e in &excerpts {
        *group_counts.entry(e.group.as_str()).or_default() += 1;
    }
    eprintln!("{} excerpts: {group_counts:?}", excerpts.len());

    // Grids can be overridden, e.g. `--alphas 0.6,0.8 --thetas 0.8,1.0`.
    let list = |name: &str, default: &[f32]| -> Vec<f32> {
        opt(name).map_or_else(
            || default.to_vec(),
            |v| v.split(',').filter_map(|x| x.parse().ok()).collect(),
        )
    };
    // Defaults are the grid that selected the shipped parameters (Issue #52); keep them in
    // sync with `docs/agents/testing.md` so the selection is reproducible.
    let (alphas, gammas) = (
        list("--alphas", &[0.6, 0.8, 1.0, 1.2]),
        list("--gammas", &[0.7, 0.85, 1.0]),
    );
    let (thetas, lambdas) = (
        list("--thetas", &[0.6, 0.8]),
        list("--lambdas", &[0.2, 0.3]),
    );
    // Peel sets as bit masks (bit h-2 = harmonic h): 7 = {2,3,4}, 23 = {2,3,4,6}, 31 = {2..6}.
    let masks: Vec<u8> = list("--masks", &[18.0, 26.0, 23.0, 31.0])
        .iter()
        .map(|&m| m as u8)
        .collect();
    let mut chroma_grid = vec![ChromaParams::BASELINE];
    for &peel_mask in &masks {
        for &overtone_alpha in &alphas {
            for &overtone_gamma in &gammas {
                chroma_grid.push(ChromaParams {
                    overtone_alpha,
                    overtone_gamma,
                    peel_mask,
                });
            }
        }
    }
    let gate_grid: Vec<SeventhGate> = std::iter::once(SeventhGate::OFF)
        .chain(thetas.iter().flat_map(|&th| {
            lambdas.iter().map(move |&la| SeventhGate {
                theta: th,
                lambda: la,
            })
        }))
        .collect();

    let mut rows: Vec<Row> = Vec::new();
    let started = std::time::Instant::now();
    for (ci, cp) in chroma_grid.iter().enumerate() {
        // Progress on stderr: extraction per chroma setting dominates the run time.
        eprintln!(
            "[{}/{}] mask {:#07b} alpha {:.2} gamma {:.2} ({:.0} s elapsed)",
            ci + 1,
            chroma_grid.len(),
            cp.peel_mask,
            cp.overtone_alpha,
            cp.overtone_gamma,
            started.elapsed().as_secs_f64()
        );
        let params = AnalysisParams {
            chroma: *cp,
            seventh_gate: SeventhGate::OFF,
        };
        let features: Vec<(Option<Features>, &Excerpt)> = excerpts
            .iter()
            .map(|e| {
                let bytes = fs::read(&e.wav).unwrap_or_default();
                (extract_features_with(&bytes, &params).ok(), e)
            })
            .collect();
        for gate in &gate_grid {
            let mut overall = Totals::default();
            let mut groups: BTreeMap<String, Totals> = BTreeMap::new();
            for (feats, e) in &features {
                let result = feats.as_ref().and_then(|f| analyze_features(f, *gate).ok());
                if result.is_none() && *cp == ChromaParams::BASELINE && *gate == SeventhGate::OFF {
                    eprintln!("  analysis failed: {}", e.id);
                }
                let t = score(result.as_ref(), &e.chords);
                overall.add(&t);
                groups.entry(e.group.clone()).or_default().add(&t);
            }
            rows.push(Row {
                chroma: *cp,
                gate: *gate,
                overall,
                groups,
            });
        }
    }

    let base = &rows[0];
    let worst = |r: &Row| -> (f64, f64) {
        r.groups
            .iter()
            .fold((f64::INFINITY, f64::INFINITY), |(wr, we), (g, t)| {
                let b = &base.groups[g];
                (wr.min(t.root() - b.root()), we.min(t.exact() - b.exact()))
            })
    };
    let describe = |r: &Row| {
        let (wr, we) = worst(r);
        format!(
            "mask {:#07b} alpha {:.2} gamma {:.2} theta {:.2} lambda {:.2}: root {:.1}% exact {:.1}% | worst group d_root {:+.1} d_exact {:+.1}",
            r.chroma.peel_mask,
            r.chroma.overtone_alpha,
            r.chroma.overtone_gamma,
            r.gate.theta,
            r.gate.lambda,
            r.overall.root(),
            r.overall.exact(),
            wr,
            we
        )
    };
    println!("baseline  {}", describe(base));
    for (g, t) in &base.groups {
        println!("  {g:<10} root {:.1}% exact {:.1}%", t.root(), t.exact());
    }
    let mut ranked: Vec<&Row> = rows
        .iter()
        .filter(|r| {
            let (wr, we) = worst(r);
            wr >= -GROUP_TOLERANCE
                && we >= -GROUP_TOLERANCE
                && r.overall.root() >= base.overall.root()
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.overall
            .exact()
            .total_cmp(&a.overall.exact())
            .then(b.overall.root().total_cmp(&a.overall.root()))
    });
    // Selection rule: best overall exact recall among candidates that keep overall root
    // recall and stay within the per-group tolerance; ties go to higher root recall.
    match ranked.first() {
        Some(r) => println!("SELECTED  {}", describe(r)),
        None => println!("SELECTED  none (no candidate within tolerance)"),
    }
    println!(
        "--- top 10 within per-group tolerance ({GROUP_TOLERANCE} pt) by overall exact recall ---"
    );
    for r in ranked.iter().take(10) {
        println!("{}", describe(r));
        for (g, t) in &r.groups {
            let b = &base.groups[g];
            println!(
                "    {g:<10} root {:.1}% ({:+.1}) exact {:.1}% ({:+.1})",
                t.root(),
                t.root() - b.root(),
                t.exact(),
                t.exact() - b.exact()
            );
        }
    }
}
