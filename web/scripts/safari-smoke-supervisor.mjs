import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const defaultCommandTimeoutMs = 45_000;
const defaultRunnerTimeoutMs = 230_000;

async function writeReport(reportPath, report) {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
}

function terminate(child, graceMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, graceMs);
  forceKill.unref();
}

/**
 * Runs the Safari WebDriver worker with a parent-owned, continuously written report.
 * The parent does not depend on the worker's finally block or WebDriver responsiveness.
 */
export async function runSafariSmokeSupervisor({
  childPath,
  reportPath,
  report,
  commandTimeoutMs = defaultCommandTimeoutMs,
  runnerTimeoutMs = defaultRunnerTimeoutMs
}) {
  const absoluteReportPath = resolve(reportPath);
  const result = {
    ...report,
    schemaVersion: 2,
    status: 'RUNNING',
    startedAt: report.startedAt ?? new Date().toISOString(),
    checks: [],
    steps: [{ name: 'starting-child-runner', status: 'RUNNING', startedAt: new Date().toISOString() }],
    webDriverCommands: [],
    currentCheck: null,
    currentStep: 'starting-child-runner'
  };
  await writeReport(absoluteReportPath, result);

  let child;
  let commandTimeout;
  let runnerDeadline;
  let persistChain = Promise.resolve();
  let timedOut = false;
  let childClosed = false;
  let activeCheck = null;
  let activeStep = result.currentStep;
  let activeCommand = null;

  const persist = () => {
    persistChain = persistChain.then(() => writeReport(absoluteReportPath, result));
    return persistChain;
  };

  const upsertCheck = (check) => {
    const index = result.checks.findIndex((candidate) => candidate.id === check.id);
    if (index === -1) result.checks.push(check);
    else result.checks[index] = check;
  };

  const finishCurrentStep = (status = 'COMPLETED', errorCode = undefined) => {
    const current = result.steps.at(-1);
    if (current?.status === 'RUNNING') {
      current.status = status;
      current.finishedAt = new Date().toISOString();
      if (errorCode) current.errorCode = errorCode;
    }
  };

  const timeoutFailure = async (code, message) => {
    if (timedOut || childClosed) return;
    timedOut = true;
    clearTimeout(commandTimeout);
    clearTimeout(runnerDeadline);
    const id = activeCheck ?? 'safari-runner';
    upsertCheck({
      id,
      status: 'FAIL',
      errorCode: code,
      error: message,
      step: activeStep,
      webDriverCommand: activeCommand ?? undefined,
      osVersion: result.osVersion,
      safariDriverVersion: result.safariDriverVersion,
      safariVersion: result.safariVersion,
      recordedAt: new Date().toISOString()
    });
    result.status = 'FAIL';
    result.finishedAt = new Date().toISOString();
    result.failure = {
      code,
      message,
      check: activeCheck,
      step: activeStep,
      webDriverCommand: activeCommand ?? undefined
    };
    result.currentCheck = activeCheck;
    result.currentStep = activeStep;
    result.activeWebDriverCommand = activeCommand;
    finishCurrentStep('FAIL', code);
    const activeCommandRecord = result.webDriverCommands.at(-1);
    if (activeCommandRecord?.status === 'RUNNING') {
      activeCommandRecord.status = 'FAIL';
      activeCommandRecord.errorCode = code;
      activeCommandRecord.finishedAt = new Date().toISOString();
    }
    await persist();
    terminate(child);
  };

  child = spawn(process.execPath, [childPath], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      GUITARDSL_SAFARI_CHILD: '1',
      GUITARDSL_SAFARI_REPORT_PATH: absoluteReportPath
    }
  });

  const runnerStartedAt = Date.now();
  runnerDeadline = setTimeout(() => {
    void timeoutFailure(
      'SAFARI_RUNNER_TIMEOUT',
      `Safari smoke worker exceeded its absolute ${runnerTimeoutMs}ms runner deadline.`
    );
  }, runnerTimeoutMs);

  const startCommandDeadline = (label) => {
    clearTimeout(commandTimeout);
    commandTimeout = setTimeout(() => {
      void timeoutFailure('WEBDRIVER_HANG', `Safari WebDriver command exceeded ${commandTimeoutMs}ms: ${label}`);
    }, commandTimeoutMs);
  };

  const clearCommandDeadline = () => {
    clearTimeout(commandTimeout);
    commandTimeout = undefined;
  };

  child.on('message', (message) => {
    if (timedOut || !message || typeof message !== 'object') return;
    switch (message.type) {
      case 'check-start': {
        finishCurrentStep();
        activeCheck = message.id;
        activeStep = `check:${message.id}`;
        activeCommand = null;
        result.currentCheck = activeCheck;
        result.currentStep = activeStep;
        result.steps.push({ name: activeStep, status: 'RUNNING', startedAt: message.startedAt ?? new Date().toISOString() });
        upsertCheck({ id: activeCheck, status: 'RUNNING', startedAt: message.startedAt ?? new Date().toISOString() });
        clearCommandDeadline();
        break;
      }
      case 'check-result': {
        upsertCheck(message.check);
        finishCurrentStep(message.check.status, message.check.errorCode);
        activeCommand = null;
        result.activeWebDriverCommand = null;
        clearCommandDeadline();
        break;
      }
      case 'step-start': {
        finishCurrentStep();
        activeStep = message.step;
        result.currentStep = activeStep;
        result.steps.push({ name: activeStep, status: 'RUNNING', startedAt: new Date().toISOString() });
        break;
      }
      case 'webdriver-command-start': {
        activeCommand = message.command;
        result.activeWebDriverCommand = activeCommand;
        activeStep = message.step ?? activeStep;
        result.currentStep = activeStep;
        result.webDriverCommands.push({
          command: activeCommand,
          step: activeStep,
          status: 'RUNNING',
          startedAt: new Date().toISOString()
        });
        startCommandDeadline(activeCommand);
        break;
      }
      case 'webdriver-command-end': {
        if (activeCommand === message.command) {
          activeCommand = null;
          clearCommandDeadline();
        }
        result.activeWebDriverCommand = activeCommand;
        const commandRecord = [...result.webDriverCommands].reverse().find((candidate) => candidate.command === message.command && candidate.status === 'RUNNING');
        if (commandRecord) {
          commandRecord.status = message.status ?? 'COMPLETED';
          commandRecord.finishedAt = new Date().toISOString();
        }
        break;
      }
      case 'runner-error': {
        result.runnerError = message.error;
        break;
      }
      case 'report-metadata': {
        Object.assign(result, message.metadata ?? {});
        break;
      }
      default:
        break;
    }
    void persist();
  });

  await persist();

  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ error }));
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  childClosed = true;
  clearTimeout(commandTimeout);
  clearTimeout(runnerDeadline);
  await persistChain;

  if (!timedOut) {
    if (exit.error) {
      result.runnerError = exit.error.message;
      result.status = 'FAIL';
    } else if (exit.code !== 0 || result.checks.some((check) => check.status !== 'PASS')) {
      result.status = 'FAIL';
      result.runnerExit = { code: exit.code, signal: exit.signal };
    } else {
      result.status = 'PASS';
    }
    result.finishedAt = new Date().toISOString();
    finishCurrentStep(result.status);
    result.currentCheck = null;
    result.currentStep = null;
  }
  result.runnerElapsedMs = Date.now() - runnerStartedAt;
  await persist();
  return { exitCode: result.status === 'PASS' ? 0 : 1, report: result };
}

export const safariSmokeTimeouts = Object.freeze({
  commandTimeoutMs: defaultCommandTimeoutMs,
  runnerTimeoutMs: defaultRunnerTimeoutMs
});
