import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MutationGuard, beginnerInputProblem, capoInputProblem, mutationTargetProblem, transposeInputProblem } from '../../src/ai/tools';
import { getAiToolMessages } from '../../src/i18n';

const ROOT = path.resolve(__dirname, '../..');
const ABS = path.resolve('/tmp/song.guitardsl');

describe('AI tools adapter (Issue #80)', () => {
  const U = 'untitled:Untitled-1';

  it('mutation target: exactly one of uri (with a scheme) or an absolute path', () => {
    assert.strictEqual(mutationTargetProblem({ uri: U }), undefined);
    assert.strictEqual(mutationTargetProblem({ uri: 'file:///w/song.guitardsl' }), undefined);
    assert.strictEqual(mutationTargetProblem({ path: ABS }), undefined);
    assert.ok(mutationTargetProblem({}), 'neither: the active editor is never used');
    assert.ok(mutationTargetProblem({ uri: U, path: ABS }), 'both');
    assert.ok(mutationTargetProblem({ path: 'relative/song.guitardsl' }));
    assert.ok(mutationTargetProblem({ uri: 'song.guitardsl' }), 'no scheme');
    assert.ok(mutationTargetProblem({ uri: 42 as unknown as string }));
  });

  it('capo input: integer 0..12 and a target required', () => {
    assert.strictEqual(capoInputProblem({ uri: U, targetCapo: 0 }), undefined);
    assert.strictEqual(capoInputProblem({ targetCapo: 12, path: ABS }), undefined);
    for (const targetCapo of [-1, 13, 2.5, NaN, '2' as unknown as number, undefined as unknown as number]) {
      assert.ok(capoInputProblem({ uri: U, targetCapo }), String(targetCapo));
    }
    assert.ok(capoInputProblem({ targetCapo: 2 }), 'no target');
  });

  it('Beginner input: barrePolicy allow|forbid; targetCapo optional integer 0..12; a target required', () => {
    assert.strictEqual(beginnerInputProblem({ uri: U, barrePolicy: 'allow' }), undefined);
    assert.strictEqual(beginnerInputProblem({ path: ABS, barrePolicy: 'forbid', targetCapo: 5 }), undefined);
    assert.ok(beginnerInputProblem({ uri: U, barrePolicy: 'sometimes' as 'allow' }));
    assert.ok(beginnerInputProblem({ uri: U, barrePolicy: 'allow', targetCapo: 13 }));
    assert.ok(beginnerInputProblem({ barrePolicy: 'allow' }), 'no target');
  });

  it('transpose input: semitones -11..11; capo required only for explicit; a target required', () => {
    assert.strictEqual(transposeInputProblem({ uri: U, semitones: -11, capoMode: 'keep' }), undefined);
    assert.strictEqual(transposeInputProblem({ uri: U, semitones: 11, capoMode: 'recommended' }), undefined);
    assert.strictEqual(transposeInputProblem({ path: ABS, semitones: 2, capoMode: 'explicit', capo: 0 }), undefined);
    assert.ok(transposeInputProblem({ uri: U, semitones: 2, capoMode: 'explicit' }), 'explicit without capo');
    assert.ok(transposeInputProblem({ uri: U, semitones: 2, capoMode: 'explicit', capo: 13 }));
    assert.ok(transposeInputProblem({ uri: U, semitones: 12, capoMode: 'keep' }));
    assert.ok(transposeInputProblem({ uri: U, semitones: 1, capoMode: 'other' as 'keep' }));
    assert.ok(transposeInputProblem({ semitones: 1, capoMode: 'keep' }), 'no target');
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
    for (const forbidden of ['selectChatModels', 'sendRequest', 'planCapoTransform', 'planBeginnerTransform', 'planTransposeWithCapo', 'replaceChordTokenNames', 'workspace.applyEdit', 'new vscode.WorkspaceEdit', 'transcription', 'audioMir', 'ConfirmedTargets']) {
      assert.ok(!src.includes(forbidden), `src/ai/tools.ts must not use ${forbidden}`);
    }
  });
});
