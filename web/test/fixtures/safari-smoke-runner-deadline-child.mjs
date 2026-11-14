import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile(process.env.GUITARDSL_SAFARI_REPORT_PATH, 'utf8'));
if (report.status !== 'RUNNING') throw new Error('Supervisor did not persist RUNNING before starting the child.');

process.send({ type: 'check-start', id: 'absolute-deadline-check' });
process.send({ type: 'step-start', step: 'repeated-short-commands' });

let commandSequence = 0;
const sendShortCommand = () => {
  const command = `shortCommand${++commandSequence}`;
  process.send({ type: 'webdriver-command-start', command });
  setTimeout(() => process.send({ type: 'webdriver-command-end', command, status: 'COMPLETED' }), 5);
};

sendShortCommand();
const interval = setInterval(sendShortCommand, 20);
process.on('SIGTERM', () => {
  clearInterval(interval);
  process.exit(143);
});
