import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { feq, fnum, frac } from '../../src/duration';
import {
  applyScoreEvent,
  beamGroupIndex,
  defaultBeatGroups,
  initialContext,
  measureBeats,
  parseDirective,
  parseTimeSignature,
  structuralChange
} from '../../src/scoreEvents';

function codes(dsl: string): string[] {
  return parseGuitarDsl(dsl).diagnostics.map(d => d.code);
}

describe('scoreEvents - time signatures', () => {
  it('derives default groupings (T004)', () => {
    assert.deepStrictEqual(defaultBeatGroups(6, 8), [3, 3]);
    assert.deepStrictEqual(defaultBeatGroups(9, 8), [3, 3, 3]);
    assert.deepStrictEqual(defaultBeatGroups(5, 8), [2, 3]);
    assert.deepStrictEqual(defaultBeatGroups(7, 8), [2, 2, 3]);
    assert.deepStrictEqual(defaultBeatGroups(4, 4), [1, 1, 1, 1]);
    assert.deepStrictEqual(defaultBeatGroups(3, 8), [1, 1, 1]);
  });

  it('keeps an explicit grouping and validates it (T004)', () => {
    const ts = parseTimeSignature('7/8(2+2+3)');
    assert.ok(ts.ok);
    assert.deepStrictEqual(ts.ok && ts.value.groups, [2, 2, 3]);
    const other = parseTimeSignature('7/8(3+2+2)');
    assert.deepStrictEqual(other.ok && other.value.groups, [3, 2, 2]);
    assert.deepStrictEqual(parseTimeSignature('7/8(2+2+2)'), { ok: false, code: 'invalidBeatGrouping' });
    assert.deepStrictEqual(parseTimeSignature('4/4(4)'), { ok: false, code: 'invalidBeatGrouping' });
    assert.deepStrictEqual(parseTimeSignature('7/8(2+x)'), { ok: false, code: 'invalidBeatGrouping' });
  });

  it('rejects invalid meters', () => {
    for (const v of ['7/x', '0/4', '33/4', '4/3', '4/32', '4', '']) {
      assert.deepStrictEqual(parseTimeSignature(v), { ok: false, code: 'invalidTimeSignature' }, v);
    }
    assert.ok(parseTimeSignature('32/16').ok);
  });

  it('computes the measure length as numerator × 4 / denominator', () => {
    const beats = (s: string) => {
      const ts = parseTimeSignature(s);
      assert.ok(ts.ok);
      return ts.ok ? measureBeats(ts.value) : frac(0);
    };
    assert.ok(feq(beats('4/4'), frac(4)));
    assert.ok(feq(beats('3/4'), frac(3)));
    assert.ok(feq(beats('6/8'), frac(3)));
    assert.ok(feq(beats('7/8'), frac(7, 2)));
    assert.ok(feq(beats('2/2'), frac(4)));
    assert.ok(feq(beats('5/16'), frac(5, 4)));
  });

  it('groups beams by beat group (4/4 per beat, 6/8 per dotted quarter, 3/8 per eighth)', () => {
    const ts = (s: string) => {
      const r = parseTimeSignature(s);
      assert.ok(r.ok);
      return r.ok ? r.value : (undefined as never);
    };
    assert.deepStrictEqual([0, 0.5, 1, 3.5].map(o => beamGroupIndex(ts('4/4'), o)), [0, 0, 1, 3]);
    assert.deepStrictEqual([0, 1, 1.5, 2.5].map(o => beamGroupIndex(ts('6/8'), o)), [0, 0, 1, 1]);
    assert.deepStrictEqual([0, 0.5, 1, 1.5, 2].map(o => beamGroupIndex(ts('7/8(2+2+3)'), o)), [0, 0, 1, 1, 2]);
    assert.deepStrictEqual([0, 0.5, 1].map(o => beamGroupIndex(ts('3/8'), o)), [0, 1, 2]);
    assert.deepStrictEqual([0, 0.5, 1].map(o => beamGroupIndex(ts('3/8(1+1+1)'), o)), [0, 1, 2]);
  });
});

