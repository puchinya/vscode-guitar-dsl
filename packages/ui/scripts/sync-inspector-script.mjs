import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(packageDirectory, 'src/inspectorSettings.js');
const distributionDirectory = resolve(packageDirectory, 'dist');
await mkdir(distributionDirectory, { recursive: true });
await copyFile(source, resolve(distributionDirectory, 'inspectorSettings.js'));
await copyFile(source, resolve(packageDirectory, '../../media/inspectorSettings.js'));
