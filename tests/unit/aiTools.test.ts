import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MutationGuard, beginnerInputProblem, capoInputProblem, transposeInputProblem } from '../../src/ai/tools';
import { getAiToolMessages } from '../../src/i18n';

const ROOT = path.resolve(__dirname, '../..');
const ABS = path.resolve('/tmp/song.guitardsl');

describe('AI tools adapter (Issue #80)', () => {
  it('capo input: integer 0..12 required; path must be absolute', () => {
    assert.strictEqual(capoInputProblem({ targetCapo: 0 }), undefined);
    assert.strictEqual(capoInputProblem({ targetCapo: 12, path: ABS }), undefined);
    for (const targetCapo of [-1, 13, 2.5, NaN, '2' as unknown as number, undefined as unknown as number]) {
      assert.ok(capoInputProblem({ targetCapo }), String(targetCapo));
    }
    assert.ok(capoInputProblem({ targetCapo: 2, path: 'relative/song.guitardsl' }));
  });

  it('Beginner input: barrePolicy allow|forbid; targetCapo optional integer 0..12', () => {
    assert.strictEqual(beginnerInputProblem({ barrePolicy: 'allow' }), undefined);
    assert.strictEqual(beginnerInputProblem({ barrePolicy: 'forbid', targetCapo: 5 }), undefined);
    assert.ok(beginnerInputProblem({ barrePolicy: 'sometimes' as 'allow' }));
    assert.ok(beginnerInputProblem({ barrePolicy: 'allow', targetCapo: 13 }));
  });

  it('transpose input: semitones -11..11; capo required only for explicit', () => {
    assert.strictEqual(transposeInputProblem({ semitones: -11, capoMode: 'keep' }), undefined);
    assert.strictEqual(transposeInputProblem({ semitones: 11, capoMode: 'recommended' }), undefined);
    assert.strictEqual(transposeInputProblem({ semitones: 2, capoMode: 'explicit', capo: 0 }), undefined);
    assert.ok(transposeInputProblem({ semitones: 2, capoMode: 'explicit' }), 'explicit without capo');
    assert.ok(transposeInputProblem({ semitones: 2, capoMode: 'explicit', capo: 13 }));
    assert.ok(transposeInputProblem({ semitones: 12, capoMode: 'keep' }));
    assert.ok(transposeInputProblem({ semitones: 1, capoMode: 'other' as 'keep' }));
  });

  it('MutationGuard is fail-fast per key and releasable', () => {
    const guard = new MutationGuard();
    assert.ok(guard.tryAcquire('a'));
    assert.strictEqual(guard.tryAcquire('a'), false);
    assert.ok(guard.tryAcquire('b'), 'other documents are independent');
    guard.release('a');
    assert.strictEqual(guard.isHeld('a'), false);
    assert.ok(guard.tryAcquire('a'));
  });

  it('confirmation messages name the document and operation in both locales', () => {
    for (const locale of ['ja', 'en'] as const) {
      const m = getAiToolMessages(locale);
      assert.ok(m.capoConfirm('song.guitardsl', 3).includes('song.guitardsl') && m.capoConfirm('song.guitardsl', 3).includes('3'));
      assert.ok(m.beginnerConfirm('song.guitardsl', 'forbid', undefined).includes('song.guitardsl'));
      assert.ok(m.transposeConfirm('song.guitardsl', -2, m.capoKeep).includes('-2'));
      assert.ok(m.transposeConfirm('song.guitardsl', 2, m.capoKeep).includes('+2'));
    }
    assert.deepStrictEqual(Object.keys(getAiToolMessages('ja')).sort(), Object.keys(getAiToolMessages('en')).sort());
  });

  it('R001/R011 the adapter never calls a model and contains no transform formula', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/ai/tools.ts'), 'utf8');
    for (const forbidden of ['selectChatModels', 'sendRequest', 'planCapoTransform', 'planBeginnerTransform', 'planTransposeWithCapo', 'replaceChordTokenNames', 'workspace.applyEdit', 'new vscode.WorkspaceEdit', 'transcription', 'audioMir']) {
      assert.ok(!src.includes(forbidden), `src/ai/tools.ts must not use ${forbidden}`);
    }
  });
});

describe('ConfirmedTargets (Issue #80 review B-1)', () => {
  const { ConfirmedTargets, confirmationKey } = require('../../src/ai/tools') as typeof import('../../src/ai/tools');

  it('records FIFO per key and consumes on take', () => {
    const c = new ConfirmedTargets();
    c.record('k', 'a');
    c.record('k', 'b');
    assert.strictEqual(c.take('k'), 'a');
    assert.strictEqual(c.take('k'), 'b');
    assert.strictEqual(c.take('k'), undefined);
    assert.strictEqual(c.size, 0);
  });

  it('keeps at most maxKeys keys, dropping the oldest', () => {
    const c = new ConfirmedTargets(2);
    c.record('k1', 'a');
    c.record('k2', 'b');
    c.record('k3', 'c');
    assert.strictEqual(c.size, 2);
    assert.strictEqual(c.take('k1'), undefined);
    assert.strictEqual(c.take('k3'), 'c');
  });

  it('keys depend on tool name and input values, not on property order', () => {
    const a = confirmationKey('guitardsl_apply_transpose', { semitones: 2, capoMode: 'keep' } as any);
    const b = confirmationKey('guitardsl_apply_transpose', { capoMode: 'keep', semitones: 2 } as any);
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, confirmationKey('guitardsl_apply_capo', { semitones: 2, capoMode: 'keep' } as any));
    assert.notStrictEqual(a, confirmationKey('guitardsl_apply_transpose', { semitones: 3, capoMode: 'keep' } as any));
  });
});