describe('scoreEvents - directive values and context', () => {
  it('normalizes directive values', () => {
    assert.deepStrictEqual(parseDirective('tempo', '132'), { ok: true, payload: { kind: 'tempoChange', bpm: 132 } });
    assert.deepStrictEqual(parseDirective('bpm', '96.5'), { ok: true, payload: { kind: 'tempoChange', bpm: 96.5 } });
    assert.deepStrictEqual(parseDirective('tempo', 'rit.'), { ok: true, payload: { kind: 'tempoMark', mark: 'ritardando' } });
    assert.deepStrictEqual(parseDirective('tempo', 'Accel.'), { ok: true, payload: { kind: 'tempoMark', mark: 'accelerando' } });
    assert.deepStrictEqual(parseDirective('tempo', 'a  tempo'), { ok: true, payload: { kind: 'tempoMark', mark: 'aTempo' } });
    assert.deepStrictEqual(parseDirective('tempo', 'tempo primo'), { ok: true, payload: { kind: 'tempoMark', mark: 'tempoPrimo' } });
    assert.deepStrictEqual(parseDirective('bpm', 'rit.'), { ok: false, code: 'invalidScoreEvent' });
    assert.deepStrictEqual(parseDirective('key', 'F#m'), { ok: true, payload: { kind: 'keyChange', key: 'F#m', keySignature: 3 } });
    assert.deepStrictEqual(parseDirective('key', 'H'), { ok: false, code: 'invalidScoreEvent' });
    assert.deepStrictEqual(parseDirective('feel', 'Swing'), { ok: true, payload: { kind: 'feelChange', feel: 'swing' } });
    assert.deepStrictEqual(parseDirective('feel', 'latin'), { ok: false, code: 'invalidFeel' });
    assert.deepStrictEqual(parseDirective('dynamic', 'mf'), { ok: true, payload: { kind: 'dynamic', dynamic: 'mf' } });
    assert.deepStrictEqual(parseDirective('dynamic', 'mff'), { ok: false, code: 'invalidScoreEvent' });
    assert.deepStrictEqual(parseDirective('ottava', 'off'), { ok: true, payload: { kind: 'ottavaChange', ottava: 'none' } });
    assert.deepStrictEqual(parseDirective('ottava', '15ma'), { ok: false, code: 'invalidScoreEvent' });
    assert.deepStrictEqual(parseDirective('mark', ''), { ok: false, code: 'invalidScoreEvent' });
    assert.deepStrictEqual(parseDirective('capo', '2'), { ok: false, code: 'invalidScoreEvent' });
  });

  it('applies persistent events only; tempo primo restores a valid initial BPM (T019)', () => {
    const ts = parseTimeSignature('4/4');
    assert.ok(ts.ok);
    const start = initialContext({ key: 'C', bpm: '120', timeSignature: ts.ok ? ts.value : (undefined as never), feel: 'straight' });
    let ctx = applyScoreEvent(start, { kind: 'tempoChange', bpm: 150 }, 120);
    assert.strictEqual(ctx.tempoBpm, 150);
    ctx = applyScoreEvent(ctx, { kind: 'dynamic', dynamic: 'f' }, 120);
    assert.strictEqual(ctx, applyScoreEvent(ctx, { kind: 'text', text: 'x' }, 120));
    ctx = applyScoreEvent(ctx, { kind: 'tempoMark', mark: 'tempoPrimo' }, 120);
    assert.strictEqual(ctx.tempoBpm, 120);
    const noInitial = applyScoreEvent({ ...ctx, tempoBpm: 150 }, { kind: 'tempoMark', mark: 'tempoPrimo' }, null);
    assert.strictEqual(noInitial.tempoBpm, 150);
  });
});

