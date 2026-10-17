import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import Mocha from 'mocha';
import { glob } from 'glob';
import { beginWorkbenchFocusTrace, endWorkbenchFocusTrace, recordFocusTrace } from './workbenchFocus';

async function ensureTestHostWindowFocused(): Promise<void> {
  if (process.platform !== 'darwin' || vscode.window.state.focused) return;

  const appBundle = path.resolve(vscode.env.appRoot, '../../../');
  console.info('[E2E host focus] requesting foreground activation for the isolated VS Code test app');
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', appBundle, '--args', '--reuse-window'], error => {
      if (error) reject(error);
      else resolve();
    });
  });

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (vscode.window.state.focused) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  recordFocusTrace('test-host-window-focus-timeout');
  throw new Error('The VS Code Extension Development Host window did not become focused within 2000ms');
}

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000
  });

  mocha.suite.beforeEach(async function (this: Mocha.Context) {
    beginWorkbenchFocusTrace(this.currentTest?.fullTitle() ?? 'unknown E2E test');
    await ensureTestHostWindowFocused();
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
