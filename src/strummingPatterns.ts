// Canonical accompaniment (strumming / arpeggio) preset catalog and its pattern parser
// (spec extension.md §3.10 / §8.7, design architecture.md §2.19). Pure module: no VS Code dependency.
// This is the only catalog: the manual QuickPick, the AI accompaniment tools and the YouTube transcription
// panel all read it. Metadata is explicit data; nothing is inferred from an ID at runtime.

import { RhythmItem, parseGuitarDsl, rhythmItemBeats } from './compiler';
import { Fraction, ZERO, fadd } from './duration';

/** Effective GuitarDSL score feel (`feel:` / `@feel:`). */
export type ScoreFeel = 'straight' | 'swing' | 'shuffle';
export type AccompanimentStyle = 'strum' | 'arpeggio' | 'rolled' | 'sustain';
export type AccompanimentSubdivision = 'quarter' | 'eighth' | 'sixteenth' | 'triplet';
export type AccompanimentEnergy = 'low' | 'medium' | 'high';
export type AccompanimentDensity = 'sparse' | 'medium' | 'dense';
export type AccompanimentSyncopation = 'none' | 'light' | 'medium' | 'strong';
export type SyncopationKind = 'offbeat' | 'anticipation' | 'beatCrossing';
export type AccompanimentEmphasis = 'none' | 'downbeat' | 'backbeat' | 'offbeat' | 'custom';
export type StrokeDirectionModel = 'pendulum' | 'authored' | 'none';
export type AccompanimentFamily =
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'shuffle'
  | 'swing'
  | 'triplet'
  | 'sustain'
  | 'arpeggio'
  | 'rolled';
export type AccompanimentUsageGroup =
  | 'standard'
  | 'popJpop'
  | 'rockPunkMetal'
  | 'funkSoulDisco'
  | 'reggaeSka'
  | 'blues'
  | 'acousticBallad'
  | 'special';
export type AccompanimentDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type VariationRole = 'fill' | 'cadence' | 'lift' | 'breakdown';
/**
 * Where a pattern presents a new chord: `onsetPreferred` = normally on the chord onset (soft preference),
 * `offbeatAllowed` = a delayed first harmonic attack is idiomatic, `freeWithinChord` = anywhere in the chord.
 */
export type ChordArticulation = 'onsetPreferred' | 'offbeatAllowed' | 'freeWithinChord';

export interface StrummingPatternPreset {
  id: string;
  nameJa: string;
  nameEn: string;
  descriptionJa: string;
  descriptionEn: string;
  /** GuitarDSL rhythm tokens of exactly one full measure of `meter`. */
  pattern: string;
  meter: string;
  style: AccompanimentStyle;
  subdivision: AccompanimentSubdivision;
  /** Effective score feels the preset needs; `any` = no requirement. Never changes duration arithmetic. */
  feelCompatibility: 'any' | ScoreFeel[];
  energy: AccompanimentEnergy;
  density: AccompanimentDensity;
  syncopation: AccompanimentSyncopation;
  syncopationKinds: SyncopationKind[];
  /** Perceived metrical emphasis; not the same as the presence of `.a`. */
  emphasis: AccompanimentEmphasis;
  directionModel: StrokeDirectionModel;
  family: AccompanimentFamily;
  usageGroup: AccompanimentUsageGroup;
  difficulty: AccompanimentDifficulty;
  chordArticulation: ChordArticulation;
  /** Root presets omit both; a variation references a preset of the same meter and family. */
  variationOf?: string;
  variationRole?: VariationRole;
  /** Soft genre / arrangement hints for the Agent; never a validity rule. */
  tags: string[];
}

/** Display / selection order of the families (spec extension §3.10). */
export const FAMILY_ORDER: readonly AccompanimentFamily[] = ['quarter', 'eighth', 'sixteenth', 'shuffle', 'swing', 'triplet', 'sustain', 'arpeggio', 'rolled'];
/** Separator order of the usage groups inside a family. */
export const USAGE_GROUP_ORDER: readonly AccompanimentUsageGroup[] = [
  'standard',
  'popJpop',
  'acousticBallad',
  'rockPunkMetal',
  'funkSoulDisco',
  'reggaeSka',
  'blues',
  'special'
];

