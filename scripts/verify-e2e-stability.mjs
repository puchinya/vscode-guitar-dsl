#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let runCount = 5;
let grep;

for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help' || argument === '-h') {
    console.log('Usage: npm run verify:e2e-stability -- [--runs N] [--grep REGEX]');
    process.exit(0);
  }
  if (argument === '--runs') {
    const value = Number(args[++index]);
    if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error('--runs must be an integer from 1 to 50');
    runCount = value;
    continue;
  }
  if (argument === '--grep') {
    grep = args[++index];
    if (!grep) throw new Error('--grep requires a regular expression');
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
const commit = commitResult.status === 0 ? commitResult.stdout.trim() : 'unknown';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const baseEnvironment = { ...process.env };
delete baseEnvironment.ELECTRON_RUN_AS_NODE;
delete baseEnvironment.NODE_OPTIONS;
if (grep !== undefined) baseEnvironment.GUITARDSL_E2E_GREP = grep;

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function sanitize(value) {
  let result = stripAnsi(value);
  const home = os.homedir();
  if (home) result = result.split(home).join('<home>');
  result = result.split(projectRoot).join('<worktree>');
  result = result.split(os.tmpdir()).join('<tmp>');
  result = result.replace(/\/Users\/[^/\s]+/g, '<user-home>');
  result = result.replace(/\/private\/var\/folders\/[^/\s]+\/[^/\s]+/g, '<tmp>');
  result = result.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted-token>');
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted-token>');
  result = result.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '<redacted-key>');
  result = result.replace(/file:\/\/\/[^\s"')]+/g, '<file-uri>');
  return result;
}

function versionOfDownloadedVSCode() {
  const directory = path.join(projectRoot, '.vscode-test');
  try {
    const versions = readdirSync(directory)
      .map(name => name.match(/^vscode-.+-(\d+\.\d+\.\d+)$/)?.[1])
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    return versions.length ? versions[versions.length - 1] : 'not downloaded';
  } catch {
    return 'not downloaded';
  }
}

function countFromOutput(output, pattern) {
  const matches = [...output.matchAll(pattern)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

function failedTestNames(output) {
  const clean = stripAnsi(output);
  return [...clean.matchAll(/^\s*\d+\)\s+(.+)$/gm)].map(match => match[1].trim());
}

function diagnosticLines(output) {
  const keep = /^\s*\d+\)\s+|\b(?:AssertionError|TypeError|ReferenceError|Error):|^\s+at\s|^\s*\d+\s+(?:passing|pending|failing)|E2E focus trace|Failed to run tests|Exit Code:|^npm error/i;
  return sanitize(output).split(/\r?\n/).filter(line => keep.test(line));
}

function runE2E(environment) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const child = spawn(npmCommand, ['run', 'test:e2e'], {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.on('error', error => {
      chunks.push(Buffer.from(`Runner process error: ${error.message}\n`));
      resolve({ exitCode: 1, signal: null, output: Buffer.concat(chunks).toString('utf8'), durationMs: Date.now() - startedAt });
    });
    child.on('close', (code, signal) => resolve({
      exitCode: code ?? 1,
      signal,
      output: Buffer.concat(chunks).toString('utf8'),
      durationMs: Date.now() - startedAt
    }));
  });
}

const failed = [];
console.log(`E2E stability series: ${runCount} fresh process run(s); grep=${grep ?? baseEnvironment.GUITARDSL_E2E_GREP ?? '<all tests>'}`);
console.log(`OS=${os.platform()} ${os.release()} ${os.arch()} | Node=${process.version} | VS Code=${versionOfDownloadedVSCode()} | commit=${commit}`);

for (let run = 1; run <= runCount; run++) {
  const environment = { ...baseEnvironment };
  const result = await runE2E(environment);
  const code = result.exitCode;
  const names = failedTestNames(result.output);
  const cleanOutput = stripAnsi(result.output);
  const passing = countFromOutput(cleanOutput, /^\s*(\d+)\s+passing/gm);
  const pending = countFromOutput(cleanOutput, /^\s*(\d+)\s+pending/gm);
  const runtimeVersion = versionOfDownloadedVSCode();
  const durationSeconds = (result.durationMs / 1000).toFixed(1);
  console.log(`Run ${run}/${runCount}: ${code === 0 ? 'PASS' : 'FAIL'} exit=${code}${result.signal ? ` signal=${result.signal}` : ''} duration=${durationSeconds}s tests=${passing} pending=${pending} OS=${os.platform()} ${os.release()} ${os.arch()} Node=${process.version} VSCode=${runtimeVersion} commit=${commit}`);
  if (code !== 0) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'guitardsl-e2e-stability-'));
    const logPath = path.join(directory, `run-${run}.log`);
    const diagnostics = diagnosticLines(result.output);
    const header = [
      `run=${run}/${runCount}`,
      `exit=${code}`,
      `signal=${result.signal ?? 'none'}`,
      `duration=${durationSeconds}s`,
      `OS=${os.platform()} ${os.release()} ${os.arch()}`,
      `Node=${process.version}`,
      `VSCode=${runtimeVersion}`,
      `commit=${commit}`,
      `grep=${grep ?? baseEnvironment.GUITARDSL_E2E_GREP ?? '<all tests>'}`,
      `failedTests=${names.join(' | ') || 'not parsed'}`,
      '',
      ...diagnostics,
      ''
    ].join('\n');
    writeFileSync(logPath, header, { encoding: 'utf8', mode: 0o600 });
    console.log(`  failed tests: ${names.join(' | ') || 'not parsed'}`);
    console.log(`  sanitized failure log: ${logPath}`);
    failed.push({ run, names, logPath });
  }
}

if (failed.length > 0) {
  console.error(`E2E stability: FAIL (${failed.length}/${runCount} run(s) failed). Each planned run ran once; no test retries were performed.`);
  process.exitCode = 1;
} else {
  console.log(`E2E stability: PASS (${runCount}/${runCount} fresh runs). Each run launched a separate npm process and VS Code temporary profile; no test retries were performed.`);
}
