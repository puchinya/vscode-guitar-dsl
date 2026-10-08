import assert from 'assert';
import {
  appendLoss,
  emptyLossReport,
  hasBlockingLoss,
  mergeLossReports
} from '../../src/interchange/loss';
import type { InterchangeLoss, InterchangeLossReport } from '../../src/interchange/model';

describe('interchange loss reports', () => {
  const entries: InterchangeLoss[] = [
    { category: 'unsupported', code: 'unknownElement', path: '/measure/0/effects/0', detail: 'No schema field exists.' },
    { category: 'approximated', code: 'pitchRounded', path: '/notes/1/pitch', detail: 'Mapped by the adapter policy.', policyId: 'midi-pitch-v1' },
    { category: 'droppedByPolicy', code: 'unusedPart', path: '/parts/2', detail: 'Unselected by the import profile.', policyId: 'musicxml-part-selection-v1' },
    { category: 'inferred', code: 'keyInferred', path: '/metadata/key', detail: 'Selected from the first measure.', policyId: 'midi-key-inference-v1' }
  ];

  it('keeps the four categories in insertion order with stable fields', () => {
    let report = emptyLossReport();
    for (const entry of entries) report = appendLoss(report, entry);
    assert.deepStrictEqual(report, { schemaVersion: 1, entries });
    assert.strictEqual(hasBlockingLoss(report), true);
    assert.strictEqual(hasBlockingLoss(mergeLossReports(...entries.slice(1).map(entry => appendLoss(emptyLossReport(), entry)))), false);
  });

  it('merges deterministically and deduplicates only the category/code/path/policy tuple', () => {
    const first = appendLoss(emptyLossReport(), entries[1]);
    const second = appendLoss(emptyLossReport(), { ...entries[1], detail: 'A later description for the same stable identity.' });
    const third = appendLoss(emptyLossReport(), { ...entries[1], policyId: 'other-policy' });
    assert.deepStrictEqual(mergeLossReports(first, second, third).entries, [entries[1], third.entries[0]]);
    assert.deepStrictEqual(mergeLossReports(first, second, third), mergeLossReports(first, second, third));
  });

  it('does not mutate its input report or entry', () => {
    const original = emptyLossReport();
    const input = { ...entries[0] };
    const next = appendLoss(original, input);
    input.detail = 'changed after append';
    assert.deepStrictEqual(original.entries, []);
    assert.strictEqual(next.entries[0].detail, entries[0].detail);
  });

  it('requires details and a policyId for non-unsupported categories', () => {
    assert.throws(
      () => appendLoss(emptyLossReport(), { category: 'approximated', code: 'round', path: '/n', detail: 'Rounded.' }),
      /requires a policyId/
    );
    assert.throws(
      () => appendLoss(emptyLossReport(), { category: 'inferred', code: 'guess', path: '/k', detail: '   ', policyId: 'policy' }),
      /detail is required/
    );
    assert.throws(
      () => appendLoss(emptyLossReport(), { ...entries[0], foreignPayload: true } as InterchangeLoss),
      /outside schema version 1/
    );
    assert.throws(
      () => appendLoss({ ...emptyLossReport(), foreignPayload: true } as InterchangeLossReport, entries[0]),
      /outside schema version 1/
    );
    assert.throws(
      () => hasBlockingLoss({ schemaVersion: 1, entries: [entries[0], { ...entries[1], foreignPayload: true } as InterchangeLoss] }),
      /outside schema version 1/
    );
  });
});