export const STRUMMING_PATTERN_PRESETS: readonly StrummingPatternPreset[] = [
  {
    id: 'strum_4_4_quarter_basic',
    nameJa: '4分ダウン基本', nameEn: 'Quarter-Note Downstrokes',
    descriptionJa: '1拍に1回ダウンで刻む最も基本の4分ストローク',
    descriptionEn: 'One downstroke per beat; the most basic quarter-note strum',
    pattern: '4.d 4.d 4.d 4.d', meter: '4/4',
    style: 'strum', subdivision: 'quarter', family: 'quarter', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['pop', 'rock', 'folk']
  },
  {
    id: 'strum_4_4_quarter_backbeat',
    nameJa: '4分バックビート', nameEn: 'Quarter-Note Backbeat',
    descriptionJa: '2・4拍目にアクセントを置く4分ストローク',
    descriptionEn: 'Quarter-note downstrokes accenting beats 2 and 4',
    pattern: '4.d 4.d.a 4.d 4.d.a', meter: '4/4',
    style: 'strum', subdivision: 'quarter', family: 'quarter', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['rock', 'pop']
  },
  {
    id: 'strum_4_4_quarter_palm_mute',
    nameJa: '4分パームミュート', nameEn: 'Quarter-Note Palm Mute',
    descriptionJa: 'パームミュートで4分を刻む',
    descriptionEn: 'Palm-muted quarter-note downstrokes',
    pattern: '4.d.pm 4.d.pm 4.d.pm 4.d.pm', meter: '4/4',
    style: 'strum', subdivision: 'quarter', family: 'quarter', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['rock', 'punk']
  },
  {
    id: 'sustain_4_4_whole',
    nameJa: '全音符サステイン', nameEn: 'Whole-Note Sustain',
    descriptionJa: '小節頭で1回鳴らして伸ばす',
    descriptionEn: 'One stroke per measure, held',
    pattern: '1.d', meter: '4/4',
    style: 'sustain', subdivision: 'quarter', family: 'sustain', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['ballad', 'intro', 'outro']
  },
  {
    id: 'sustain_4_4_half',
    nameJa: '2分サステイン', nameEn: 'Half-Note Sustain',
    descriptionJa: '2拍ごとに1回鳴らして伸ばす',
    descriptionEn: 'One held stroke every two beats',
    pattern: '2.d 2.d', meter: '4/4',
    style: 'sustain', subdivision: 'quarter', family: 'sustain', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['ballad']
  },
  {
    id: 'rock_4_4_eighth_full',
    nameJa: 'ロック8分フル', nameEn: 'Rock Full Eighths',
    descriptionJa: '8分をダウン・アップで途切れず刻む',
    descriptionEn: 'Continuous down-up eighth notes',
    pattern: '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['rock', 'pop', 'folk']
  },
  {
    id: 'pop_4_4_eighth_orthodox',
    nameJa: '王道ポップ8ビート', nameEn: 'Orthodox Pop Eighths',
    descriptionJa: '1拍目を4分で鳴らし、残りを8分で刻む王道パターン',
    descriptionEn: 'Quarter on beat 1, then down-up eighths',
    pattern: '4.d 8.d 8.u 8.d 8.u 8.d 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'popJpop', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['pop', 'J-POP']
  },
  {
    id: 'pop_4_4_eighth_halfbar',
    nameJa: 'ポップ/フォーク半小節型', nameEn: 'Pop/Folk Half-Bar',
    descriptionJa: '「4分・8分・8分」を小節の前後半で繰り返す',
    descriptionEn: 'Quarter-eighth-eighth repeated in each half of the measure',
    pattern: '4.d 8.d 8.u 4.d 8.d 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'popJpop', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['pop', 'folk', 'country']
  },
  {
    id: 'jpop_4_4_eighth_old_faithful',
    nameJa: 'J-POP/ポップ王道 D-DU-UDU', nameEn: 'Pop Old Faithful D-DU-UDU',
    descriptionJa: '2拍目裏のアップを3拍目にまたがせる定番 D-DU-UDU',
    descriptionEn: 'The classic D-DU-UDU; the upstroke on the & of 2 carries over beat 3',
    pattern: '4.d 8.d 4.u 8.u 8.d 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'popJpop', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'medium', syncopationKinds: ['anticipation', 'beatCrossing'],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'pop_4_4_eighth_orthodox', variationRole: 'lift',
    tags: ['J-POP', 'pop', 'folk', 'acoustic']
  },
  {
    id: 'folk_4_4_eighth_classic',
    nameJa: 'フォーク定番8ビート', nameEn: 'Classic Folk Eighths',
    descriptionJa: '頭と4拍目を4分、間を8分で刻むフォークの定番',
    descriptionEn: 'Quarters on beats 1 and 4 with eighths in between',
    pattern: '4.d 8.d 8.u 8.d 8.u 4.d', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['folk', 'singer-songwriter']
  },
  {
    id: 'ballad_4_4_eighth_sparse',
    nameJa: 'バラード/歌謡スパース8ビート', nameEn: 'Sparse Ballad Eighths',
    descriptionJa: '音数を抑え、3拍目裏のアップを伸ばすバラード向け',
    descriptionEn: 'Few strokes; the upstroke on the & of 3 is held',
    pattern: '4.d 4.d 8.d 4.u 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'light', syncopationKinds: ['anticipation', 'beatCrossing'],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['ballad', 'kayokyoku']
  },
  {
    id: 'rock_4_4_eighth_push',
    nameJa: 'ロック8ビート・3拍プッシュ', nameEn: 'Rock Eighths with Beat-3 Push',
    descriptionJa: '2拍目裏のアップで3拍目を食うロック8ビート',
    descriptionEn: 'Rock eighths anticipating beat 3 from the & of 2',
    pattern: '8.d 8.u 8.d 4.u 8.u 8.d 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'medium', syncopationKinds: ['anticipation', 'beatCrossing'],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'rock_4_4_eighth_full', variationRole: 'fill',
    tags: ['fast rock', 'J-POP']
  },
  {
    id: 'rock_4_4_eighth_backbeat',
    nameJa: 'ロック8ビート・バックビート', nameEn: 'Rock Eighths Backbeat',
    descriptionJa: '2・4拍目にアクセントを置く8分フル',
    descriptionEn: 'Full eighths accenting beats 2 and 4',
    pattern: '8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'rock_4_4_eighth_full', variationRole: 'lift',
    tags: ['rock', 'pop']
  },
  {
    id: 'reggae_4_4_skank',
    nameJa: 'レゲエ/スカ裏打ち', nameEn: 'Reggae/Ska Skank',
    descriptionJa: '表拍を休み、裏拍だけアップで鳴らす',
    descriptionEn: 'Rests on the beats, upstrokes on every offbeat',
    pattern: 'r8 8.u r8 8.u r8 8.u r8 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'reggaeSka', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'strong', syncopationKinds: ['offbeat'],
    emphasis: 'offbeat', directionModel: 'pendulum', chordArticulation: 'offbeatAllowed',
    tags: ['reggae', 'ska']
  },
  // Authored: punk/rock all-downstroke eighths deliberately leave the pendulum.
  {
    id: 'rock_4_4_eighth_all_down',
    nameJa: 'パンク/ロック8分オールダウン', nameEn: 'Punk/Rock Eighth All-Downs',
    descriptionJa: '8分をすべてダウンで刻む',
    descriptionEn: 'Every eighth note played as a downstroke',
    pattern: '8.d 8.d 8.d 8.d 8.d 8.d 8.d 8.d', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'special', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'authored', chordArticulation: 'onsetPreferred',
    tags: ['punk', 'garage rock', 'hard rock']
  },
  {
    id: 'rock_4_4_eighth_palm_mute',
    nameJa: 'ロック8分パームミュート', nameEn: 'Rock Eighth Palm Mute',
    descriptionJa: 'パームミュートで8分を刻む',
    descriptionEn: 'Palm-muted down-up eighths',
    pattern: '8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'rock_4_4_eighth_full', variationRole: 'breakdown',
    tags: ['rock', 'punk', 'metal']
  },
  {
    id: 'acoustic_4_4_percussive_backbeat',
    nameJa: 'モダンアコースティック・パーカッシブ', nameEn: 'Percussive Acoustic Backbeat',
    descriptionJa: '2・4拍目をブラッシング（ゴースト）で打楽器的に鳴らす',
    descriptionEn: 'Muted ghost strokes on beats 2 and 4 for a percussive backbeat',
    pattern: '8.d 8.u 8.d.g 8.u 8.d 8.u 8.d.g 8.u', meter: '4/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'acousticBallad', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['modern acoustic', 'singer-songwriter']
  },
  {
    id: 'popfunk_4_4_sixteenth_full',
    nameJa: '16ビート・フルオルタネイト', nameEn: 'Full Sixteenth Alternate',
    descriptionJa: '16分をダウン・アップで途切れず刻む',
    descriptionEn: 'Continuous down-up sixteenth notes',
    pattern: '16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'funkSoulDisco', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['pop', 'funk', 'rhythm training']
  },
  {
    id: 'jpop_4_4_sixteenth_bright_drive',
    nameJa: 'J-POP16ビート・ブライトドライブ', nameEn: 'J-POP 16th Bright Drive',
    descriptionJa: '8分2つのあとに16分4つを続ける明るい16ビート',
    descriptionEn: 'Two eighths followed by four sixteenths, twice per measure',
    pattern: '8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'popJpop', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['J-POP', 'bright pop']
  },
  {
    id: 'jpop_4_4_sixteenth_singer_songwriter',
    nameJa: 'J-POP16ビート・弾き語り', nameEn: 'J-POP 16th Singer-Songwriter',
    descriptionJa: '8分主体に拍末の16分アップを加える弾き語り型',
    descriptionEn: 'Mostly eighths with a sixteenth pickup at the end of beats 2 and 4',
    pattern: '8.d 8.d 8.d 16.d 16.u 8.d 8.d 8.d 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'popJpop', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['J-POP', 'acoustic pop', 'singer-songwriter']
  },
  {
    id: 'jpop_4_4_sixteenth_dynamic_mix',
    nameJa: 'J-POP16ビート・ダイナミックミックス', nameEn: 'J-POP 16th Dynamic Mix',
    descriptionJa: '8分と16分を混ぜて動きを出す16ビート',
    descriptionEn: 'Mixed eighths and sixteenths for more motion',
    pattern: '8.d 8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'popJpop', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'jpop_4_4_sixteenth_bright_drive', variationRole: 'fill',
    tags: ['J-POP', 'pop-rock']
  },
  {
    id: 'jpop_4_4_sixteenth_anticipation',
    nameJa: 'J-POP16ビート・アンティシペーション', nameEn: 'J-POP 16th Anticipation',
    descriptionJa: '2拍目最後の16分アップで3拍目を食う16ビート',
    descriptionEn: 'Sixteenth upstroke at the end of beat 2 carried over beat 3',
    pattern: '8.d 8.d 8.d 16.d 16+8.u 8.d 8.d 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'popJpop', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'medium', syncopation: 'strong', syncopationKinds: ['anticipation', 'beatCrossing'],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'jpop_4_4_sixteenth_bright_drive', variationRole: 'lift',
    tags: ['J-POP chorus', 'syncopated pop']
  },
  {
    id: 'acoustic_rock_4_4_sixteenth_syncopated',
    nameJa: 'アコースティックロック16ビート・シンコペーション', nameEn: 'Acoustic Rock 16th Syncopation',
    descriptionJa: '16分裏のアップで拍頭を食う細かいシンコペーション',
    descriptionEn: 'Sixteenth-note upstrokes that tie over the next beat',
    pattern: '8.d 16.d 8+16.u 16.d 16.u 8.d 16.d 8+16.u 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'acousticBallad', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'medium', syncopation: 'strong', syncopationKinds: ['anticipation', 'beatCrossing'],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['Britpop', 'modern acoustic', 'indie rock']
  },
  {
    id: 'poprock_4_4_sixteenth_backbeat',
    nameJa: 'ポップ/ロック16ビート・バックビート', nameEn: 'Pop/Rock 16th Backbeat',
    descriptionJa: '16分フルで2・4拍目にアクセント',
    descriptionEn: 'Full sixteenths accenting beats 2 and 4',
    pattern: '16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'rockPunkMetal', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'popfunk_4_4_sixteenth_full', variationRole: 'lift',
    tags: ['pop-rock', 'dance rock']
  },
  {
    id: 'funk_4_4_sixteenth_ghost_motor',
    nameJa: 'ファンク16ビート・ゴーストモーター', nameEn: 'Funk 16th Ghost Motor',
    descriptionJa: 'アップをゴーストにして16分の手の動きを保つファンク',
    descriptionEn: 'Constant sixteenth motion with ghosted upstrokes and a 2-and-4 accent',
    pattern: '16.d 16.u.g 16.d 16.u.g 16.d.a 16.u.g 16.d 16.u.g 16.d 16.u.g 16.d 16.u.g 16.d.a 16.u.g 16.d 16.u.g', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'funkSoulDisco', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['funk', 'soul', 'disco']
  },
  {
    id: 'reggae_4_4_sixteenth_scratch',
    nameJa: 'レゲエ16分スクラッチ', nameEn: 'Reggae 16th Scratch',
    descriptionJa: 'ゴーストで刻みつつ裏拍だけアクセントで鳴らす',
    descriptionEn: 'Ghosted sixteenths with accented offbeat chords',
    pattern: '16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'reggaeSka', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'medium', density: 'dense', syncopation: 'strong', syncopationKinds: ['offbeat'],
    emphasis: 'custom', directionModel: 'pendulum', chordArticulation: 'offbeatAllowed',
    tags: ['reggae', 'percussive scratch']
  },
  {
    id: 'rock_4_4_sixteenth_palm_mute',
    nameJa: 'ロック16分パームミュート', nameEn: 'Rock 16th Palm Mute',
    descriptionJa: 'パームミュートで16分を刻む',
    descriptionEn: 'Palm-muted down-up sixteenths',
    pattern: '16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'rockPunkMetal', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'popfunk_4_4_sixteenth_full', variationRole: 'breakdown',
    tags: ['rock', 'metal']
  },
  // Authored: metal all-downstroke sixteenths deliberately leave the pendulum.
  {
    id: 'metal_4_4_sixteenth_all_down',
    nameJa: 'メタル16分オールダウン', nameEn: 'Metal 16th All-Downs',
    descriptionJa: '16分をすべてダウンで刻む',
    descriptionEn: 'Every sixteenth note played as a downstroke',
    pattern: '16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'sixteenth', usageGroup: 'special', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'authored', chordArticulation: 'onsetPreferred',
    tags: ['metal', 'punk', 'endurance']
  },
  {
    id: 'swing_4_4_sixteenth_halftime',
    nameJa: '16分ハーフタイム・シャッフル', nameEn: '16th Half-Time Shuffle',
    descriptionJa: 'スウィングした16分で3拍目にアクセントを置くハーフタイム',
    descriptionEn: 'Swung sixteenths with the half-time accent on beat 3',
    pattern: '16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u 16.d 16.u 16.d 16.u', meter: '4/4',
    style: 'strum', subdivision: 'sixteenth', family: 'swing', usageGroup: 'standard', difficulty: 'advanced',
    feelCompatibility: ['swing'], energy: 'medium', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'custom', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['half-time shuffle', 'swung 16ths']
  },
  {
    id: 'blues_4_4_shuffle_basic',
    nameJa: 'ブルース・シャッフル基本', nameEn: 'Blues Shuffle',
    descriptionJa: '3連の1つ目と3つ目で刻むシャッフル',
    descriptionEn: 'Shuffle on the first and third triplet of each beat',
    pattern: '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'shuffle', usageGroup: 'blues', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['blues', 'rock-and-roll']
  },
  {
    id: 'bluesrock_4_4_shuffle_backbeat',
    nameJa: 'ブルースロック・シャッフル', nameEn: 'Blues-Rock Shuffle',
    descriptionJa: '2・4拍目にアクセントを置くシャッフル',
    descriptionEn: 'Shuffle accenting beats 2 and 4',
    pattern: '4t.d 8t.u 4t.d.a 8t.u 4t.d 8t.u 4t.d.a 8t.u', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'shuffle', usageGroup: 'blues', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'blues_4_4_shuffle_basic', variationRole: 'lift',
    tags: ['blues-rock']
  },
  // Authored: a downstroke-only shuffle deliberately leaves the pendulum.
  {
    id: 'blues_4_4_shuffle_all_down',
    nameJa: 'ブルース・シャッフルオールダウン', nameEn: 'Blues Shuffle All-Downs',
    descriptionJa: 'シャッフルをすべてダウンで刻む',
    descriptionEn: 'Shuffle played entirely with downstrokes',
    pattern: '4t.d 8t.d 4t.d 8t.d 4t.d 8t.d 4t.d 8t.d', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'shuffle', usageGroup: 'special', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'authored', chordArticulation: 'onsetPreferred',
    variationOf: 'blues_4_4_shuffle_basic', variationRole: 'lift',
    tags: ['blues', 'downstrum shuffle']
  },
  {
    id: 'swing_4_4_comping',
    nameJa: 'スウィング・コンピング', nameEn: 'Swing Comping',
    descriptionJa: '3連の1つ目と3つ目で刻むスウィングのコンピング',
    descriptionEn: 'Swing comping on the first and third triplet of each beat',
    pattern: '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'swing', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['swing', 'jazz-pop']
  },
  {
    id: 'triplet_4_4_full',
    nameJa: '3連フルストローク', nameEn: 'Full Triplet Strum',
    descriptionJa: '1拍3連をすべて鳴らす',
    descriptionEn: 'Every triplet eighth strummed',
    pattern: '8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'triplet', usageGroup: 'standard', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['triplet rock', 'slow rock']
  },
  {
    id: 'triplet_4_4_backbeat',
    nameJa: '3連バックビート', nameEn: 'Triplet Backbeat',
    descriptionJa: '3連フルで2・4拍目にアクセント',
    descriptionEn: 'Full triplets accenting beats 2 and 4',
    pattern: '8t.d 8t.u 8t.d 8t.d.a 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d.a 8t.u 8t.d', meter: '4/4',
    style: 'strum', subdivision: 'triplet', family: 'triplet', usageGroup: 'standard', difficulty: 'advanced',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'triplet_4_4_full', variationRole: 'lift',
    tags: ['triplet rock']
  },
  {
    id: 'arp_4_4_quarter',
    nameJa: '4分アルペジオ', nameEn: 'Quarter-Note Arpeggio',
    descriptionJa: '4分で1音ずつ爪弾く',
    descriptionEn: 'One picked note per beat',
    pattern: '4 4 4 4', meter: '4/4',
    style: 'arpeggio', subdivision: 'quarter', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['ballad', 'simple arpeggio']
  },
  {
    id: 'arp_4_4_eighth',
    nameJa: '8分アルペジオ', nameEn: 'Eighth-Note Arpeggio',
    descriptionJa: '8分で1音ずつ爪弾く',
    descriptionEn: 'Picked eighth notes',
    pattern: '8 8 8 8 8 8 8 8', meter: '4/4',
    style: 'arpeggio', subdivision: 'eighth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['pop ballad', 'acoustic']
  },
  {
    id: 'arp_4_4_triplet',
    nameJa: '3連アルペジオ', nameEn: 'Triplet Arpeggio',
    descriptionJa: '3連で1音ずつ爪弾く',
    descriptionEn: 'Picked triplet eighths',
    pattern: '8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t', meter: '4/4',
    style: 'arpeggio', subdivision: 'triplet', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['slow rock', 'ballad']
  },
  {
    id: 'arp_4_4_sixteenth',
    nameJa: '16分アルペジオ', nameEn: 'Sixteenth-Note Arpeggio',
    descriptionJa: '16分で1音ずつ爪弾く',
    descriptionEn: 'Picked sixteenth notes',
    pattern: '16 16 16 16 16 16 16 16 16 16 16 16 16 16 16 16', meter: '4/4',
    style: 'arpeggio', subdivision: 'sixteenth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['fingerstyle timing', 'pop']
  },
  {
    id: 'roll_4_4_whole',
    nameJa: '全音符アルペジアート', nameEn: 'Whole-Note Rolled Chord',
    descriptionJa: '小節頭でアルペジアート（波線）を1回',
    descriptionEn: 'One rolled chord per measure',
    pattern: '1.arp', meter: '4/4',
    style: 'rolled', subdivision: 'quarter', family: 'rolled', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'onsetPreferred',
    tags: ['rolled chord', 'intro', 'ballad']
  },
  {
    id: 'roll_4_4_half',
    nameJa: '2分アルペジアート', nameEn: 'Half-Note Rolled Chords',
    descriptionJa: '2拍ごとにアルペジアート（波線）',
    descriptionEn: 'A rolled chord every two beats',
    pattern: '2.arp 2.arp', meter: '4/4',
    style: 'rolled', subdivision: 'quarter', family: 'rolled', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'onsetPreferred',
    tags: ['rolled chord']
  },
  {
    id: 'strum_2_4_quarter_basic',
    nameJa: '2/4 4分基本', nameEn: '2/4 Quarter Basic',
    descriptionJa: '2/4で1拍に1回ダウン',
    descriptionEn: 'One downstroke per beat in 2/4',
    pattern: '4.d 4.d', meter: '2/4',
    style: 'strum', subdivision: 'quarter', family: 'quarter', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['march', 'folk']
  },
  {
    id: 'strum_2_4_eighth_full',
    nameJa: '2/4 8分フル', nameEn: '2/4 Full Eighths',
    descriptionJa: '2/4で8分をダウン・アップで刻む',
    descriptionEn: 'Down-up eighths in 2/4',
    pattern: '8.d 8.u 8.d 8.u', meter: '2/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['fast folk', 'pop']
  },
  {
    id: 'waltz_3_4_quarter_basic',
    nameJa: '3/4ワルツ基本', nameEn: '3/4 Waltz Basic',
    descriptionJa: '3/4で1拍に1回ダウン',
    descriptionEn: 'One downstroke per beat in 3/4',
    pattern: '4.d 4.d 4.d', meter: '3/4',
    style: 'strum', subdivision: 'quarter', family: 'quarter', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['waltz']
  },
  {
    id: 'waltz_3_4_eighth_flow',
    nameJa: '3/4ワルツ8分フロー', nameEn: '3/4 Waltz Eighth Flow',
    descriptionJa: '3/4で2拍目を8分にして流れを出す',
    descriptionEn: 'Waltz with eighths on beat 2',
    pattern: '4.d 8.d 8.u 4.d', meter: '3/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['waltz', 'folk']
  },
  {
    id: 'waltz_3_4_eighth_full',
    nameJa: '3/4 8分フル', nameEn: '3/4 Full Eighths',
    descriptionJa: '3/4で8分をダウン・アップで刻む',
    descriptionEn: 'Down-up eighths in 3/4',
    pattern: '8.d 8.u 8.d 8.u 8.d 8.u', meter: '3/4',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'waltz_3_4_eighth_flow', variationRole: 'lift',
    tags: ['rock waltz']
  },
  {
    id: 'sustain_3_4_basic',
    nameJa: '3/4サステイン', nameEn: '3/4 Sustain',
    descriptionJa: '3/4で2拍伸ばして3拍目を鳴らす',
    descriptionEn: 'A held half note, then beat 3, in 3/4',
    pattern: '2.d 4.d', meter: '3/4',
    style: 'sustain', subdivision: 'quarter', family: 'sustain', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'low', density: 'sparse', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['waltz ballad']
  },
  {
    id: 'arp_3_4_eighth',
    nameJa: '3/4 8分アルペジオ', nameEn: '3/4 Eighth Arpeggio',
    descriptionJa: '3/4で8分に爪弾く',
    descriptionEn: 'Picked eighth notes in 3/4',
    pattern: '8 8 8 8 8 8', meter: '3/4',
    style: 'arpeggio', subdivision: 'eighth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['waltz arpeggio']
  },
  {
    id: 'compound_6_8_full',
    nameJa: '6/8フルストローク', nameEn: '6/8 Full Strum',
    descriptionJa: '6/8の8分をすべて鳴らす',
    descriptionEn: 'Every eighth strummed in 6/8',
    pattern: '8.d 8.u 8.d 8.d 8.u 8.d', meter: '6/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['6/8 pop', 'rock']
  },
  {
    id: 'compound_6_8_slowrock',
    nameJa: '6/8スローロック', nameEn: '6/8 Slow Rock',
    descriptionJa: '6/8で「4分・8分」を繰り返すスローロック',
    descriptionEn: 'Quarter-eighth pairs in 6/8',
    pattern: '4.d 8.d 4.d 8.d', meter: '6/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['6/8 ballad', 'slow rock']
  },
  {
    id: 'compound_6_8_second_pulse_accent',
    nameJa: '6/8第2パルスアクセント', nameEn: '6/8 Second-Pulse Accent',
    descriptionJa: '6/8の2つ目の付点4分拍にアクセント',
    descriptionEn: 'Full 6/8 eighths accenting the second pulse',
    pattern: '8.d 8.u 8.d 8.d.a 8.u 8.d', meter: '6/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'custom', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'compound_6_8_full', variationRole: 'lift',
    tags: ['6/8 rock']
  },
  {
    id: 'arp_6_8_eighth',
    nameJa: '6/8アルペジオ', nameEn: '6/8 Arpeggio',
    descriptionJa: '6/8で8分に爪弾く',
    descriptionEn: 'Picked eighth notes in 6/8',
    pattern: '8 8 8 8 8 8', meter: '6/8',
    style: 'arpeggio', subdivision: 'eighth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['6/8 ballad']
  },
  {
    id: 'compound_9_8_full',
    nameJa: '9/8フルストローク', nameEn: '9/8 Full Strum',
    descriptionJa: '9/8の8分をすべて鳴らす',
    descriptionEn: 'Every eighth strummed in 9/8',
    pattern: '8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d', meter: '9/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['9/8 compound']
  },
  {
    id: 'arp_9_8_eighth',
    nameJa: '9/8アルペジオ', nameEn: '9/8 Arpeggio',
    descriptionJa: '9/8で8分に爪弾く',
    descriptionEn: 'Picked eighth notes in 9/8',
    pattern: '8 8 8 8 8 8 8 8 8', meter: '9/8',
    style: 'arpeggio', subdivision: 'eighth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['9/8 arpeggio']
  },
  {
    id: 'compound_12_8_full',
    nameJa: '12/8フルストローク', nameEn: '12/8 Full Strum',
    descriptionJa: '12/8の8分をすべて鳴らす',
    descriptionEn: 'Every eighth strummed in 12/8',
    pattern: '8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d', meter: '12/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['12/8 blues', 'ballad']
  },
  {
    id: 'compound_12_8_slowrock',
    nameJa: '12/8スローロック', nameEn: '12/8 Slow Rock',
    descriptionJa: '12/8で「4分・8分」を繰り返すスローロック',
    descriptionEn: 'Quarter-eighth pairs in 12/8',
    pattern: '4.d 8.d 4.d 8.d 4.d 8.d 4.d 8.d', meter: '12/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'downbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    tags: ['12/8 slow rock']
  },
  {
    id: 'compound_12_8_backbeat',
    nameJa: '12/8バックビート', nameEn: '12/8 Backbeat',
    descriptionJa: '12/8の2つ目・4つ目の付点4分拍にアクセント',
    descriptionEn: 'Full 12/8 eighths accenting the second and fourth pulses',
    pattern: '8.d 8.u 8.d 8.d.a 8.u 8.d 8.d 8.u 8.d 8.d.a 8.u 8.d', meter: '12/8',
    style: 'strum', subdivision: 'eighth', family: 'eighth', usageGroup: 'standard', difficulty: 'intermediate',
    feelCompatibility: 'any', energy: 'high', density: 'dense', syncopation: 'none', syncopationKinds: [],
    emphasis: 'backbeat', directionModel: 'pendulum', chordArticulation: 'onsetPreferred',
    variationOf: 'compound_12_8_full', variationRole: 'lift',
    tags: ['12/8 blues-rock']
  },
  {
    id: 'arp_12_8_eighth',
    nameJa: '12/8アルペジオ', nameEn: '12/8 Arpeggio',
    descriptionJa: '12/8で8分に爪弾く',
    descriptionEn: 'Picked eighth notes in 12/8',
    pattern: '8 8 8 8 8 8 8 8 8 8 8 8', meter: '12/8',
    style: 'arpeggio', subdivision: 'eighth', family: 'arpeggio', usageGroup: 'acousticBallad', difficulty: 'beginner',
    feelCompatibility: 'any', energy: 'medium', density: 'medium', syncopation: 'none', syncopationKinds: [],
    emphasis: 'none', directionModel: 'none', chordArticulation: 'freeWithinChord',
    tags: ['12/8 ballad', 'blues']
  }

];

