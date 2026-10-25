import * as path from 'path';
import * as vscode from 'vscode';
import Mocha from 'mocha';
import { glob } from 'glob';
import { beginWorkbenchFocusTrace, endWorkbenchFocusTrace, ensureWorkbenchTestHostWindowFocused } from './workbenchFocus';

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000
  });

  mocha.suite.beforeEach(async function (this: Mocha.Context) {
    beginWorkbenchFocusTrace(this.currentTest?.fullTitle() ?? 'unknown E2E test');
    await ensureWorkbenchTestHostWindowFocused();
  });
  mocha.suite.afterEach(function (this: Mocha.Context) {
    const test = this.currentTest;
    const failed = test?.state === 'failed' || Boolean(test?.err);
    endWorkbenchFocusTrace(failed && test ? test.fullTitle() : undefined);
  });

  if (process.env.GUITARDSL_E2E_GREP) {
    mocha.grep(process.env.GUITARDSL_E2E_GREP);
  } else if (process.env.GUITARDSL_E2E_SCREENSHOT_ONLY === '1') {
    mocha.grep('ED-01/ED-02 CodeLens opens the Inspector and candidate selection only decorates the editor');
  }

  const testsRoot = path.resolve(__dirname, '.');

  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // Add files to the test suite
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
