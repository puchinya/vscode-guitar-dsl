import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSafariSmokeSupervisor, safariSmokeTimeouts } from './safari-smoke-supervisor.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childPath = resolve(dirname(fileURLToPath(import.meta.url)), 'run-safari-e2e-child.mjs');
const reportPath = resolve(webRoot, 'test-results/safari/safari-smoke-report.json');

function boundedCommand(command, args, timeoutMs = 1_500) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(value);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500).unref();
      finish(`UNAVAILABLE: timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(`UNAVAILABLE: ${error.message}`));
    child.once('close', (code) => finish(code === 0 ? stdout.trim() : `UNAVAILABLE: ${(stderr || stdout).trim() || `exit ${code}`}`));
  });
}

await mkdir(dirname(reportPath), { recursive: true });
const [osVersion, safariDriverVersion, safariVersion] = await Promise.all([
  boundedCommand('/usr/bin/sw_vers', ['-productVersion']),
  boundedCommand('/usr/bin/safaridriver', ['--version']),
  boundedCommand('/usr/bin/defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleShortVersionString'])
]);
const initialReport = {
  target: 'Apple Safari via SafariDriver',
  osVersion,
  safariDriverVersion,
  safariVersion,
  browserVersion: null,
  notRun: ['iOS/iPadOS Safari', 'production Google OAuth', 'production Google Drive', 'physical audio output']
};

const { exitCode } = await runSafariSmokeSupervisor({
  childPath,
  reportPath,
  report: initialReport,
  ...safariSmokeTimeouts
});
console.log(`Safari smoke report: ${reportPath}`);
process.exitCode = exitCode;
