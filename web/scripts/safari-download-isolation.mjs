import { lstat, mkdtemp, readlink, rename, rm, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function prepareIsolatedSafariDownloads({ downloadsPath, runnerTemp, processId = process.pid }) {
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required to isolate Safari downloads in CI.');

  const downloadDirectory = await mkdtemp(join(runnerTemp, 'guitardsl-safari-downloads-'));
  const backupPath = `${downloadsPath}.guitardsl-safari-${processId}.backup`;
  let backupCreated = false;
  let linkCreated = false;
  try {
    let existing;
    try { existing = await lstat(downloadsPath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error('Safari Downloads must be a real directory before CI isolation.');
      }
      try {
        await lstat(backupPath);
        throw new Error('A Safari Downloads backup path already exists; refusing to replace it.');
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await rename(downloadsPath, backupPath);
      backupCreated = true;
    }
    await symlink(downloadDirectory, downloadsPath, 'dir');
    linkCreated = true;
    return { directory: downloadDirectory, downloadsPath, backupPath, backupCreated };
  } catch (error) {
    if (linkCreated) await unlink(downloadsPath).catch(() => {});
    if (backupCreated) await rename(backupPath, downloadsPath).catch(() => {});
    await rm(downloadDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function restoreIsolatedSafariDownloads(isolation) {
  if (!isolation) return;
  const current = await lstat(isolation.downloadsPath).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (current) {
    if (!current.isSymbolicLink()) throw new Error('Safari Downloads isolation link changed; refusing to remove it.');
    const linkTarget = await readlink(isolation.downloadsPath);
    if (resolve(dirname(isolation.downloadsPath), linkTarget) !== isolation.directory) {
      throw new Error('Safari Downloads isolation link target changed; refusing to remove it.');
    }
    await unlink(isolation.downloadsPath);
  }
  if (isolation.backupCreated) await rename(isolation.backupPath, isolation.downloadsPath);
  await rm(isolation.directory, { recursive: true, force: true });
}
