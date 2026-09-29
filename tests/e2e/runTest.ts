import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  // Keep VS Code's IPC socket paths short on macOS, where AF_UNIX paths have
  // a small fixed limit and the default profile lives under the checkout.
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp';
  const userDataDir = fs.mkdtempSync(path.join(tempRoot, 'guitar-dsl-vscode-test-'));

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './index');

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`]
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main();
