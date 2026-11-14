import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareIsolatedSafariDownloads, restoreIsolatedSafariDownloads } from '../../scripts/safari-download-isolation.mjs';

test('Safari download isolation preserves and restores a non-empty Downloads directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guitardsl-safari-download-isolation-'));
  const homeDirectory = path.join(root, 'home');
  const runnerTemp = path.join(root, 'runner-temp');
  const downloadsPath = path.join(homeDirectory, 'Downloads');
  const originalContents = Buffer.from('existing download must be preserved\n');
  await mkdir(downloadsPath, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  await writeFile(path.join(downloadsPath, 'keep.txt'), originalContents);

  try {
    const isolation = await prepareIsolatedSafariDownloads({ downloadsPath, runnerTemp, processId: 45123 });
    const activeDownloads = await lstat(downloadsPath);
    assert.equal(activeDownloads.isSymbolicLink(), true);
    assert.equal(await readlink(downloadsPath), isolation.directory);
    assert.deepEqual(await readFile(path.join(isolation.backupPath, 'keep.txt')), originalContents);
    await writeFile(path.join(downloadsPath, 'smoke.pdf'), '%PDF-test');

    await restoreIsolatedSafariDownloads(isolation);

    const restoredDownloads = await lstat(downloadsPath);
    assert.equal(restoredDownloads.isDirectory(), true);
    assert.equal(restoredDownloads.isSymbolicLink(), false);
    assert.deepEqual(await readFile(path.join(downloadsPath, 'keep.txt')), originalContents);
    await assert.rejects(lstat(isolation.directory), { code: 'ENOENT' });
    assert.deepEqual(await readdir(runnerTemp), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Safari download isolation refuses a symlink Downloads path without changing it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guitardsl-safari-download-symlink-'));
  const homeDirectory = path.join(root, 'home');
  const runnerTemp = path.join(root, 'runner-temp');
  const target = path.join(root, 'downloads-target');
  const downloadsPath = path.join(homeDirectory, 'Downloads');
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  await mkdir(target);
  await symlink(target, downloadsPath, 'dir');

  try {
    await assert.rejects(
      prepareIsolatedSafariDownloads({ downloadsPath, runnerTemp, processId: 45124 }),
      /must be a real directory/
    );
    assert.equal(await readlink(downloadsPath), target);
    assert.deepEqual(await readdir(runnerTemp), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Safari download isolation refuses to replace an existing backup path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guitardsl-safari-download-backup-'));
  const homeDirectory = path.join(root, 'home');
  const runnerTemp = path.join(root, 'runner-temp');
  const downloadsPath = path.join(homeDirectory, 'Downloads');
  const backupPath = `${downloadsPath}.guitardsl-safari-45125.backup`;
  await mkdir(downloadsPath, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  await mkdir(backupPath);

  try {
    await assert.rejects(
      prepareIsolatedSafariDownloads({ downloadsPath, runnerTemp, processId: 45125 }),
      /backup path already exists/
    );
    assert.equal((await lstat(downloadsPath)).isDirectory(), true);
    assert.equal((await lstat(backupPath)).isDirectory(), true);
    assert.deepEqual(await readdir(runnerTemp), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
