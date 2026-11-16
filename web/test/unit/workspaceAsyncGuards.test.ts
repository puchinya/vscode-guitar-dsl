import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canOpenDriveFile, createLatestRequestSequence, readLocalExplorerRowsIfCurrent } from '../../src/controllers/workspaceAsyncGuards';

test('Drive Explorer uses latest-request-wins within one session', () => {
  const requests = createLatestRequestSequence();
  const l1 = requests.begin();
  const l2 = requests.begin();
  assert.equal(requests.isLatest(l2), true);
  assert.equal(requests.isLatest(l1), false);
  requests.invalidate();
  assert.equal(requests.isLatest(l2), false);
});

test('Drive open command cannot cross account or connection generation', () => {
  const base = {
    commandAccountId: 'account-a', currentAccountId: 'account-a', commandGeneration: 4,
    currentGeneration: 4, connected: true, rowAvailable: true
  };
  assert.equal(canOpenDriveFile(base), true);
  assert.equal(canOpenDriveFile({ ...base, currentAccountId: 'account-b' }), false);
  assert.equal(canOpenDriveFile({ ...base, currentGeneration: 5 }), false);
  assert.equal(canOpenDriveFile({ ...base, connected: false }), false);
  assert.equal(canOpenDriveFile({ ...base, rowAvailable: false }), false);
});

test('offline transition invalidates an Explorer continuation waiting on local IndexedDB', async () => {
  const requests = createLatestRequestSequence();
  const sequence = requests.begin();
  let online = true;
  let driveListStarted = false;
  let appliedLocalRows = false;
  let releaseRows!: (rows: string[]) => void;
  const rows = new Promise<string[]>(resolve => { releaseRows = resolve; });
  const refresh = (async () => {
    const current = await readLocalExplorerRowsIfCurrent(
      () => rows,
      () => requests.isLatest(sequence),
      () => { appliedLocalRows = true; }
    );
    if (current && online) driveListStarted = true;
  })();

  online = false;
  requests.invalidate();
  releaseRows(['song.guitardsl']);
  await refresh;
  assert.equal(appliedLocalRows, false);
  assert.equal(driveListStarted, false);
});
