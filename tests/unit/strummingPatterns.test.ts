import * as assert from 'assert';
import {
  FAMILY_ORDER,
  STRUMMING_PATTERN_PRESETS,
  StrummingPatternPreset,
  USAGE_GROUP_ORDER,
  getPresetById,
  parseRhythmPattern
} from '../../src/strummingPatterns';
import { classifySyncopation, patternEvents, presetProblems, strokeDirectionProblem, timeSignatureOf } from '../../src/accompaniment';
import { parseGuitarDsl } from '../../src/compiler';
import { feq, frac } from '../../src/duration';
import { measureBeats } from '../../src/scoreEvents';
import { compileGuitarDslToSvg } from '../../src/render/svg';

// §4.3 of the Issue #101 Implementation Contract: id, meter, pattern, energy/density, syncopation, emphasis, direction.
const TABLE: [string, string, string, string, string, string, string][] = [
  ['strum_4_4_quarter_basic', '4/4', '4.d 4.d 4.d 4.d', 'medium/sparse', 'none', 'none', 'pendulum'],
  ['strum_4_4_quarter_backbeat', '4/4', '4.d 4.d.a 4.d 4.d.a', 'medium/sparse', 'none', 'backbeat', 'pendulum'],
  ['strum_4_4_quarter_palm_mute', '4/4', '4.d.pm 4.d.pm 4.d.pm 4.d.pm', 'medium/sparse', 'none', 'none', 'pendulum'],
  ['sustain_4_4_whole', '4/4', '1.d', 'low/sparse', 'none', 'none', 'pendulum'],
  ['sustain_4_4_half', '4/4', '2.d 2.d', 'low/sparse', 'none', 'none', 'pendulum'],
  ['rock_4_4_eighth_full', '4/4', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u', 'high/dense', 'none', 'none', 'pendulum'],
  ['pop_4_4_eighth_orthodox', '4/4', '4.d 8.d 8.u 8.d 8.u 8.d 8.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['pop_4_4_eighth_halfbar', '4/4', '4.d 8.d 8.u 4.d 8.d 8.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['jpop_4_4_eighth_old_faithful', '4/4', '4.d 8.d 4.u 8.u 8.d 8.u', 'medium/medium', 'medium:anticipation+beatCrossing', 'none', 'pendulum'],
  ['folk_4_4_eighth_classic', '4/4', '4.d 8.d 8.u 8.d 8.u 4.d', 'medium/medium', 'none', 'none', 'pendulum'],
  ['ballad_4_4_eighth_sparse', '4/4', '4.d 4.d 8.d 4.u 8.u', 'low/sparse', 'light:anticipation+beatCrossing', 'none', 'pendulum'],
  ['rock_4_4_eighth_push', '4/4', '8.d 8.u 8.d 4.u 8.u 8.d 8.u', 'high/dense', 'medium:anticipation+beatCrossing', 'none', 'pendulum'],
  ['rock_4_4_eighth_backbeat', '4/4', '8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u', 'high/dense', 'none', 'backbeat', 'pendulum'],
  ['reggae_4_4_skank', '4/4', 'r8 8.u r8 8.u r8 8.u r8 8.u', 'medium/sparse', 'strong:offbeat', 'offbeat', 'pendulum'],
  ['rock_4_4_eighth_all_down', '4/4', '8.d 8.d 8.d 8.d 8.d 8.d 8.d 8.d', 'high/dense', 'none', 'none', 'authored'],
  ['rock_4_4_eighth_palm_mute', '4/4', '8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm', 'medium/dense', 'none', 'none', 'pendulum'],
  ['acoustic_4_4_percussive_backbeat', '4/4', '8.d 8.u 8.d.g 8.u 8.d 8.u 8.d.g 8.u', 'medium/dense', 'none', 'backbeat', 'pendulum'],
  ['popfunk_4_4_sixteenth_full', '4/4', '16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u', 'high/dense', 'none', 'none', 'pendulum'],
  ['jpop_4_4_sixteenth_bright_drive', '4/4', '8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u 16.d 16.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['jpop_4_4_sixteenth_singer_songwriter', '4/4', '8.d 8.d 8.d 16.d 16.u 8.d 8.d 8.d 16.d 16.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['jpop_4_4_sixteenth_dynamic_mix', '4/4', '8.d 8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['jpop_4_4_sixteenth_anticipation', '4/4', '8.d 8.d 8.d 16.d 16+8.u 8.d 8.d 16.d 16.u', 'high/medium', 'strong:anticipation+beatCrossing', 'none', 'pendulum'],
  ['acoustic_rock_4_4_sixteenth_syncopated', '4/4', '8.d 16.d 8+16.u 16.d 16.u 8.d 16.d 8+16.u 16.d 16.u', 'high/medium', 'strong:anticipation+beatCrossing', 'none', 'pendulum'],
  ['poprock_4_4_sixteenth_backbeat', '4/4', '16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u', 'high/dense', 'none', 'backbeat', 'pendulum'],
  ['funk_4_4_sixteenth_ghost_motor', '4/4', '16.d 16.u.g 16.d 16.u.g 16.d.a 16.u.g 16.d 16.u.g 16.d 16.u.g 16.d 16.u.g 16.d.a 16.u.g 16.d 16.u.g', 'high/dense', 'none', 'backbeat', 'pendulum'],
  ['reggae_4_4_sixteenth_scratch', '4/4', '16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g 16.d.g 16.u.g 16.d.a 16.u.g', 'medium/dense', 'strong:offbeat', 'custom', 'pendulum'],
  ['rock_4_4_sixteenth_palm_mute', '4/4', '16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm 16.d.pm 16.u.pm', 'high/dense', 'none', 'none', 'pendulum'],
  ['metal_4_4_sixteenth_all_down', '4/4', '16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d 16.d', 'high/dense', 'none', 'none', 'authored'],
  ['swing_4_4_sixteenth_halftime', '4/4', '16.d 16.u 16.d 16.u 16.d 16.u 16.d 16.u 16.d.a 16.u 16.d 16.u 16.d 16.u 16.d 16.u', 'medium/dense', 'none', 'custom', 'pendulum'],
  ['blues_4_4_shuffle_basic', '4/4', '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['bluesrock_4_4_shuffle_backbeat', '4/4', '4t.d 8t.u 4t.d.a 8t.u 4t.d 8t.u 4t.d.a 8t.u', 'high/medium', 'none', 'backbeat', 'pendulum'],
  ['blues_4_4_shuffle_all_down', '4/4', '4t.d 8t.d 4t.d 8t.d 4t.d 8t.d 4t.d 8t.d', 'high/medium', 'none', 'none', 'authored'],
  ['swing_4_4_comping', '4/4', '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u', 'medium/medium', 'none', 'none', 'pendulum'],
  ['triplet_4_4_full', '4/4', '8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d', 'high/dense', 'none', 'none', 'pendulum'],
  ['triplet_4_4_backbeat', '4/4', '8t.d 8t.u 8t.d 8t.d.a 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d.a 8t.u 8t.d', 'high/dense', 'none', 'backbeat', 'pendulum'],
  ['arp_4_4_quarter', '4/4', '4 4 4 4', 'low/sparse', 'none', 'none', 'none'],
  ['arp_4_4_eighth', '4/4', '8 8 8 8 8 8 8 8', 'medium/medium', 'none', 'none', 'none'],
  ['arp_4_4_triplet', '4/4', '8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t 8t', 'medium/dense', 'none', 'none', 'none'],
  ['arp_4_4_sixteenth', '4/4', '16 16 16 16 16 16 16 16 16 16 16 16 16 16 16 16', 'high/dense', 'none', 'none', 'none'],
  ['roll_4_4_whole', '4/4', '1.arp', 'low/sparse', 'none', 'none', 'none'],
  ['roll_4_4_half', '4/4', '2.arp 2.arp', 'low/sparse', 'none', 'none', 'none'],
  ['strum_2_4_quarter_basic', '2/4', '4.d 4.d', 'medium/sparse', 'none', 'none', 'pendulum'],
  ['strum_2_4_eighth_full', '2/4', '8.d 8.u 8.d 8.u', 'high/dense', 'none', 'none', 'pendulum'],
  ['waltz_3_4_quarter_basic', '3/4', '4.d 4.d 4.d', 'medium/sparse', 'none', 'downbeat', 'pendulum'],
  ['waltz_3_4_eighth_flow', '3/4', '4.d 8.d 8.u 4.d', 'medium/medium', 'none', 'downbeat', 'pendulum'],
  ['waltz_3_4_eighth_full', '3/4', '8.d 8.u 8.d 8.u 8.d 8.u', 'high/dense', 'none', 'downbeat', 'pendulum'],
  ['sustain_3_4_basic', '3/4', '2.d 4.d', 'low/sparse', 'none', 'downbeat', 'pendulum'],
  ['arp_3_4_eighth', '3/4', '8 8 8 8 8 8', 'medium/medium', 'none', 'none', 'none'],
  ['compound_6_8_full', '6/8', '8.d 8.u 8.d 8.d 8.u 8.d', 'high/dense', 'none', 'downbeat', 'pendulum'],
  ['compound_6_8_slowrock', '6/8', '4.d 8.d 4.d 8.d', 'medium/medium', 'none', 'downbeat', 'pendulum'],
  ['compound_6_8_second_pulse_accent', '6/8', '8.d 8.u 8.d 8.d.a 8.u 8.d', 'high/dense', 'none', 'custom', 'pendulum'],
  ['arp_6_8_eighth', '6/8', '8 8 8 8 8 8', 'medium/medium', 'none', 'none', 'none'],
  ['compound_9_8_full', '9/8', '8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d', 'high/dense', 'none', 'downbeat', 'pendulum'],
  ['arp_9_8_eighth', '9/8', '8 8 8 8 8 8 8 8 8', 'medium/medium', 'none', 'none', 'none'],
  ['compound_12_8_full', '12/8', '8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d 8.d 8.u 8.d', 'high/dense', 'none', 'downbeat', 'pendulum'],
  ['compound_12_8_slowrock', '12/8', '4.d 8.d 4.d 8.d 4.d 8.d 4.d 8.d', 'medium/medium', 'none', 'downbeat', 'pendulum'],
  ['compound_12_8_backbeat', '12/8', '8.d 8.u 8.d 8.d.a 8.u 8.d 8.d 8.u 8.d 8.d.a 8.u 8.d', 'high/dense', 'none', 'backbeat', 'pendulum'],
  ['arp_12_8_eighth', '12/8', '8 8 8 8 8 8 8 8 8 8 8 8', 'medium/medium', 'none', 'none', 'none']
];

const BEGINNER = ['strum_4_4_quarter_basic', 'strum_4_4_quarter_backbeat', 'sustain_4_4_whole', 'sustain_4_4_half', 'pop_4_4_eighth_orthodox',
  'pop_4_4_eighth_halfbar', 'folk_4_4_eighth_classic', 'ballad_4_4_eighth_sparse', 'arp_4_4_quarter', 'arp_4_4_eighth', 'roll_4_4_whole', 'roll_4_4_half',
  'strum_2_4_quarter_basic', 'waltz_3_4_quarter_basic', 'sustain_3_4_basic', 'arp_3_4_eighth', 'compound_6_8_slowrock', 'arp_6_8_eighth', 'arp_9_8_eighth',
  'compound_12_8_slowrock', 'arp_12_8_eighth'];
const ADVANCED = ['popfunk_4_4_sixteenth_full', 'jpop_4_4_sixteenth_anticipation', 'acoustic_rock_4_4_sixteenth_syncopated', 'funk_4_4_sixteenth_ghost_motor',
  'reggae_4_4_sixteenth_scratch', 'rock_4_4_sixteenth_palm_mute', 'metal_4_4_sixteenth_all_down', 'swing_4_4_sixteenth_halftime', 'triplet_4_4_full',
  'triplet_4_4_backbeat'];
const VARIATIONS: Record<string, [string, string]> = {
  rock_4_4_eighth_backbeat: ['rock_4_4_eighth_full', 'lift'],
  rock_4_4_eighth_push: ['rock_4_4_eighth_full', 'fill'],
  rock_4_4_eighth_palm_mute: ['rock_4_4_eighth_full', 'breakdown'],
  jpop_4_4_eighth_old_faithful: ['pop_4_4_eighth_orthodox', 'lift'],
  jpop_4_4_sixteenth_dynamic_mix: ['jpop_4_4_sixteenth_bright_drive', 'fill'],
  jpop_4_4_sixteenth_anticipation: ['jpop_4_4_sixteenth_bright_drive', 'lift'],
  poprock_4_4_sixteenth_backbeat: ['popfunk_4_4_sixteenth_full', 'lift'],
  rock_4_4_sixteenth_palm_mute: ['popfunk_4_4_sixteenth_full', 'breakdown'],
  bluesrock_4_4_shuffle_backbeat: ['blues_4_4_shuffle_basic', 'lift'],
  blues_4_4_shuffle_all_down: ['blues_4_4_shuffle_basic', 'lift'],
  triplet_4_4_backbeat: ['triplet_4_4_full', 'lift'],
  waltz_3_4_eighth_full: ['waltz_3_4_eighth_flow', 'lift'],
  compound_6_8_second_pulse_accent: ['compound_6_8_full', 'lift'],
  compound_12_8_backbeat: ['compound_12_8_full', 'lift']
};

/** §4.3A style / subdivision / family, in rule order. */
function expectedTaxonomy(id: string): [string, string, string] {
  if (id.startsWith('sustain_')) return ['sustain', 'quarter', 'sustain'];
  if (id.startsWith('arp_')) return ['arpeggio', id.slice(id.lastIndexOf('_') + 1), 'arpeggio'];
  if (id.startsWith('roll_')) return ['rolled', 'quarter', 'rolled'];
  if (id.includes('_shuffle_')) return ['strum', 'triplet', 'shuffle'];
  if (id === 'swing_4_4_comping') return ['strum', 'triplet', 'swing'];
  if (id === 'swing_4_4_sixteenth_halftime') return ['strum', 'sixteenth', 'swing'];
  if (id.startsWith('triplet_')) return ['strum', 'triplet', 'triplet'];
  if (id.includes('_sixteenth_')) return ['strum', 'sixteenth', 'sixteenth'];
  if (id.includes('_eighth_') || id.startsWith('compound_') || id === 'reggae_4_4_skank' || id === 'acoustic_4_4_percussive_backbeat') return ['strum', 'eighth', 'eighth'];
  return ['strum', 'quarter', 'quarter'];
}

/** §4.3A usage group (D2: `*_all_down` -> special first). */
function expectedUsageGroup(id: string): string {
  if (id.endsWith('_all_down')) return 'special';
  if (id === 'strum_4_4_quarter_palm_mute') return 'rockPunkMetal';
  const prefixes: [string, string][] = [['jpop_', 'popJpop'], ['pop_', 'popJpop'], ['rock_', 'rockPunkMetal'], ['metal_', 'rockPunkMetal'], ['poprock_', 'rockPunkMetal'],
    ['popfunk_', 'funkSoulDisco'], ['funk_', 'funkSoulDisco'], ['reggae_', 'reggaeSka'], ['blues_', 'blues'], ['bluesrock_', 'blues'], ['folk_', 'acousticBallad'],
    ['ballad_', 'acousticBallad'], ['acoustic_', 'acousticBallad'], ['sustain_', 'acousticBallad'], ['arp_', 'acousticBallad'], ['roll_', 'acousticBallad']];
  return prefixes.find(([p]) => id.startsWith(p))?.[1] ?? 'standard';
}

const events = (pattern: string, meter = '4/4') => {
  const parsed = parseRhythmPattern(pattern, meter);
  assert.ok(parsed.ok, pattern);
  return patternEvents(parsed.rhythms);
};
const ts = (meter: string) => timeSignatureOf(meter)!;

describe('canonical accompaniment preset catalog (Issue #101)', () => {
  it('T001 has exactly the 58 contract presets in declaration order, with unique ids and no subjective duplicate', () => {
    assert.deepStrictEqual(STRUMMING_PATTERN_PRESETS.map(p => p.id), TABLE.map(r => r[0]));
    assert.strictEqual(new Set(STRUMMING_PATTERN_PRESETS.map(p => p.id)).size, 58);
    // Same output, feel compatibility, emphasis and direction model may only coexist under different groove families.
    const keys = STRUMMING_PATTERN_PRESETS.map(p => [p.meter, p.pattern, JSON.stringify(p.feelCompatibility), p.emphasis, p.directionModel, p.family].join('|'));
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  it('T001 machine-readable metadata equals the contract table and the §4.3A / D2 / D3 assignments', () => {
    for (const [id, meter, pattern, ed, sync, emphasis, direction] of TABLE) {
      const p = getPresetById(id) as StrummingPatternPreset;
      const [energy, density] = ed.split('/');
      const [level, kinds] = sync === 'none' ? ['none', ''] : sync.split(':');
      assert.deepStrictEqual(
        [p.meter, p.pattern, p.energy, p.density, p.syncopation, p.syncopationKinds.join('+'), p.emphasis, p.directionModel],
        [meter, pattern, energy, density, level, kinds, emphasis, direction],
        id
      );
      assert.deepStrictEqual([p.style, p.subdivision, p.family], expectedTaxonomy(id), id);
      assert.strictEqual(p.usageGroup, expectedUsageGroup(id), id);
      assert.strictEqual(p.difficulty, BEGINNER.includes(id) ? 'beginner' : ADVANCED.includes(id) ? 'advanced' : 'intermediate', id);
      assert.deepStrictEqual(p.feelCompatibility, id === 'swing_4_4_sixteenth_halftime' ? ['swing'] : 'any', id);
      assert.strictEqual(p.chordArticulation, id.startsWith('reggae_') ? 'offbeatAllowed' : id.startsWith('arp_') ? 'freeWithinChord' : 'onsetPreferred', id);
      assert.deepStrictEqual(p.variationOf === undefined ? undefined : [p.variationOf, p.variationRole], VARIATIONS[id], id);
      assert.ok(p.nameJa && p.nameEn && p.descriptionJa && p.descriptionEn && p.tags.length > 0, id);
    }
    assert.ok(FAMILY_ORDER.every(f => STRUMMING_PATTERN_PRESETS.some(p => p.family === f)));
    assert.ok(USAGE_GROUP_ORDER.every(g => STRUMMING_PATTERN_PRESETS.some(p => p.usageGroup === g)));
  });

  it('T001 keeps the §11C classification examples (all-downs are special per D2)', () => {
    const cls = (id: string) => { const p = getPresetById(id)!; return `${p.meter}/${p.family}/${p.usageGroup}`; };
    assert.strictEqual(cls('jpop_4_4_eighth_old_faithful'), '4/4/eighth/popJpop');
    assert.strictEqual(cls('rock_4_4_eighth_all_down'), '4/4/eighth/special');
    assert.strictEqual(cls('reggae_4_4_skank'), '4/4/eighth/reggaeSka');
    assert.strictEqual(cls('jpop_4_4_sixteenth_anticipation'), '4/4/sixteenth/popJpop');
    assert.strictEqual(cls('funk_4_4_sixteenth_ghost_motor'), '4/4/sixteenth/funkSoulDisco');
    assert.strictEqual(cls('blues_4_4_shuffle_basic'), '4/4/shuffle/blues');
    assert.strictEqual(cls('arp_4_4_eighth'), '4/4/arpeggio/acousticBallad');
    assert.strictEqual(cls('waltz_3_4_quarter_basic'), '3/4/quarter/standard');
  });

  it('T002/T003 every pattern parses with the real parser and fills its meter exactly', () => {
    for (const p of STRUMMING_PATTERN_PRESETS) {
      const parsed = parseRhythmPattern(p.pattern, p.meter);
      assert.ok(parsed.ok, p.id);
      assert.ok(feq(parsed.beats, measureBeats(ts(p.meter))), p.id);
      const score = parseGuitarDsl(`time: ${p.meter}\n| C | ${p.pattern} |`);
      assert.deepStrictEqual(score.diagnostics, [], p.id);
    }
  });

  it('T004 / §4.4 every preset passes the mechanical self-check (direction model, syncopation, style, emphasis, variations)', () => {
    for (const p of STRUMMING_PATTERN_PRESETS) assert.deepStrictEqual(presetProblems(p), [], p.id);
  });

  it('T004 the self-check catches wrong metadata instead of trusting it', () => {
    const base = getPresetById('rock_4_4_eighth_full')!;
    const check = (patch: Partial<StrummingPatternPreset>) => presetProblems({ ...base, ...patch });
    assert.ok(check({ pattern: '8.d 8.d 8.u 8.u 8.d 8.u 8.d 8.u' }).some(e => e.startsWith('pendulum')));
    assert.ok(check({ pattern: '8.d 8.u 8.d 8.u 8.d 8.u 8.d' }).includes('pattern length differs from the meter'));
    assert.ok(check({ directionModel: 'authored' }).some(e => e.includes('follows the pendulum')));
    assert.ok(check({ directionModel: 'none' }).some(e => e.includes('must not carry')));
    assert.ok(check({ syncopation: 'medium', syncopationKinds: ['anticipation'] }).some(e => e.startsWith('syncopationKinds')));
    assert.ok(check({ emphasis: 'none', pattern: '8.d 8.u 8.d.a 8.u 8.d 8.u 8.d.a 8.u' }).includes('emphasis none but the pattern has .a'));
    assert.ok(check({ emphasis: 'backbeat', pattern: '8.d.a 8.u 8.d 8.u 8.d 8.u 8.d 8.u' }).some(e => e.startsWith('backbeat')));
    assert.ok(check({ variationOf: 'waltz_3_4_eighth_flow', variationRole: 'lift' }).some(e => e.includes('share meter and family')));
    assert.ok(check({ style: 'rolled' }).some(e => e.startsWith('rolled')));
  });

  it('T005 straight eighths: full D U D U ..., the phase holds across rests', () => {
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u')), undefined);
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('4.d r8 8.u r8 8.u 4.d')), undefined);
    assert.match(strokeDirectionProblem(ts('4/4'), events('4.d r8 8.d r8 8.u 4.d')) ?? '', /should be \.u/);
  });

  it('T006 sixteenths: a 16th onset selects the 16th phase; eighth positions alone use the eighth phase', () => {
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('8.d 8.d 16.d 16.u 16.d 16.u 8.d 8.d 16.d 16.u 16.d 16.u')), undefined);
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u')), undefined);
    // Without a 16th onset the & is an upstroke (eighth pendulum), not a downstroke.
    assert.match(strokeDirectionProblem(ts('4/4'), events('8.d 8.d 8.d 8.d 8.d 8.d 8.d 8.d')) ?? '', /should be \.u/);
  });

  it('T007 all-down only exists as authored presets', () => {
    const authored = STRUMMING_PATTERN_PRESETS.filter(p => p.directionModel === 'authored').map(p => p.id);
    assert.deepStrictEqual(authored, ['rock_4_4_eighth_all_down', 'metal_4_4_sixteenth_all_down', 'blues_4_4_shuffle_all_down']);
    for (const id of authored) assert.ok(strokeDirectionProblem(ts('4/4'), events(getPresetById(id)!.pattern)), id);
  });

  it('T008 shuffle 4t.d 8t.u per beat; full triplets D U D', () => {
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u')), undefined);
    assert.strictEqual(strokeDirectionProblem(ts('4/4'), events('8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d 8t.d 8t.u 8t.d')), undefined);
    assert.ok(strokeDirectionProblem(ts('4/4'), events('4t.d 8t.d 4t.d 8t.d 4t.d 8t.d 4t.d 8t.d')));
  });

  it('T009-T012 meters: 3/4 = 3 beats, 6/8 D U D | D U D, 9/8 = 4.5 beats, 12/8 = 6 beats', () => {
    const beatsOf = (p: StrummingPatternPreset) => {
      const parsed = parseRhythmPattern(p.pattern, p.meter);
      assert.ok(parsed.ok, p.id);
      return parsed.beats;
    };
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.meter === '3/4')) assert.ok(feq(beatsOf(p), frac(3)), p.id);
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.meter === '9/8')) assert.ok(feq(beatsOf(p), frac(9, 2)), p.id);
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.meter === '12/8')) assert.ok(feq(beatsOf(p), frac(6)), p.id);
    assert.deepStrictEqual(ts('6/8').groups, [3, 3]);
    assert.deepStrictEqual(ts('9/8').groups, [3, 3, 3]);
    assert.deepStrictEqual(ts('12/8').groups, [3, 3, 3, 3]);
    assert.strictEqual(strokeDirectionProblem(ts('6/8'), events('8.d 8.u 8.d 8.d 8.u 8.d', '6/8')), undefined);
    assert.ok(strokeDirectionProblem(ts('6/8'), events('8.d 8.u 8.d 8.u 8.d 8.u', '6/8')), '6/8 resets the phase on the second pulse');
    assert.ok(feq(measureBeats(ts('9/8')), frac(9, 2)));
    assert.ok(feq(measureBeats(ts('12/8')), frac(6)));
  });

  it('T013/T014 arpeggios carry no direction; rolled presets use .arp; sustains are long', () => {
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.style === 'arpeggio')) {
      assert.strictEqual(p.directionModel, 'none');
      assert.ok(!/\.(d|u|arp)\b/.test(p.pattern), p.id);
    }
    assert.deepStrictEqual(STRUMMING_PATTERN_PRESETS.filter(p => p.style === 'arpeggio').map(p => p.subdivision).filter((v, i, a) => a.indexOf(v) === i).sort(), ['eighth', 'quarter', 'sixteenth', 'triplet']);
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.style === 'rolled')) assert.ok(p.pattern.split(' ').every(t => t.endsWith('.arp')), p.id);
    for (const p of STRUMMING_PATTERN_PRESETS.filter(p => p.style === 'sustain')) {
      assert.ok(events(p.pattern, p.meter).every(e => e.beats.n / e.beats.d >= 1), p.id);
    }
  });

  it('T015-T017 syncopation is judged from onsets and durations', () => {
    assert.deepStrictEqual(classifySyncopation(ts('4/4'), events('r8 8.u r8 8.u r8 8.u r8 8.u')), ['offbeat']);
    // Old faithful: the upstroke at 1.5 sounds until 2.5 over beat 3 -> anticipation + beatCrossing, not "D D U U".
    const oldFaithful = events('4.d 8.d 4.u 8.u 8.d 8.u');
    assert.strictEqual(oldFaithful[2].onset.n / oldFaithful[2].onset.d, 1.5);
    assert.deepStrictEqual(classifySyncopation(ts('4/4'), oldFaithful), ['anticipation', 'beatCrossing']);
    const sixteenth = events('8.d 16.d 8+16.u 16.d 16.u 8.d 16.d 8+16.u 16.d 16.u');
    assert.strictEqual(sixteenth[2].onset.n / sixteenth[2].onset.d, 0.75);
    assert.deepStrictEqual(classifySyncopation(ts('4/4'), sixteenth), ['anticipation', 'beatCrossing']);
    assert.deepStrictEqual(classifySyncopation(ts('4/4'), events('8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u')), []);
  });

  it('parseRhythmPattern rejects pitches, chords and garbage', () => {
    assert.strictEqual(parseRhythmPattern('c4/8 8.d').ok, false);
    assert.strictEqual(parseRhythmPattern('8.d xyz').ok, false);
    assert.strictEqual(parseRhythmPattern('C 4.d').ok, false);
    assert.strictEqual(parseRhythmPattern('%').ok, false);
    assert.strictEqual(parseRhythmPattern('').ok, false);
  });
});

