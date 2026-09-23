import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { formatChordDefinition, parseChordDefinition, resolveBaseFret } from '../../src/chordDefinition';
import { detectChordNames } from '../../src/chordDetect';
import { buildChordLine, createEditorSession, planChordSave } from '../../src/chordEditorModel';
import { CHORD_LIBRARY, PRESET_QUALITIES, getDefaultVoicing, getPresetVoicings, listPresetNames } from '../../src/chordPresets';
import { resolveChordDiagram } from '../../src/render/chordLibrary';
import { renderChordDiagramSvg } from '../../src/render/chordDiagram';
import { compileGuitarDslToSvg } from '../../src/render/svg';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';

function def(line: string) {
  const r = parseChordDefinition(line);
  assert.ok(r.ok, `expected ${line} to parse: ${JSON.stringify(r)}`);
  return r.definition;
}

function defError(line: string) {
  const r = parseChordDefinition(line);
  assert.ok(!r.ok, `expected ${line} to fail`);
  return r.error;
}

describe('chord definition - parse / format (§7.4)', () => {
  it('parses compact frets with options', () => {
    const d = def('chord C@barre = x35553 base:3 fingers:-13331 barre:3');
    assert.strictEqual(d.name, 'C');
    assert.strictEqual(d.label, 'barre');
    assert.deepStrictEqual(d.frets, ['x', 3, 5, 5, 5, 3]);
    assert.strictEqual(d.baseFret, 3);
    assert.deepStrictEqual(d.fingers, [null, '1', '3', '3', '3', '1']);
    assert.deepStrictEqual(d.barres, [{ fret: 3, from: 1, to: 5 }]);
  });

  it('parses comma-separated two-digit frets, o as open, explicit barre range and comments', () => {
    const d = def('chord C#m@hi = x,x,11,9,9,9 barre:9:3-1 # high voicing');
    assert.strictEqual(d.name, 'C#m');
    assert.deepStrictEqual(d.frets, ['x', 'x', 11, 9, 9, 9]);
    assert.deepStrictEqual(d.barres, [{ fret: 9, from: 3, to: 5 }]);
    assert.deepStrictEqual(def('chord E = o22100').frets, [0, 2, 2, 1, 0, 0]);
    assert.strictEqual(def('chord G/B = x20033').name, 'G/B');
  });

  it('reports each kind of invalid definition', () => {
    assert.strictEqual(defError('chord C'), 'syntax');
    assert.strictEqual(defError('chord H = x32010'), 'name');
    assert.strictEqual(defError('chord C@bad-label = x32010'), 'label');
    assert.strictEqual(defError('chord C = x3201'), 'frets');
    assert.strictEqual(defError('chord C = x3201z'), 'frets');
    assert.strictEqual(defError('chord C = x32010 base:0'), 'base');
    assert.strictEqual(defError('chord C = x32010 fingers:12'), 'fingers');
    assert.strictEqual(defError('chord C = x32010 barre:7'), 'barre');
    assert.strictEqual(defError('chord C = x32010 capo:2'), 'option');
    assert.strictEqual(defError('chord C = 1,x,x,x,x,9'), 'span');
  });

  it('computes the automatic base fret', () => {
    assert.strictEqual(resolveBaseFret(def('chord C = x32010')), 1);
    assert.strictEqual(resolveBaseFret(def('chord Bm7 = x24232')), 1);
    assert.strictEqual(resolveBaseFret(def('chord D = x,5,7,7,7,5')), 5);
    assert.strictEqual(resolveBaseFret(def('chord C = x35553 base:3')), 3);
  });

  it('round-trips through formatChordDefinition', () => {
    const lines = [
      'chord C = x32010',
      'chord C@barre = x35553 base:3 fingers:-13331 barre:3',
      'chord C@high = x,x,10,9,8,8 fingers:--4312',
      'chord Am = x02210 barre:2:4-2'
    ];
    for (const line of lines) {
      const d = def(line);
      assert.strictEqual(formatChordDefinition(d), line);
      assert.deepStrictEqual(def(formatChordDefinition(d)), d);
    }
  });
});

