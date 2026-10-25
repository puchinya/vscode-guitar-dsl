import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { renderContinuousSvg } from '../../src/render/svg';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';
import { VisualEditingHostController } from '../../src/visualEditing/hostController';
import { planLetOperation, planVisualEdit } from '../../src/visualEditing/planners';

function parsed(source: string) {
  const score = parseGuitarDsl(source);
  assert.deepStrictEqual(score.diagnostics.filter(item => item.severity === 'error'), []);
  return score;
}

describe('parser-owned visual editing sources', () => {
  it('exposes exact authored token spans and nested let references', () => {
    const source = 'let inner = 4.d 4.d\nlet riff = $inner\nkey: C\n| C $riff |\n';
    const score = parsed(source);
    const binding = score.visualSourceBindings?.find(item => item.expected === '$riff');
    assert.ok(binding);
    assert.strictEqual(source.slice(source.split('\n').slice(0, binding.line).join('\n').length + (binding.line ? 1 : 0) + binding.startCol,
      source.split('\n').slice(0, binding.line).join('\n').length + (binding.line ? 1 : 0) + binding.endCol), '$riff');
    assert.strictEqual(binding.origin, 'let-reference');
    const inner = score.letDefinitions?.find(item => item.name === 'inner');
    assert.ok(inner);
    assert.strictEqual(inner.valid, true);
    assert.ok(inner.directReferences.some(reference => reference.kind === 'definition' && reference.ownerName === 'riff'));
    assert.ok(inner.usageLocations.some(reference => reference.via === 'riff'));
    assert.deepStrictEqual(inner.allowedContexts, ['measure']);
  });

  it('connects parser bindings to chord, rhythm, melody, TAB, and lyric SVG marks', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\nmel: | c4/4 d4/4 e4/4 f4/4 |\nlyr: あ い う え\ntab: | 6f0/4 6f1/4 6f3/4 6f5/4 |\n';
    const score = parsed(source);
    const svg = renderContinuousSvg(score, 'A4', true);
    for (const kind of ['chord', 'rhythm', 'melodyNote', 'tab', 'lyric'] as const) {
      const binding = score.visualSourceBindings?.find(item => item.kind === kind);
      assert.ok(binding, `expected parser binding for ${kind}`);
      assert.ok(svg.includes(`data-visual-binding="${binding.id}"`), `expected rendered target for ${kind}`);
    }
    const withoutBindings = renderContinuousSvg({ ...score, visualSourceBindings: undefined });
    assert.strictEqual(svg.replace(/ data-visual-binding="[^"]*"/g, ''), withoutBindings,
      'Preview targets add only non-visible attributes to existing SVG elements');
  });
});

