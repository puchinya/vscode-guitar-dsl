import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runSafariSmokeSupervisor } from '../../scripts/safari-smoke-supervisor.mjs';

const fixtureChild = fileURLToPath(new URL('../fixtures/safari-smoke-hanging-child.mjs', import.meta.url));
const runnerDeadlineChild = fileURLToPath(new URL('../fixtures/safari-smoke-runner-deadline-child.mjs', import.meta.url));

test('Safari smoke supervisor writes a versioned WEBDRIVER_HANG report and terminates a hanging worker', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'guitardsl-safari-supervisor-'));
  const reportPath = path.join(temporaryDirectory, 'safari-smoke-report.json');
  try {
    const { exitCode } = await runSafariSmokeSupervisor({
      childPath: fixtureChild,
      reportPath,
      commandTimeoutMs: 150,
      runnerTimeoutMs: 2_000,
      report: {
        target: 'Apple Safari via SafariDriver',
        osVersion: 'macOS test-version',
        safariDriverVersion: 'SafariDriver test-version',
        safariVersion: 'Safari test-version'
      }
    });

    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      status: string;
      failure: { code: string; step: string; webDriverCommand: string };
      checks: Array<{ id: string; status: string; errorCode: string; step: string }>;
      steps: Array<{ name: string; status: string; errorCode: string }>;
      webDriverCommands: Array<{ command: string; status: string; errorCode: string }>;
      osVersion: string;
      safariDriverVersion: string;
      safariVersion: string;
    };
    assert.equal(exitCode, 1);
    assert.equal(report.status, 'FAIL');
    assert.deepEqual(report.failure, {
      code: 'WEBDRIVER_HANG',
      message: 'Safari WebDriver command exceeded 150ms: intentionalHangCommand',
      check: 'intentional-hang-check',
      step: 'intentional-hang-step',
      webDriverCommand: 'intentionalHangCommand'
    });
    assert.deepEqual(report.checks.at(-1), {
      id: 'intentional-hang-check',
      status: 'FAIL',
      errorCode: 'WEBDRIVER_HANG',
      error: 'Safari WebDriver command exceeded 150ms: intentionalHangCommand',
      step: 'intentional-hang-step',
      webDriverCommand: 'intentionalHangCommand',
      osVersion: 'macOS test-version',
      safariDriverVersion: 'SafariDriver test-version',
      safariVersion: 'Safari test-version',
      recordedAt: report.checks.at(-1)?.recordedAt
    });
    assert.equal(report.osVersion, 'macOS test-version');
    assert.equal(report.safariDriverVersion, 'SafariDriver test-version');
    assert.equal(report.safariVersion, 'Safari test-version');
    assert.deepEqual(report.steps.at(-1), {
      name: 'intentional-hang-step',
      status: 'FAIL',
      startedAt: report.steps.at(-1)?.startedAt,
      finishedAt: report.steps.at(-1)?.finishedAt,
      errorCode: 'WEBDRIVER_HANG'
    });
    assert.deepEqual(report.webDriverCommands.at(-1), {
      command: 'intentionalHangCommand',
      step: 'intentional-hang-step',
      status: 'FAIL',
      startedAt: report.webDriverCommands.at(-1)?.startedAt,
      finishedAt: report.webDriverCommands.at(-1)?.finishedAt,
      errorCode: 'WEBDRIVER_HANG'
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Safari smoke supervisor enforces an absolute runner deadline across repeated short WebDriver commands', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'guitardsl-safari-runner-deadline-'));
  const reportPath = path.join(temporaryDirectory, 'safari-smoke-report.json');
  try {
    const { exitCode } = await runSafariSmokeSupervisor({
      childPath: runnerDeadlineChild,
      reportPath,
      commandTimeoutMs: 1_000,
      runnerTimeoutMs: 180,
      report: {
        target: 'Apple Safari via SafariDriver',
        osVersion: 'macOS test-version',
        safariDriverVersion: 'SafariDriver test-version',
        safariVersion: 'Safari test-version'
      }
    });

    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      status: string;
      failure: { code: string; message: string; check: string; step: string };
      checks: Array<{ id: string; status: string; errorCode: string }>;
      webDriverCommands: Array<{ command: string; status: string; errorCode?: string }>;
      runnerElapsedMs: number;
    };
    assert.equal(exitCode, 1);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.failure.code, 'SAFARI_RUNNER_TIMEOUT');
    assert.equal(report.failure.check, 'absolute-deadline-check');
    assert.equal(report.failure.step, 'repeated-short-commands');
    assert.match(report.failure.message, /absolute 180ms runner deadline/);
    assert.equal(report.checks.at(-1)?.status, 'FAIL');
    assert.equal(report.checks.at(-1)?.errorCode, 'SAFARI_RUNNER_TIMEOUT');
    assert.ok(report.webDriverCommands.filter(command => command.status === 'COMPLETED').length >= 2);
    assert.ok(report.runnerElapsedMs >= 180);
    assert.ok(report.runnerElapsedMs < 2_000, `runner stopped after ${report.runnerElapsedMs}ms`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
