import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = {
  development: {
    appUrl: 'https://dev.guitardsl.app/',
    siteUrl: 'https://wwwdev.guitardsl.app'
  },
  production: {
    appUrl: 'https://guitardsl.app/',
    siteUrl: 'https://www.guitardsl.app'
  }
};

function readTarget(args) {
  if (args.length !== 2 || args[0] !== '--target' || !Object.hasOwn(targets, args[1])) {
    throw new Error('Usage: npm run build:marketing -- --target development|production');
  }
  return { name: args[1], urls: targets[args[1]] };
}

async function bindHtml(filePath, urls, label) {
  const html = await readFile(filePath, 'utf8');
  for (const placeholder of ['__APP_URL__', '__SITE_URL__']) {
    if (!html.includes(placeholder)) throw new Error(`${label} is missing ${placeholder}.`);
  }
  const built = html.replaceAll('__APP_URL__', urls.appUrl).replaceAll('__SITE_URL__', urls.siteUrl);
  const unbound = built.match(/__[A-Z][A-Z0-9_]*__/u);
  if (unbound) throw new Error(`${label} contains an unbound token ${unbound[0]}.`);
  await writeFile(filePath, built, 'utf8');
}

async function main() {
  const { name: target, urls } = readTarget(process.argv.slice(2));
  const sourceDir = resolve(repoRoot, 'marketing/src');
  const publicDir = resolve(repoRoot, 'marketing/public');
  const distDir = resolve(repoRoot, 'marketing/dist');

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(sourceDir, distDir, { recursive: true });
  try {
    await access(publicDir);
    await cp(publicDir, distDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const iconSource = resolve(repoRoot, 'web/public/icons/guitardsl-sidebar.svg');
  const iconOutput = resolve(distDir, 'icons/guitardsl-sidebar.svg');
  await mkdir(dirname(iconOutput), { recursive: true });
  await cp(iconSource, iconOutput);

  await bindHtml(resolve(distDir, 'index.html'), urls, 'Japanese marketing page');
  await bindHtml(resolve(distDir, 'en/index.html'), urls, 'English marketing page');
  console.log(`build:marketing: ${target} output written to marketing/dist`);
}

main().catch(error => {
  console.error(`build:marketing: ${error.message}`);
  process.exitCode = 1;
});