export function getPresetById(id: string): StrummingPatternPreset | undefined {
  return STRUMMING_PATTERN_PRESETS.find(p => p.id === id);
}

export type RhythmPatternParseResult =
  | { ok: true; rhythms: RhythmItem[]; beats: Fraction }
  | { ok: false; detail: string };
/** One stroke of a preset pattern, structurally compatible with the transcription RhythmEvent. */
export interface PresetStroke {
  duration: string;
  direction?: 'd' | 'u';
  accent?: boolean;
  ghost?: boolean;
  tie?: boolean;
  arpeggio?: boolean;
}

/**
 * Splits a preset pattern (e.g. '4.d 8.u.a 1.arp') into strokes: the duration before the first '.',
 * then the d / u / a / g / t / arp modifiers.
 */
export function parsePresetStrokes(pattern: string): PresetStroke[] {
  return pattern.trim().split(/\s+/).map(token => {
    const [duration, ...mods] = token.split('.');
    const stroke: PresetStroke = { duration };
    for (const mod of mods) {
      if (mod === 'd' || mod === 'u') stroke.direction = mod;
      else if (mod === 'a') stroke.accent = true;
      else if (mod === 'g') stroke.ghost = true;
      else if (mod === 't') stroke.tie = true;
      else if (mod === 'arp') stroke.arpeggio = true;
    }
    return stroke;
  });
}