describe('chord definition - compiler integration', () => {
  const dsl = [
    'chord C@barre = x35553 base:3',
    'chord G/B@alt = x2x033',
    '| C | C@barre:2 G/B@alt/2 | 4.d 4.d 4.d 4.d |',
    '| C@barre 4.d 4.d 4.d 4.d |'
  ].join('\n');

  it('collects definitions and keeps labels out of displayed names', () => {
    const score = parseGuitarDsl(dsl);
    assert.deepStrictEqual(score.diagnostics, []);
    assert.deepStrictEqual(score.chordDefinitions.map(d => [d.name, d.label, d.line]), [['C', 'barre', 0], ['G/B', 'alt', 1]]);
    assert.deepStrictEqual(score.usedChords, ['C', 'C@barre', 'G/B@alt']);
    assert.deepStrictEqual(score.measures[1].chords, [
      { name: 'C', beat: 0, label: 'barre' },
      { name: 'G/B', beat: 2, label: 'alt' }
    ]);
    assert.strictEqual(score.measures[1].rhythms.length, 4, 'labeled chord cell merges with the rhythm cell');
    assert.strictEqual(score.measures[2].chord, 'C');
  });

  it('reports invalid, duplicate and unknown-variant diagnostics', () => {
    const score = parseGuitarDsl([
      'chord C = x32010',
      'chord C = x35553',
      'chord D = nope',
      '| C@missing | G |'
    ].join('\n'));
    const codes = score.diagnostics.map(d => [d.code, d.line, d.severity]);
    assert.deepStrictEqual(codes, [
      ['duplicateChordDefinition', 1, 'warning'],
      ['invalidChordDefinition', 2, 'error'],
      ['unknownChordVariant', 3, 'warning']
    ]);
    const unknown = score.diagnostics[2];
    assert.strictEqual('| C@missing | G |'.slice(unknown.startCol, unknown.endCol), 'C@missing');
    assert.deepStrictEqual(score.chordDefinitions[0].frets, ['x', 3, 2, 0, 1, 0], 'first definition wins');
  });

  it('resolves diagrams: own definition, unlabeled definition, library, fallback', () => {
    const defs = parseGuitarDsl('chord C = x35553\nchord C@hi = x,x,10,9,8,8').chordDefinitions;
    assert.strictEqual(resolveChordDiagram('C@hi', defs).voicing.frets[2], 10);
    assert.strictEqual(resolveChordDiagram('C', defs).voicing.frets[1], 3);
    assert.strictEqual(resolveChordDiagram('C@nope', defs).source, 'definition');
    assert.strictEqual(resolveChordDiagram('C@nope', defs).voicing.frets[2], 5);
    assert.strictEqual(resolveChordDiagram('G', defs).source, 'library');
    assert.strictEqual(resolveChordDiagram('Bbm7', defs).source, 'library');
    assert.strictEqual(resolveChordDiagram('C#m7/E', defs).source, 'fallback');
  });
});

describe('chord diagram rendering', () => {
  it('draws base fret number, barre, fingers and thin nut above fret 1', () => {
    const svg = renderChordDiagramSvg(def('chord C@barre = x35553 base:3 fingers:-13331 barre:3'));
    assert.ok(svg.includes('text-anchor="end" fill="#000">3</text>'), 'base fret label');
    assert.ok(svg.includes('<rect'), 'barre');
    assert.ok(!svg.includes('stroke-width="2.2"'), 'no thick nut when base > 1');
    assert.strictEqual((svg.match(/fill="#333">[1-4T]<\/text>/g) || []).length, 5, 'finger numbers');
  });

  it('draws a thick nut and open / mute marks at base 1', () => {
    const svg = renderChordDiagramSvg(def('chord C = x32010'));
    assert.ok(svg.includes('stroke-width="2.2"'));
    assert.strictEqual((svg.match(/×/g) || []).length, 1);
    assert.strictEqual((svg.match(/fill="none"/g) || []).length, 2);
  });

  it('renders one diagram per used key with data-chord-key and label captions', () => {
    const svg = compileGuitarDslToSvg('chord C@barre = x35553\n| C | C@barre |');
    assert.ok(svg.includes('data-chord-key="C"'));
    assert.ok(svg.includes('data-chord-key="C@barre"'));
    assert.ok(svg.includes('fill="#777">barre</text>'));
  });

  it('makes preview diagrams clickable to open the chord editor', () => {
    const html = compileGuitarDslToHtml('| C |');
    assert.ok(html.includes('class="chord-diagram" data-chord-key="C"'));
    assert.ok(html.includes("closest('.chord-diagram')"));
    assert.ok(html.includes("command: 'editChord'"));
  });
});

describe('chord name detection', () => {
  const cases: [string, (number | 'x')[]][] = [
    ['C', ['x', 3, 2, 0, 1, 0]],
    ['F', [1, 3, 3, 2, 1, 1]],
    ['Bm', ['x', 2, 4, 4, 3, 2]],
    ['G7', [3, 2, 0, 0, 0, 1]],
    ['Cmaj7', ['x', 3, 2, 0, 0, 0]],
    ['Am7', ['x', 0, 2, 0, 1, 0]],
    ['Dsus4', ['x', 'x', 0, 2, 3, 3]],
    ['Asus2', ['x', 0, 2, 2, 0, 0]],
    ['G/B', ['x', 2, 0, 0, 3, 3]],
    ['D/F#', [2, 0, 0, 2, 3, 2]],
    ['C6', ['x', 3, 2, 2, 1, 0]]
  ];
  for (const [name, frets] of cases) {
    it(`ranks ${name} first`, () => {
      assert.strictEqual(detectChordNames(frets)[0]?.name, name);
    });
  }

  it('returns nothing for fewer than two sounding strings', () => {
    assert.deepStrictEqual(detectChordNames(['x', 'x', 'x', 'x', 'x', 0]), []);
  });
});

