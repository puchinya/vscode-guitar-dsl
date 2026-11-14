import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeDriveSave } from '../../src/storage/driveSaveQueue';

test('serializes Drive saves by account and file while allowing other files to proceed', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const first = serializeDriveSave('account-a', 'drive-1', async () => {
    events.push('first-start');
    await firstGate;
    events.push('first-end');
  });
  const second = serializeDriveSave('account-a', 'drive-1', async () => { events.push('second'); });
  const otherFile = serializeDriveSave('account-a', 'drive-2', async () => { events.push('other-file'); });

  await otherFile;
  assert.deepEqual(events, ['first-start', 'other-file']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'other-file', 'first-end', 'second']);
});

test('releases a Drive save queue after an operation fails', async () => {
  await assert.rejects(serializeDriveSave('account-a', 'drive-1', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await serializeDriveSave('account-a', 'drive-1', async () => 'next save'), 'next save');
});