/**
 * Replaces the rhythm tokens in a single GuitarDSL measure line with newRhythmPattern.
 * Preserves chords, barlines (|:, :|, ||, |]), brackets ([1.], [2.]), special marks, and lyrics (l:"...").
 */
export function replaceMeasureLineRhythm(line: string, newRhythmPattern: string): string {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return line;

  // Split line by '|'
  const rawParts = line.split('|');
  if (rawParts.length < 2) return line;

  // We want to handle format:
  // '| chords | rhythm |'
  // '| chords | rhythm l:"..." |'
  // '| % |' -> '| % | newRhythm |'
  // '| chords | % |' -> '| chords | newRhythm |'

  const firstBar = rawParts[0]; // e.g. "" or "  "
  const lastBar = rawParts[rawParts.length - 1]; // e.g. "" or "  "

  const cells = rawParts.slice(1, rawParts.length - 1);

  if (cells.length === 1) {
    // Single cell: '| chords rhythm |' or '| % |'
    const cell = cells[0];
    const lyricMatch = cell.match(/l:\"([^\"]*)\"/);
    const lyric = lyricMatch ? ` l:"${lyricMatch[1]}"` : '';
    const cleanCell = cell.replace(/l:\"[^\"]*\"/, '').trim();

    // Check if repeat
    if (cleanCell === '%') {
      return `${firstBar}| % | ${newRhythmPattern}${lyric} |${lastBar}`;
    }

    // Try to extract chords
    // Chord token pattern
    const tokens = cleanCell.split(/\s+/).filter(Boolean);
    const chords: string[] = [];
    for (const t of tokens) {
      if (/^[A-G][b#]?(?:m|maj|min|dim|aug|sus[24]|add9|[0-9])*(?:\/[A-G][b#]?)?(?:@[A-Za-z0-9_]+)?(?::[0-9.]+|\/[0-9.t+]+)?$/.test(t)) {
        chords.push(t);
      } else {
        break;
      }
    }

    if (chords.length > 0) {
      return `${firstBar}| ${chords.join(' ')} | ${newRhythmPattern}${lyric} |${lastBar}`;
    } else {
      return `${firstBar}| % | ${newRhythmPattern}${lyric} |${lastBar}`;
    }
  } else if (cells.length >= 2) {
    // Standard format: cell 0 is chords, cell 1 is rhythm
    const chordCell = cells[0];
    const rhythmCell = cells[1];

    const lyricMatch = rhythmCell.match(/l:\"([^\"]*)\"/);
    const lyric = lyricMatch ? ` l:"${lyricMatch[1]}"` : '';

    const hasColonStart = rhythmCell.trim().startsWith(':');
    const hasColonEnd = rhythmCell.trim().endsWith(':');
    const colonStart = hasColonStart ? ': ' : '';
    const colonEnd = hasColonEnd ? ' :' : '';

    const chordHasBracket = /\[([0-9]+[.,\-0-9]*)\]/.test(chordCell);
    const rhythmBracketMatch = rhythmCell.match(/\[([0-9]+[.,\-0-9]*)\]/);
    const bracket = (!chordHasBracket && rhythmBracketMatch) ? `${rhythmBracketMatch[0]} ` : '';

    const rightPad = hasColonEnd ? '' : ' ';
    cells[1] = ` ${colonStart}${bracket}${newRhythmPattern}${lyric}${colonEnd}${rightPad}`;

    return `${firstBar}|${cells.join('|')}|${lastBar}`;
  }

  return line;
}

/**
 * Parses a rhythm pattern with the GuitarDSL parser itself (one measure of `meter`), so every accepted
 * token is legal DSL. Rejects inline pitches, note groups, `%`, chords and anything the parser reports as an
 * error. `beats` is the exact length in quarter beats.
 */
export function replaceRhythmInDsl(
  dslText: string,
  newRhythmPattern: string,
  options?: { sectionName?: string }
): string {
  const lines = dslText.split(/\r?\n/);
  const targetSection = options?.sectionName?.trim();
  let inTargetSection = targetSection === undefined;
  const resultLines: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const sectionMatch = trimmed.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      if (targetSection !== undefined) inTargetSection = sectionMatch[1].trim() === targetSection;
      resultLines.push(rawLine);
      continue;
    }
    if (
      !inTargetSection ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('mel:') ||
      trimmed.startsWith('lyr:') ||
      trimmed.startsWith('chord ') ||
      trimmed.startsWith('---') ||
      /^pagebreak$/i.test(trimmed) ||
      !trimmed.includes('|')
    ) {
      resultLines.push(rawLine);
      continue;
    }
    resultLines.push(replaceMeasureLineRhythm(rawLine, newRhythmPattern));
  }
  return resultLines.join('\n');
}

export function parseRhythmPattern(pattern: string, meter = '4/4'): RhythmPatternParseResult {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, detail: 'empty pattern' };
  if (tokens.some(t => t.includes('|') || t.includes('"') || t === '%' || t.startsWith('$') || t.startsWith('['))) {
    return { ok: false, detail: 'a pattern holds rhythm tokens only' };
  }
  const score = parseGuitarDsl(`time: ${meter}\n| ${tokens.join(' ')} |`);
  const errors = score.diagnostics.filter(d => d.severity === 'error');
  if (errors.length > 0) return { ok: false, detail: `invalid rhythm token (${errors[0].code})` };
  const measure = score.measures[0];
  if (!measure || score.measures.length !== 1 || measure.isMeasureRepeat || measure.chords.length > 0) {
    return { ok: false, detail: 'a pattern holds rhythm tokens only' };
  }
  const rhythms = measure.rhythms;
  if (rhythms.length !== tokens.length || rhythms.some(r => r.pitch || r.pitches)) {
    return { ok: false, detail: 'a pattern holds rhythm tokens only (no pitches)' };
  }
  const beats = rhythms.reduce((acc, r) => fadd(acc, rhythmItemBeats(r)), ZERO);
  return { ok: true, rhythms, beats };
}