describe('strummingPatterns - arpeggio notation', () => {
  describe('inline pitch notes and arpeggio rendering', () => {
    it('parses inline melody/arpeggio notes in measure line with zero errors', () => {
      const dsl = `
key: C
bpm: 120
[Intro]
| C | c3/8 e3/8 g3/8 c4/8 4.d 4.d |
| Am | c3/8 e3/8 a3/8 c4/8 e3/8 a3/8 c4/8 e4/8 |
`;
      const parsed = parseGuitarDsl(dsl);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      assert.strictEqual(errors.length, 0);

      const bar1 = parsed.measures[0];
      assert.strictEqual(bar1.rhythms.length, 6);
      assert.deepStrictEqual(bar1.rhythms[0].pitch, { step: 'c', alter: 0, octave: 3 });
      assert.deepStrictEqual(bar1.rhythms[1].pitch, { step: 'e', alter: 0, octave: 3 });
      assert.strictEqual(bar1.rhythms[4].pitch, undefined); // 4.d slash

      const bar2 = parsed.measures[1];
      assert.strictEqual(bar2.rhythms.length, 8);
      assert.deepStrictEqual(bar2.rhythms[7].pitch, { step: 'e', alter: 0, octave: 4 });
    });

    it('parses arpeggiato wavy sign modifier (.arp)', () => {
      const dsl = `
key: C
bpm: 120
[Outro]
| C | 1.arp |
| G | 2.arp 2.arp |
`;
      const parsed = parseGuitarDsl(dsl);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      assert.strictEqual(errors.length, 0);

      assert.strictEqual(parsed.measures[0].rhythms[0].arpeggio, true);
      assert.strictEqual(parsed.measures[1].rhythms[0].arpeggio, true);
      assert.strictEqual(parsed.measures[1].rhythms[1].arpeggio, true);
    });

    it('renders inline notes and arpeggio signs into valid SVG output', () => {
      const dsl = `
title: Arpeggio Test
key: C
bpm: 120
[Intro]
| C | c3/8 e3/8 g3/8 c4/8 4.d 4.d |
| G | 1.arp |
`;
      const svg = compileGuitarDslToSvg(dsl);
      assert.ok(svg.includes('<svg'));
      assert.ok(svg.includes('class="notehead"')); // notehead for c3/8
      assert.ok(svg.includes('fill="none" stroke="#000" stroke-width="1.3"')); // arpeggio wavy sign
    });
  });
});
