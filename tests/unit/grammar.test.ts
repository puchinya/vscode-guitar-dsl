import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Structural checks of the TextMate grammar (the full tokenizer runs inside VS Code; see Issue #68 evidence).
const grammar = JSON.parse(fs.readFileSync(path.join(__dirname, '../../syntaxes/guitardsl.tmLanguage.json'), 'utf8'));
const all: any[] = grammar.patterns.flatMap((p: any) => [p, ...(p.patterns ?? [])]);
const byName = (name: string) => all.filter(p => p.name === name);

describe('grammar - advanced notation (T046)', () => {
  it('highlights section arrangement blocks before ordinary section labels', () => {
    const rule = grammar.patterns[0];
    assert.strictEqual(rule.name, 'meta.arrangement.guitardsl');
    assert.ok(new RegExp(rule.begin).test('arrangement {'));
    assert.ok(new RegExp(rule.end).test('} # end arrangement'));
    assert.ok(rule.patterns.some((p: any) => p.name === 'entity.name.section.reference.guitardsl'));
    assert.ok(rule.patterns.some((p: any) => p.name === 'meta.arrangement.lyric-verse.guitardsl'));
    assert.ok(rule.patterns.some((p: any) => p.name === 'keyword.operator.arrangement.repeat.guitardsl'));
    const name = new RegExp(rule.patterns.find((p: any) => p.name === 'entity.name.section.reference.guitardsl').match, 'u');
    assert.ok(name.test('Verse'));
    assert.ok(name.test('[Verse A]'));
    assert.ok(name.test('Aメロ'));
  });

  it('highlights the new headers', () => {
    const header = new RegExp(byName('keyword.other.header.guitardsl')[0].match);
    for (const h of ['time:', 'time_signature:', 'meter:', 'feel:', 'pickup:', 'key:', 'bpm:', 'tuning:']) assert.ok(header.test(h), h);
  });

  it('has a directive rule for every score event and an invalid rule for unknown names', () => {
    const directive = byName('meta.directive.guitardsl')[0];
    for (const name of ['key', 'tempo', 'bpm', 'time', 'meter', 'feel', 'dynamic', 'mark', 'text', 'ottava']) {
      assert.ok(directive.begin.includes(name), name);
    }
    assert.strictEqual(directive.beginCaptures['1'].name, 'keyword.control.directive.guitardsl');
    assert.ok(byName('invalid.illegal.directive.guitardsl').length === 1);
  });

  it('matches tuplets, technique blocks and rhythm modifiers', () => {
    const tuplet = new RegExp(byName('constant.numeric.tuplet.guitardsl')[0].match);
    assert.ok(tuplet.test('{5:4}') && !tuplet.test('{hammer}'));
    const technique = new RegExp(byName('entity.other.attribute-name.technique.guitardsl')[0].match);
    assert.ok(technique.test('{hammer,bend:2}') && !technique.test('{5:4}'));
    const rhythm = new RegExp(`^(?:${byName('constant.numeric.rhythm.guitardsl')[0].match})$`);
    for (const tok of ['8{5:4}.d', '16{7:4}', '4.pm', '4.lr', '4.stacc.ten', 'r4.fermata', '4.vib.breath', '1.d.arp', '8t.d']) {
      assert.ok(rhythm.test(tok), tok);
    }
    const melody = byName('meta.melody.guitardsl')[0].patterns;
    const note = new RegExp(melody.find((p: any) => p.name === 'constant.other.note.guitardsl').match);
    for (const tok of ['c5/8{5:4}', 'e5/4', 'f#4/8t']) assert.ok(note.test(tok), tok);
  });
});

describe('grammar - first-class TAB (Issue #89)', () => {
  const tab = byName('meta.tab.guitardsl')[0];

  it('recognizes tab: and tab[1]: as TAB lines', () => {
    const begin = new RegExp(tab.begin);
    assert.ok(begin.test('tab: | 2f5/4'));
    assert.ok(begin.test('tab[1]: | 2f5/4'));
    assert.strictEqual(tab.beginCaptures['1'].name, 'keyword.other.tab.guitardsl');
  });

  it('highlights fretted and dead notes, chords, and distinct effect scopes', () => {
    const chord = tab.patterns.find((p: any) => p.name === 'meta.tab-chord.guitardsl');
    const group = new RegExp(chord.match);
    assert.ok(group.test('[6f3,5f2]'));
    assert.ok(group.test('[6f3{pm},5f2]'));
    assert.ok(group.test('[6f3~,5x]'));
    assert.ok(!group.test('[Intro]'));

    const fretted = new RegExp(tab.patterns.find((p: any) => p.name === 'constant.other.tab-note.guitardsl').match);
    const dead = new RegExp(tab.patterns.find((p: any) => p.name === 'constant.other.tab-dead-note.guitardsl').match);
    assert.ok(fretted.test('2f5') && fretted.test('1f24~'));
    assert.ok(dead.test('6x'));
    assert.ok(!dead.test('6f0'));

    const noteEffect = tab.patterns.find((p: any) => p.name === 'entity.other.attribute-name.tab-note-effect.guitardsl');
    const beatEffect = tab.patterns.find((p: any) => p.name === 'entity.other.attribute-name.tab-beat-effect.guitardsl');
    assert.ok(new RegExp(noteEffect.match).test('{bend(amount=1)}'));
    assert.ok(!new RegExp(noteEffect.match).test('!{pm}'));
    assert.ok(new RegExp(beatEffect.match).test('!{let-ring}'));
    assert.ok(tab.patterns.some((p: any) => p.name === 'variable.other.reference.guitardsl'));
    assert.ok(tab.patterns.some((p: any) => p.name === 'keyword.operator.repeat.guitardsl'));
  });
});

describe('grammar - let fragments and note groups (Issue #72)', () => {
  const letRule = byName('meta.let.guitardsl')[0];
  const melody = byName('meta.melody.guitardsl')[0].patterns;

  it('highlights a let declaration keyword, name and assignment', () => {
    const begin = new RegExp(letRule.begin);
    const m = 'let riff = e4/8 g a g'.match(begin)!;
    assert.deepStrictEqual([m[1], m[2], m[3]], ['let', 'riff', '=']);
    assert.strictEqual(letRule.beginCaptures['1'].name, 'storage.type.let.guitardsl');
    assert.strictEqual(letRule.beginCaptures['2'].name, 'variable.other.definition.guitardsl');
    assert.strictEqual(letRule.beginCaptures['3'].name, 'keyword.operator.assignment.guitardsl');
    assert.ok(!begin.test('lettuce = 4.d') && !begin.test('| let | 4.d |'));
    const comment = new RegExp(letRule.patterns.find((p: any) => p.name === 'comment.line.number-sign.guitardsl').match);
    assert.strictEqual('let riff = f#4/8 g  # intro'.match(comment)![0], '# intro');
    assert.ok(!comment.test('let riff = f#4/8'));
  });

  it('highlights $name references in definitions, measure lines and mel: lines', () => {
    const inLet = new RegExp(letRule.patterns.find((p: any) => p.name === 'variable.other.reference.guitardsl').match, 'g');
    assert.deepStrictEqual('let v = $downUp $motif'.match(inLet), ['$downUp', '$motif']);
    const top = new RegExp(byName('variable.other.reference.guitardsl')[0].match, 'g');
    assert.deepStrictEqual('| C | $groove |'.match(top), ['$groove']);
    const inMel = new RegExp(melody.find((p: any) => p.name === 'variable.other.reference.guitardsl').match, 'g');
    assert.deepStrictEqual('mel: | c5/4 $riff b |'.match(inMel), ['$riff']);
  });

  it('highlights note groups and keeps [Intro] a section', () => {
    const rules = [byName('meta.note-group.guitardsl')[0], melody.find((p: any) => p.name === 'meta.note-group.guitardsl'), letRule.patterns.find((p: any) => p.name === 'meta.note-group.guitardsl')];
    for (const rule of rules) {
      const re = new RegExp(rule.match);
      const m = '[c4,eb4,g4]/8{5:4}{staccato}'.match(re)!;
      assert.deepStrictEqual([m[1], m[2], m[3], m[4], m[5]], ['[', 'c4,eb4,g4', ']', '/8{5:4}', '{staccato}']);
      assert.ok(re.test('[c4,e4]:1.5'));
      for (const bad of ['[Intro]', '[1.]', '[c4]/4', '[c4,e4]', '[Aメロ]']) assert.ok(!re.test(bad), bad);
      assert.strictEqual(rule.captures['2'].patterns[0].name, 'punctuation.separator.note-group.guitardsl');
      assert.strictEqual(rule.captures['2'].patterns[1].name, 'constant.other.note.guitardsl');
      assert.strictEqual(rule.captures['4'].name, 'constant.numeric.duration.guitardsl');
      assert.strictEqual(rule.captures['5'].name, 'entity.other.attribute-name.technique.guitardsl');
    }
    const section = new RegExp(byName('entity.name.section.guitardsl')[0].match);
    assert.ok(section.test('[Intro]'));
    // The group rule comes first at the same position, but never matches a section label.
    const order = grammar.patterns.map((p: any) => p.name);
    assert.ok(order.indexOf('meta.note-group.guitardsl') < order.indexOf('entity.name.section.guitardsl'));
  });
});
