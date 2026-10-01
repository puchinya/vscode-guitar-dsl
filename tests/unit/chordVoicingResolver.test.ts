import * as assert from 'assert';
import { getDefaultVoicing } from '../../src/chordPresets';
import {
  resolveApplicableChordDefinition,
  resolveChordVoicing,
  resolveDefaultChordVoicing
} from '../../src/chordVoicingResolver';
import { parseGuitarDsl } from '../../src/compiler';
import { createInstrumentModel, parseTuningValue } from '../../src/instrumentModel';

describe('chordVoicingResolver', () => {
  const defs = parseGuitarDsl('chord C = x35553\nchord C@alt = x,x,10,9,8,8').chordDefinitions;

  it('RES-01 an exact labeled definition wins over the unlabeled definition and the default', () => {
    const r = resolveChordVoicing('C@alt', defs)!;
    assert.strictEqual(r.source, 'definition');
    assert.deepStrictEqual(r.voicing.frets, ['x', 'x', 10, 9, 8, 8]);
    assert.strictEqual(r.name, 'C');
    assert.strictEqual(r.label, 'alt');
    assert.strictEqual(resolveApplicableChordDefinition('C@alt', defs)!.label, 'alt');
  });

  it('RES-02 a labeled key without its own definition uses the unlabeled definition', () => {
    const onlyUnlabeled = parseGuitarDsl('chord C = x35553').chordDefinitions;
    const r = resolveChordVoicing('C@alt', onlyUnlabeled)!;
    assert.strictEqual(r.source, 'definition');
    assert.deepStrictEqual(r.voicing.frets, ['x', 3, 5, 5, 5, 3]);
    assert.strictEqual(resolveApplicableChordDefinition('C@alt', onlyUnlabeled)!.label, undefined);
    // No definition at all: the unlabeled key resolves nothing and falls to the library.
    assert.strictEqual(resolveApplicableChordDefinition('G', defs), undefined);
    assert.strictEqual(resolveChordVoicing('G', defs)!.source, 'library');
  });

  it('RES-03 dedicated slash presets win over the upper chord default', () => {
    for (const [slash, upper] of [['G/B', 'G'], ['D/F#', 'D']]) {
      const direct = getDefaultVoicing(slash);
      assert.ok(direct, `${slash} has a dedicated preset`);
      assert.notDeepStrictEqual(direct.frets, getDefaultVoicing(upper)!.frets);
      assert.deepStrictEqual(resolveDefaultChordVoicing(slash), direct);
      assert.deepStrictEqual(resolveChordVoicing(slash, [])!.voicing, direct);
    }
  });

  it('RES-04 a slash chord without a preset uses the upper chord default', () => {
    for (const [slash, upper] of [['F/A', 'F'], ['C/E', 'C']]) {
      assert.strictEqual(getDefaultVoicing(slash), undefined, `${slash} has no dedicated preset`);
      const r = resolveChordVoicing(slash, [])!;
      assert.strictEqual(r.source, 'library');
      assert.deepStrictEqual(r.voicing, getDefaultVoicing(upper));
    }
  });

  it('RES-07 a non-Standard slash chord falls back to the upper chord in the same tuning', () => {
    const dropDResult = parseTuningValue('Drop D');
    assert.ok(dropDResult.ok);
    const dropD = createInstrumentModel(dropDResult.tuning);
    const slash = 'F/A';
    assert.strictEqual(getDefaultVoicing(slash, dropD), undefined, 'no Drop D-valid dedicated F/A preset');
    const upper = getDefaultVoicing('F', dropD);
    assert.ok(upper, 'F has a Drop D-valid default');

    assert.deepStrictEqual(resolveDefaultChordVoicing(slash, dropD), upper);
    const resolved = resolveChordVoicing(slash, [], dropD);
    assert.strictEqual(resolved?.source, 'library');
    assert.deepStrictEqual(resolved?.voicing, upper);
    assert.strictEqual(resolveDefaultChordVoicing('C13/E', dropD), undefined, 'unknown upper chord remains unresolved');
  });

  it('RES-05 an unknown chord or unknown upper chord stays unresolved', () => {
    assert.strictEqual(resolveDefaultChordVoicing('C13'), undefined);
    assert.strictEqual(resolveDefaultChordVoicing('C13/E'), undefined);
    assert.strictEqual(resolveChordVoicing('C13/E', []), undefined);
  });

  it('RES-06 resolution is repeatable and does not mutate definitions or presets', () => {
    const before = JSON.stringify(defs);
    const preset = JSON.stringify(getDefaultVoicing('F'));
    assert.deepStrictEqual(resolveChordVoicing('F/A', defs), resolveChordVoicing('F/A', defs));
    assert.strictEqual(JSON.stringify(defs), before);
    assert.strictEqual(JSON.stringify(getDefaultVoicing('F')), preset);
  });
});
