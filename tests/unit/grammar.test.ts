import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Structural checks of the TextMate grammar (the full tokenizer runs inside VS Code; see Issue #68 evidence).
const grammar = JSON.parse(fs.readFileSync(path.join(__dirname, '../../syntaxes/guitardsl.tmLanguage.json'), 'utf8'));
const all: any[] = grammar.patterns.flatMap((p: any) => [p, ...(p.patterns ?? [])]);
const byName = (name: string) => all.filter(p => p.name === name);

describe('grammar - advanced notation (T046)', () => {
  it('highlights the new headers', () => {
    const header = new RegExp(byName('keyword.other.header.guitardsl')[0].match);
    for (const h of ['time:', 'time_signature:', 'meter:', 'feel:', 'pickup:', 'key:', 'bpm:']) assert.ok(header.test(h), h);
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