describe('chord presets', () => {
  it('offers voicings for every root and quality, all detected as that chord', () => {
    for (const { root, suffix } of listPresetNames()) {
      const voicings = getPresetVoicings(root, suffix);
      assert.ok(voicings.length > 0, `${root}${suffix} has presets`);
      for (const v of voicings) {
        const r = parseChordDefinition(formatChordDefinition({ name: root + suffix, ...v }));
        assert.ok(r.ok, `${root}${suffix} ${v.frets.join(',')} is a valid definition`);
        assert.ok(v.frets.every(f => f === 'x' || (f >= 0 && f <= 15)));
        assert.strictEqual(detectChordNames(v.frets)[0].name, root + suffix, `${root}${suffix} ${v.frets.join(',')}`);
      }
    }
  });

  it('keeps the hand-written library as the default diagram', () => {
    for (const [name, frets] of Object.entries(CHORD_LIBRARY)) {
      assert.deepStrictEqual(getDefaultVoicing(name)!.frets, frets);
    }
    assert.deepStrictEqual(getPresetVoicings('C', '')[0].frets, CHORD_LIBRARY['C']);
    assert.deepStrictEqual(getDefaultVoicing('F')!.barres, [{ fret: 1, from: 0, to: 5 }]);
    assert.strictEqual(getDefaultVoicing('Cmin')!.frets.length, 6, 'min alias');
    assert.strictEqual(getDefaultVoicing('C#m7/E'), undefined);
  });
});

describe('chord editor model', () => {
  const text = [
    'title: T',
    'key: C',
    '',
    '[Intro]',
    '| C | G |'
  ].join('\n');

  it('starts a new definition from the resolved diagram', () => {
    const session = createEditorSession(text, 'G@open');
    assert.strictEqual(session.line, undefined);
    assert.strictEqual(session.state.name, 'G');
    assert.strictEqual(session.state.label, 'open');
    assert.deepStrictEqual(session.state.frets, CHORD_LIBRARY['G']);
  });

  it('edits an existing definition', () => {
    const session = createEditorSession('chord C@b = x35553 base:3\n| C@b |', 'C@b');
    assert.strictEqual(session.line, 0);
    assert.strictEqual(session.state.windowBase, 3);
  });

  it('writes base: only when the window differs from the automatic base', () => {
    const state = { name: 'C', label: 'b', frets: ['x', 3, 5, 5, 5, 3] as (number | 'x')[], windowBase: 1, fingers: [null, null, null, null, null, null], barres: [] };
    const auto = buildChordLine(state);
    assert.ok(auto.ok && auto.line === 'chord C@b = x35553');
    const fixed = buildChordLine({ ...state, windowBase: 3 });
    assert.ok(fixed.ok && fixed.line === 'chord C@b = x35553 base:3');
    const bad = buildChordLine({ ...state, name: 'Xyz' });
    assert.ok(!bad.ok && bad.error === 'name');
  });

  it('inserts new definitions after the header, then after the last definition', () => {
    const built = buildChordLine({ name: 'C', label: 'b', frets: ['x', 3, 5, 5, 5, 3], windowBase: 3, fingers: new Array(6).fill(null), barres: [] });
    assert.ok(built.ok);
    assert.deepStrictEqual(planChordSave(text, built.line, built.definition, undefined, false), { kind: 'insert', line: 2, text: built.line });
    const withDef = 'title: T\nchord G = 320003\n\n| C |';
    assert.deepStrictEqual(planChordSave(withDef, built.line, built.definition, undefined, false), { kind: 'insert', line: 2, text: built.line });
    assert.deepStrictEqual(planChordSave('title: T', built.line, built.definition, undefined, false), { kind: 'insert', line: 1, text: built.line });
  });

  it('replaces the edited line, saves as new variant, and rejects duplicates', () => {
    const doc = 'chord C@b = x35553\nchord C@c = x32010\n| C@b |';
    const built = buildChordLine({ name: 'C', label: 'b', frets: ['x', 3, 5, 5, 5, 3], windowBase: 3, fingers: new Array(6).fill(null), barres: [] });
    assert.ok(built.ok);
    assert.deepStrictEqual(planChordSave(doc, built.line, built.definition, 0, false), { kind: 'replace', line: 0, text: built.line });
    assert.deepStrictEqual(planChordSave(doc, built.line, built.definition, 0, true), { kind: 'duplicate', key: 'C@b' });
    assert.deepStrictEqual(planChordSave(doc, built.line, built.definition, 1, false), { kind: 'duplicate', key: 'C@b' });
  });
});

describe('chord preset qualities', () => {
  it('lists qualities in musical order with shapes for each', () => {
    assert.deepStrictEqual(PRESET_QUALITIES.slice(0, 5).map(q => q.label), ['maj', 'm', '7', 'maj7', 'm7']);
    assert.strictEqual(PRESET_QUALITIES.length, 15);
  });
});
