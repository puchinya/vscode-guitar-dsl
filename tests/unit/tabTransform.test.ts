import * as assert from 'assert';
import { planCapoTransform, resolveEffectiveDsl } from '../../src/capo';
import { planBeginnerTransform } from '../../src/beginnerMode';
import { planSoundingTranspose, planTransposeWithCapo } from '../../src/transpose';

describe('TAB source transform guards', () => {
  const source = 'capo: 0\n| C |\ntab: | 2f0/1 |';

  it('allows only capo identity and leaves differing capo transforms unapplied', () => {
    const identity = planCapoTransform(source, 0);
    assert.ok(identity.ok);
    assert.strictEqual(identity.text, source);
    assert.deepStrictEqual(planCapoTransform(source, 2), { ok: false, code: 'tabTransformUnsupported' });
    assert.deepStrictEqual(resolveEffectiveDsl(source, undefined), { ok: true, text: source, transformed: false });
    assert.deepStrictEqual(resolveEffectiveDsl(source, 0), { ok: true, text: source, transformed: false });
    assert.deepStrictEqual(resolveEffectiveDsl(source, 2), { ok: false, code: 'tabTransformUnsupported' });
  });

  it('allows identity transpose requests and rejects every pitch or capo change', () => {
    const identity = planSoundingTranspose(source, 0);
    assert.ok(identity.ok);
    assert.strictEqual(identity.text, source);
    assert.deepStrictEqual(planSoundingTranspose(source, 1), { ok: false, code: 'tabTransformUnsupported', stage: 'transpose' });
    const keep = planTransposeWithCapo(source, 0, { kind: 'keep' });
    assert.ok(keep.ok);
    assert.strictEqual(keep.text, source);
    const sameCapo = planTransposeWithCapo(source, 0, { kind: 'explicit', capo: 0 });
    assert.ok(sameCapo.ok);
    assert.strictEqual(sameCapo.text, source);
    const changedCapo = planTransposeWithCapo(source, 0, { kind: 'explicit', capo: 2 });
    assert.ok(!changedCapo.ok);
    assert.strictEqual(changedCapo.code, 'tabTransformUnsupported');
    assert.strictEqual(changedCapo.stage, 'capo');
  });

  it('rejects Beginner Mode even when the requested capo matches the source', () => {
    assert.deepStrictEqual(
      planBeginnerTransform(source, { barrePolicy: 'allow', targetCapo: 0 }),
      { ok: false, code: 'tabTransformUnsupported' }
    );
  });
});