describe('source-preserving visual and variable planners', () => {
  it('renames nested references and preserves unrelated CRLF comments', () => {
    const source = '# keep 🎸\r\nlet inner = 4.d 4.d\r\nlet riff = $inner # note\r\nkey: C\r\n| C $riff |\r\n# untouched\r\n';
    const score = parsed(source);
    const plan = planLetOperation(source, score, { kind: 'rename', name: 'inner', newName: 'pulse' });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('let pulse = 4.d 4.d\r\n'));
    assert.ok(plan.resultingSource.includes('let riff = $pulse # note\r\n'));
    assert.ok(plan.resultingSource.endsWith('| C $riff |\r\n# untouched\r\n'));
  });

  it('distinguishes global definition edits from one explicit local occurrence', () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n| G $riff |\n';
    const score = parsed(source);
    const global = planLetOperation(source, score, { kind: 'editGlobal', name: 'riff', value: '8.d 8.d' });
    assert.ok(global.ok, global.ok ? '' : global.code);
    assert.strictEqual((global.resultingSource.match(/let riff = 8\.d 8\.d/g) ?? []).length, 1);
    assert.strictEqual((global.resultingSource.match(/\$riff/g) ?? []).length, 2);

    const first = (score.codeActionTokens ?? []).find(token => token.kind === 'letReference');
    assert.ok(first);
    const local = planLetOperation(source, score, {
      kind: 'detachLocal', name: 'riff', line: first.line,
      startCol: first.startCol, endCol: first.endCol, value: '8.d 8.d'
    });
    assert.ok(local.ok, local.ok ? '' : local.code);
    assert.ok(local.resultingSource.includes('| C 8.d 8.d |'));
    assert.ok(local.resultingSource.includes('| G $riff |'));
  });

  it('only deletes unused definitions and rejects stale parser-issued token spans', () => {
    const unused = 'let spare = 4.d\nkey: C\n| C |\n';
    const removal = planLetOperation(unused, parsed(unused), { kind: 'deleteUnused', name: 'spare' });
    assert.ok(removal.ok, removal.ok ? '' : removal.code);
    assert.ok(!removal.resultingSource.includes('let spare'));

    const used = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    const usedPlan = planLetOperation(used, parsed(used), { kind: 'deleteUnused', name: 'riff' });
    assert.deepStrictEqual(usedPlan, { ok: false, code: 'definitionInUse' });

    const source = '| C |\n';
    const score = parsed(source);
    const chord = score.visualSourceBindings?.find(binding => binding.kind === 'chord');
    assert.ok(chord);
    assert.deepStrictEqual(planVisualEdit('| D |\n', score, { kind: 'replaceChord', bindingId: chord.id, name: 'G' }),
      { ok: false, code: 'staleSource' });
    const edit = planVisualEdit(source, score, { kind: 'replaceChord', bindingId: chord.id, name: 'G' });
    assert.ok(edit.ok, edit.ok ? '' : edit.code);
    assert.strictEqual(edit.resultingSource, '| G |\n');
  });

  it('binds one Japanese lyric syllable to its authored UTF-16 span', () => {
    const source = '| C |\nmel: | c4/4 |\nlyr: (あさ)\n';
    const score = parsed(source);
    const syllable = score.visualSourceBindings?.find(binding => binding.kind === 'lyric');
    assert.ok(syllable);
    assert.strictEqual(syllable.expected, '(あさ)');
    const plan = planVisualEdit(source, score, { kind: 'replaceLyric', bindingId: syllable.id, text: '(ひかり)' });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('lyr: (ひかり)'));
  });

  it('uses a semantic semitone operation for a selected melody note', () => {
    const source = '| C |\nmel: | c4/4 |\n';
    const score = parsed(source);
    const note = score.visualSourceBindings?.find(binding => binding.kind === 'melodyNote');
    assert.ok(note);
    const plan = planVisualEdit(source, score, { kind: 'transposeMelody', bindingId: note.id, semitones: 1 });
    assert.ok(plan.ok, plan.ok ? '' : plan.code);
    assert.ok(plan.resultingSource.includes('c#4/4'));
    const longer = planVisualEdit(source, score, { kind: 'changeDuration', bindingId: note.id, direction: 'longer' });
    assert.ok(longer.ok, longer.ok ? '' : longer.code);
    assert.ok(longer.resultingSource.includes('c4/2'));
    assert.deepStrictEqual(planVisualEdit(source, score, { kind: 'transposeMelody', bindingId: note.id, semitones: 12 }),
      { ok: false, code: 'invalidOperation' });
  });

  it('edits one rhythm technique and one TAB fret while preserving CRLF context', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\r\ntab: | 6f0/4 6f1/4 6f3/4 6f5/4 |\r\n# keep\r\n';
    const score = parsed(source);
    const rhythm = score.visualSourceBindings?.find(binding => binding.kind === 'rhythm');
    const tab = score.visualSourceBindings?.find(binding => binding.kind === 'tab');
    assert.ok(rhythm && tab);
    const rhythmEdit = planVisualEdit(source, score, { kind: 'replaceRhythmToken', bindingId: rhythm.id, text: '4.u' });
    const tabEdit = planVisualEdit(source, score, { kind: 'replaceTabToken', bindingId: tab.id, text: '6f2/4' });
    assert.ok(rhythmEdit.ok, rhythmEdit.ok ? '' : rhythmEdit.code);
    assert.ok(tabEdit.ok, tabEdit.ok ? '' : tabEdit.code);
    assert.ok(rhythmEdit.resultingSource.startsWith('| C 4.u 4.u 4.d 4.u |\r\n'));
    assert.ok(tabEdit.resultingSource.includes('tab: | 6f2/4 6f1/4 6f3/4 6f5/4 |\r\n# keep\r\n'));
  });

  it('keeps Preview edit controls hidden by default while rendering parser targets', () => {
    const source = '| C 4.d 4.u 4.d 4.u |\n';
    const score = parsed(source);
    const html = compileGuitarDslToHtml(source, {
      documentUri: 'file:///song.guitardsl', documentVersion: 1, previewGeneration: 2,
      previewEditAvailable: true, visualBindings: score.visualSourceBindings
    });
    const editHtml = compileGuitarDslToHtml(source, {
      documentUri: 'file:///song.guitardsl', documentVersion: 1, previewGeneration: 2,
      previewEditMode: true, previewEditAvailable: true, visualBindings: score.visualSourceBindings
    });
    assert.match(html, /id="preview-edit-row"[^>]* hidden/);
    assert.match(html, /data-preview-edit-mode="false"/);
    assert.doesNotMatch(html, /data-visual-binding=/, 'ordinary Preview output contains no editing attributes');
    assert.match(editHtml, /id="preview-edit-row"[^>]*>/);
    assert.match(editHtml, /data-preview-edit-mode="true"/);
    assert.match(editHtml, /data-visual-binding="source-/);
    assert.match(editHtml, /postPreviewVisualEdit\('transposeMelody'/);
    assert.match(editHtml, /document\.addEventListener\('pointerup'/);
    assert.match(editHtml, /document\.addEventListener\('pointercancel'/);
    assert.match(editHtml, /id="preview-edit-open-source"/);
  });

  it('rejects invalid or duplicate definitions without changing source', () => {
    const source = 'let riff = 4.d 4.d\nkey: C\n| C $riff |\n';
    const score = parsed(source);
    assert.deepStrictEqual(planLetOperation(source, score, { kind: 'rename', name: 'riff', newName: 'bad-name' }),
      { ok: false, code: 'invalidValue' });
    assert.deepStrictEqual(planLetOperation(source, score, { kind: 'add', name: 'riff', value: '8.d 8.d' }),
      { ok: false, code: 'duplicateName' });
  });
});

describe('visual editing session guards', () => {
  it('rejects stale revisions, invalidates changed documents, and serializes apply', async () => {
    const controller = new VisualEditingHostController();
    const identity = controller.begin('variables', 'file:///score.guitardsl', 3, 0);
    assert.ok(identity);
    const next = controller.advanceRevision(identity);
    assert.ok(next);
    const stale = await controller.applyOnce(identity, () => ({ uri: identity.uri, documentVersion: 3, renderGeneration: 0 }), async () => true);
    assert.deepStrictEqual(stale, { ok: false, code: 'stale' });

    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const active = controller.applyOnce(next, () => ({ uri: next.uri, documentVersion: 3, renderGeneration: 0 }), async () => {
      enter(); await gate; return 'applied';
    });
    await entered;
    const duplicate = await controller.applyOnce(next, () => ({ uri: next.uri, documentVersion: 3, renderGeneration: 0 }), async () => 'duplicate');
    assert.deepStrictEqual(duplicate, { ok: false, code: 'busy' });
    release();
    assert.deepStrictEqual(await active, { ok: true, value: 'applied' });
    controller.invalidateUri(next.uri);
    assert.strictEqual(controller.current('variables'), undefined);
  });
});
