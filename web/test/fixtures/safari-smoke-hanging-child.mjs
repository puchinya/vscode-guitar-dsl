import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile(process.env.GUITARDSL_SAFARI_REPORT_PATH, 'utf8'));
if (report.status !== 'RUNNING') throw new Error('Supervisor did not persist RUNNING before starting the child.');

process.send({ type: 'check-start', id: 'intentional-hang-check' });
process.send({ type: 'step-start', step: 'intentional-hang-step' });
process.send({ type: 'webdriver-command-start', command: 'intentionalHangCommand' });
setInterval(() => {}, 1_000);