describe('compiler - score timeline', () => {
  it('keeps legacy defaults and adds no events (T001)', () => {
    const score = parseGuitarDsl('| C | 4.d 4.d 4.d 4.d |');
    assert.strictEqual(score.originalKey, 'C');
    assert.strictEqual(score.bpm, '90');
    assert.strictEqual(score.capo, '0');
    assert.deepStrictEqual(score.timeSignature, { numerator: 4, denominator: 4, groups: [1, 1, 1, 1] });
    assert.strictEqual(score.feel, 'straight');
    assert.strictEqual(score.pickup, undefined);
    assert.deepStrictEqual(score.events, []);
    assert.ok(feq(score.measures[0].expectedBeats, frac(4)));
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('parses the initial time / feel / pickup headers (T003)', () => {
    const score = parseGuitarDsl('time: 6/8\nfeel: shuffle\npickup: 8+8+8\n| C | 8 8 8 |\n| C | 8 8 8 8 8 8 |');
    assert.deepStrictEqual(score.timeSignature, { numerator: 6, denominator: 8, groups: [3, 3] });
    assert.strictEqual(score.feel, 'shuffle');
    assert.ok(score.pickup && feq(score.pickup, frac(3, 2)));
    assert.strictEqual(score.measures[0].isPickup, true);
    assert.deepStrictEqual(score.diagnostics, []);
    const aliases = parseGuitarDsl('meter: 3/4\n| C |');
    assert.strictEqual(aliases.timeSignature.numerator, 3);
    assert.strictEqual(parseGuitarDsl('time_signature: 5/8\n| C |').timeSignature.denominator, 8);
  });

  it('resolves persistent context until the next change (T005)', () => {
    const score = parseGuitarDsl('| C |\n@key: D\n@tempo: 132\n@feel: swing\n| D |\n| A |\n@key: E\n| E |');
    const ctx = score.measures.map(m => [m.context.key, m.context.tempoBpm, m.context.feel]);
    assert.deepStrictEqual(ctx, [['C', 90, 'straight'], ['D', 132, 'swing'], ['D', 132, 'swing'], ['E', 132, 'swing']]);
    assert.strictEqual(score.measures[1].context.keySignature, 2);
    // Initial metadata is not the last directive seen.
    assert.strictEqual(score.originalKey, 'C');
    assert.strictEqual(score.keySignature, 0);
    assert.strictEqual(score.bpm, '90');
  });

  it('attaches several events before one measure in source order (T006, contract §5.2)', () => {
    const score = parseGuitarDsl('| C |\n@mark: B\n@key: D\n@tempo: 140\n@dynamic: f\n@text: Palm mute\n| D |');
    const m = score.measures[1];
    assert.deepStrictEqual(m.eventsBefore.map(e => e.kind), ['rehearsalMark', 'keyChange', 'tempoChange', 'dynamic', 'text']);
    assert.ok(m.eventsBefore.every(e => e.beforeMeasure === 1));
    assert.strictEqual(m.context.key, 'D');
    assert.strictEqual(m.context.tempoBpm, 140);
    assert.deepStrictEqual(score.measures[0].eventsBefore, []);
  });

  it('records value spans without the trailing comment', () => {
    const src = '| C |\n  @key:   Bb   # modulate\n| Bb |';
    const ev = parseGuitarDsl(src).events[0];
    assert.strictEqual(src.split('\n')[ev.line].slice(ev.valueStart, ev.valueEnd), 'Bb');
    assert.strictEqual(ev.directive, '@key');
  });

  it('warns about an event after the last measure (T007)', () => {
    const score = parseGuitarDsl('| C |\n@dynamic: f\n');
    assert.deepStrictEqual(score.diagnostics.map(d => [d.code, d.severity, d.line]), [['orphanScoreEvent', 'warning', 1]]);
    assert.deepStrictEqual(score.measures[0].eventsBefore, []);
  });

  it('reports malformed events and keeps the context (T008)', () => {
    const score = parseGuitarDsl('time: 3/4\n| C | 4 4 4 |\n@time: 7/x\n| C | 4 4 4 |\n@foo: 1\n@key: Q\n| C | 4 4 4 |');
    assert.deepStrictEqual(score.diagnostics.map(d => d.code), ['invalidTimeSignature', 'invalidScoreEvent', 'invalidScoreEvent']);
    assert.ok(score.measures.every(m => m.context.timeSignature.numerator === 3));
    assert.strictEqual(score.measures.length, 3);
    // The unknown name is highlighted, the invalid value is highlighted.
    const [, unknown, badKey] = score.diagnostics;
    assert.deepStrictEqual([unknown.startCol, unknown.endCol], [0, 5]);
    assert.deepStrictEqual([badKey.startCol, badKey.endCol], [6, 7]);
  });

  it('validates beat counts against each measure meter (T009)', () => {
    assert.deepStrictEqual(codes('time: 3/4\n| C | 4 4 4 |'), []);
    const four = parseGuitarDsl('time: 3/4\n| C | 4 4 4 4 |').diagnostics;
    assert.deepStrictEqual(four.map(d => [d.code, d.args]), [['beatCountMismatch', { beats: '4', expected: '3' }]]);
    assert.deepStrictEqual(codes('time: 6/8\n| C | 8 8 8 8 8 8 |'), []);
    assert.deepStrictEqual(codes('time: 7/8\n| C | 8 8 8 8 8 8 8 |'), []);
    assert.deepStrictEqual(codes('| C | 4 4 4 4 |\n@time: 7/8\n| C | 8 8 8 8 8 8 8 |\n| C | 4 4 4 4 |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('| C | 4 4 4 |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('time: 3/4\n| C |\nmel: | c4/4 d e |'), []);
    assert.deepStrictEqual(codes('time: 3/4\n| C |\nmel: | c4/1 |'), ['beatCountMismatch']);
  });

  it('generates default rhythms for the meter', () => {
    const three = parseGuitarDsl('time: 3/4\n| C |').measures[0].rhythms;
    assert.deepStrictEqual(three.map(r => [r.duration, r.down]), [['4', true], ['4', true], ['4', true]]);
    const six = parseGuitarDsl('time: 6/8\n| C |').measures[0].rhythms;
    assert.deepStrictEqual(six.map(r => [r.duration, r.down]), [['8', true], ['8', false], ['8', false], ['8', true], ['8', false], ['8', false]]);
    const legacy = parseGuitarDsl('| C |').measures[0].rhythms;
    assert.deepStrictEqual(legacy.map(r => [r.duration, r.down]), [['4', true], ['4', false], ['4', true], ['4', false]]);
    const chords = parseGuitarDsl('time: 3/4\n| C G Am |').measures[0].chords;
    assert.deepStrictEqual(chords.map(c => c.beat), [0, 1, 2]);
  });

  it('accepts a pickup and its complementary final measure only in the same meter (T010, contract §5.5)', () => {
    assert.deepStrictEqual(codes('pickup: 4\n| C | 4 |\n| C | 4 4 4 4 |\n| C | 4 4 4 |'), []);
    assert.deepStrictEqual(codes('pickup: 4\n| C | 4 4 |\n| C | 4 4 4 4 |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('pickup: 4\n| C | 4 |\n| C | 4 4 4 |\n| C | 4 4 4 4 |'), ['beatCountMismatch']);
    // The final meter changed to 3/4: the last measure must be a full 3/4 bar.
    assert.deepStrictEqual(codes('pickup: 4\n| C | 4 |\n@time: 3/4\n| C | 4 4 4 |'), []);
    assert.deepStrictEqual(codes('pickup: 4\n| C | 4 |\n@time: 3/4\n| C | 4 4 |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('pickup: 1\n| C | 1 |'), ['invalidPickup']);
    assert.deepStrictEqual(codes('pickup: 3\n| C |'), ['invalidPickup']);
  });

  it('rejects a measure repeat across a meter change (T011)', () => {
    const diags = parseGuitarDsl('| C | 4 4 4 4 |\n@time: 3/4\n| % |').diagnostics;
    assert.deepStrictEqual(diags.map(d => [d.code, d.severity]), [['measureRepeatMeterMismatch', 'error']]);
    assert.deepStrictEqual(codes('time: 3/4\n| C | 4 4 4 |\n| % |'), []);
    assert.deepStrictEqual(codes('| C |\n@time: 3/4\n| C |\nmel: | c4/1 | % |'), ['measureRepeatMeterMismatch']);
  });

  it('does not change beat arithmetic for swing / shuffle (T018)', () => {
    const straight = parseGuitarDsl('| C | 8 8 8 8 8 8 8 8 |');
    const swing = parseGuitarDsl('feel: swing\n| C | 8 8 8 8 8 8 8 8 |');
    assert.deepStrictEqual(swing.diagnostics, []);
    assert.deepStrictEqual(swing.measures[0].rhythms, straight.measures[0].rhythms);
    assert.strictEqual(swing.measures[0].context.feel, 'swing');
    assert.ok(feq(swing.measures[0].expectedBeats, straight.measures[0].expectedBeats));
  });

  it('restores the initial tempo with tempo primo (T019)', () => {
    const score = parseGuitarDsl('bpm: 120\n| C |\n@tempo: 150\n| C |\n@tempo: tempo primo\n| C |');
    assert.deepStrictEqual(score.measures.map(m => m.context.tempoBpm), [120, 150, 120]);
    assert.deepStrictEqual(score.measures[2].eventsBefore.map(e => e.kind), ['tempoMark']);
  });

  it('detects structural changes only when the value changes (contract §5.3)', () => {
    const score = parseGuitarDsl('| C |\n@key: C\n| C |\n@key: D\n@key: D\n| D |\n@time: 4/4\n| D |');
    const flags = score.measures.map((m, i) => structuralChange(score.measures[i - 1]?.context, m));
    assert.deepStrictEqual(flags.map(f => [f.key, f.time]), [[false, false], [false, false], [true, false], [false, false]]);
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('keeps expected beats exact for 7/8', () => {
    const score = parseGuitarDsl('time: 7/8\n| C |');
    assert.strictEqual(fnum(score.measures[0].expectedBeats), 3.5);
  });
});
