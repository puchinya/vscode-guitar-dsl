// Generate the public static legal routes and the production Web OSS inventory.
// Run with `npm run generate:legal`; --check is read-only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const pages = ['licenses', 'privacy', 'terms'];
const locales = ['en', 'ja'];
const site = 'https://guitardsl.app';
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function inlineMarkdown(value) {
  const tokens = [];
  const tokenized = value.replace(/\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g, (_match, label, href, code, bold) => {
    const external = href?.startsWith('https://') ? ' target="_blank" rel="noopener noreferrer"' : '';
    const index = tokens.push(label !== undefined
      ? `<a href="${escapeHtml(href)}"${external}>${escapeHtml(label)}</a>`
      : code !== undefined ? `<code>${escapeHtml(code)}</code>` : `<strong>${escapeHtml(bold)}</strong>`) - 1;
    return `\u0000${index}\u0000`;
  });
  return tokenized.split(/\u0000(\d+)\u0000/g).map((part, index) => index % 2 ? tokens[Number(part)] : escapeHtml(part)).join('');
}

function renderMarkdown(markdown) {
  const out = [];
  let paragraph = [];
  let inList = false;
  let inCode = false;
  let code = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inlineMarkdown).join(' ')}</p>`);
    paragraph = [];
  };
  const closeList = () => { if (inList) out.push('</ul>'); inList = false; };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('```')) {
      flushParagraph(); closeList();
      if (inCode) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^-\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
    } else if (!line.trim()) {
      flushParagraph(); closeList();
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph(); closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return out.join('\n');
}

function walkNpmTree(node, found = new Map()) {
  for (const [name, dependency] of Object.entries(node?.dependencies ?? {})) {
    const version = dependency.version;
    if (version && !name.startsWith('@guitardsl/')) found.set(`${name}@${version}`, { name, version });
    walkNpmTree(dependency, found);
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

function lockPackageDirectory(name, version, lock) {
  const candidates = Object.entries(lock.packages ?? {}).filter(([key, item]) => {
    const marker = key.lastIndexOf('node_modules/');
    const pathName = marker < 0 ? '' : key.slice(marker + 'node_modules/'.length);
    return pathName === name && item.version === version;
  }).map(([key]) => resolve(root, key));
  for (const directory of candidates) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name === name && manifest.version === version) return { directory, manifest };
    }
  }
  throw new Error(`No installed package directory for ${name}@${version}; run npm ci first.`);
}

function safePackageUrl(manifest) {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const candidate = manifest.homepage || repository || `https://www.npmjs.com/package/${encodeURIComponent(manifest.name)}`;
  return candidate.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^ssh:\/\/git@github.com\//, 'https://github.com/');
}

function authorName(author) {
  if (typeof author === 'string') return author.trim();
  if (Array.isArray(author)) return author.map(authorName).filter(Boolean).join(', ');
  if (!author || typeof author !== 'object') return '';
  const name = typeof author.name === 'string' ? author.name.trim() : '';
  const email = typeof author.email === 'string' ? author.email.trim() : '';
  const url = typeof author.url === 'string' ? author.url.trim() : '';
  return [name, email && `<${email}>`, url].filter(Boolean).join(' ');
}

const genericMit = readFileSync(join(root, 'LICENSE'), 'utf8').trim();
const auditedFallbacks = {
  'fontkit@2.0.4': {
    copyright: 'Copyright (c) 2014-present Devon Govett',
    licenseText: genericMit.replace('Copyright (c) 2026 puchinya', 'Copyright (c) 2014-present Devon Govett'),
    source: 'https://github.com/foliojs/fontkit/blob/master/LICENSE',
    note: 'The npm archive declares MIT but omits a separate license file; the upstream repository license was used.'
  },
  'brotli@1.3.3': {
    copyright: 'Copyright (c) Devon Govett',
    licenseText: `${genericMit.replace('Copyright (c) 2026 puchinya', 'Copyright (c) Devon Govett')}\n\nAdditional Brotli source notice (MIT):\nCopyright (c) 2009, 2010, 2013-2016 by the Brotli Authors.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
    source: 'https://github.com/devongovett/brotli.js',
    note: 'The npm archive declares MIT but omits a separate license file; the package author metadata and README license declaration were used.'
  },
  'dfa@1.2.0': {
    copyright: 'Copyright (c) Devon Govett',
    licenseText: genericMit.replace('Copyright (c) 2026 puchinya', 'Copyright (c) Devon Govett'),
    source: 'https://github.com/devongovett/dfa',
    note: 'The npm archive declares MIT but omits a separate license file; the package author metadata and README license declaration were used.'
  },
  '@vue/devtools-api@6.6.4': {
    copyright: 'Copyright (c) 2014-present Evan You',
    licenseText: genericMit.replace('Copyright (c) 2026 puchinya', 'Copyright (c) 2014-present Evan You'),
    source: 'https://github.com/vuejs/devtools-v6/blob/v6.6.4/LICENSE',
    note: 'The npm archive declares MIT but omits a separate license file; the matching upstream release license was used.'
  }
};

function licenseFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(license|licence|copying|notice)(\.|$)/i.test(entry.name))
    .map(entry => entry.name).sort();
}

function productionInventory() {
  const output = execFileSync('npm', ['ls', '--workspace', 'web', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tree = JSON.parse(output);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  return walkNpmTree(tree).map(({ name, version }) => {
    const identity = `${name}@${version}`;
    const { directory, manifest } = lockPackageDirectory(name, version, lock);
    const files = licenseFiles(directory);
    const licenseText = files.map(file => `${file}\n${readFileSync(join(directory, file), 'utf8').trim()}`).join('\n\n');
    let declaredLicense = typeof manifest.license === 'string' ? manifest.license
      : Array.isArray(manifest.licenses) ? manifest.licenses.map(item => item.type ?? item).join(' OR ')
        : manifest.licenses?.type ?? 'Unknown';
    const fallback = auditedFallbacks[identity];
    let text = licenseText;
    let note = '';
    if (!text) {
      if (declaredLicense !== 'MIT' || !fallback) throw new Error(`No auditable license text for ${identity} (declared ${declaredLicense}).`);
      text = fallback.licenseText;
      note = fallback.note;
    }
    if (declaredLicense === 'Unknown' && /MIT License|The MIT License/i.test(text)) declaredLicense = 'MIT (license file)';
    if (declaredLicense === 'Unknown' && !text) throw new Error(`Unknown license for ${identity}.`);
    return { name, version, declaredLicense, author: authorName(manifest.author), url: safePackageUrl(manifest), text, note, fallbackSource: fallback?.source };
  });
}

const inventory = productionInventory();
const inventoryDigest = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
const oflText = readFileSync(join(root, 'media/fonts/OFL.txt'), 'utf8').trim();
const packageTable = inventory.map(item => `<tr><th scope="row">${escapeHtml(item.name)}</th><td>${escapeHtml(item.version)}</td><td>${escapeHtml(item.declaredLicense)}</td><td>${escapeHtml(item.author)}</td><td><a href="${escapeHtml(item.url)}" rel="noopener noreferrer">Project</a></td></tr>`).join('\n');
const packageNotices = inventory.map(item => `<section class="license-detail"><h3>${escapeHtml(item.name)} ${escapeHtml(item.version)}</h3><p>Declared license: ${escapeHtml(item.declaredLicense)}${item.author ? ` · Author: ${escapeHtml(item.author)}` : ''} · <a href="${escapeHtml(item.url)}" rel="noopener noreferrer">upstream project</a>${item.fallbackSource ? ` · <a href="${escapeHtml(item.fallbackSource)}" rel="noopener noreferrer">license source</a>` : ''}</p>${item.note ? `<p class="audit-note">${escapeHtml(item.note)}</p>` : ''}<pre>${escapeHtml(item.text)}</pre></section>`).join('\n');

const mitText = genericMit;
const assetNotices = `<section class="license-detail"><h3>Noto Sans JP fonts</h3><p>Bundled regular and bold font assets: <code>media/fonts/NotoSansJP-Regular.ttf</code> and <code>media/fonts/NotoSansJP-Bold.ttf</code>. Copyright and reserved font name notices are retained from the upstream font notice.</p><pre>${escapeHtml(oflText)}</pre></section>
<section class="license-detail"><h3>Google Drive product icon</h3><p>The official 2026 Google Drive color product icon is used without recoloring. Google Drive and its logo are Google LLC trademarks. Use follows the <a href="https://developers.google.com/workspace/drive/api/guides/branding?hl=en" rel="noopener noreferrer">Google Drive API branding guidance</a>.</p><p>Source: <a href="https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png" rel="noopener noreferrer">Google product icon</a>.</p></section>`;
const licensesHtml = `<section class="license-detail"><h2>MIT License — full text</h2><pre>${escapeHtml(mitText)}</pre></section>
<section><h2>Production Web dependency inventory</h2><p>Generated from the installed production dependency graph of the Web workspace. Inventory SHA-256: <code>${inventoryDigest}</code>. Local <code>@guitardsl/*</code> workspaces are owned by this project and are covered by the GuitarDSL MIT License.</p><div class="table-scroll"><table><thead><tr><th scope="col">Package</th><th scope="col">Version</th><th scope="col">Declared license</th><th scope="col">Author metadata</th><th scope="col">Source</th></tr></thead><tbody>${packageTable}</tbody></table></div><h2>Third-party license texts and notices</h2>${packageNotices}${assetNotices}</section>`;

const commonCss = `:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#18202b}main{max-width:920px;margin:0 auto;padding:32px 22px 56px}header,footer,nav{display:flex;flex-wrap:wrap;gap:12px;align-items:center}header{justify-content:space-between;border-bottom:1px solid #d6dbe4;padding-bottom:14px}footer{border-top:1px solid #d6dbe4;margin-top:36px;padding-top:16px;justify-content:space-between;color:#4d5664}nav a{white-space:nowrap}a{color:#3446bd;text-underline-offset:3px}h1{font-size:2rem;line-height:1.2;margin:30px 0 18px}h2{font-size:1.35rem;margin-top:2rem}h3{font-size:1.05rem;margin-top:1.5rem}p,li{max-width:78ch}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef0f4;border:1px solid #d6dbe4;border-radius:6px;padding:14px;font:0.86rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}code{overflow-wrap:anywhere}.license-detail{border-top:1px solid #d6dbe4;padding-top:12px;margin-top:24px}.audit-note{border-left:3px solid #bd7518;padding-left:10px}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.93rem}th,td{text-align:left;vertical-align:top;padding:8px;border:1px solid #d6dbe4}th{background:#edf0f5}html:lang(ja) body{font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif}@media(max-width:600px){main{padding:20px 16px 40px}h1{font-size:1.65rem}th,td{padding:6px;font-size:.85rem}}@media(prefers-color-scheme:dark){body{background:#171a20;color:#e8eaf0}header,footer,.license-detail{border-color:#3b414c}a{color:#aab5ff}pre,th{background:#242933;border-color:#3b414c}td{border-color:#3b414c}th{background:#2a303a}}`;

const pageNames = {
  en: { home: 'GuitarDSL home', language: 'Language', english: 'English', japanese: '日本語', contact: 'Contact', effective: 'Effective and last revised: 2026-11-21', homeLink: 'Home' },
  ja: { home: 'GuitarDSL ホーム', language: '言語', english: 'English', japanese: '日本語', contact: 'お問い合わせ', effective: '制定日・最終改定日: 2026年11月21日', homeLink: 'ホーム' }
};

function extractTitle(markdown) { return markdown.match(/^#\s+(.+)$/m)?.[1] ?? 'GuitarDSL'; }
function renderPage(page, locale, markdown, isBase = false) {
  const title = extractTitle(markdown);
  const localeHref = `${site}/${page}/${locale}/`;
  const canonical = isBase ? `${site}/${page}/` : localeHref;
  const body = renderMarkdown(markdown) + (page === 'licenses' ? licensesHtml : '');
  const legalNav = pages.filter(id => id !== page).map(id => `<a href="/${id}/${locale}/">${escapeHtml(id === 'privacy' ? (locale === 'ja' ? 'プライバシー' : 'Privacy') : id === 'terms' ? (locale === 'ja' ? '利用規約' : 'Terms') : (locale === 'ja' ? 'ライセンス' : 'Licenses'))}</a>`).join('');
  const selector = `<nav aria-label="${escapeHtml(pageNames[locale].language)}"><span>${escapeHtml(pageNames[locale].language)}:</span> <a href="/${page}/en/" lang="en">${pageNames[locale].english}</a><a href="/${page}/ja/" lang="ja">${pageNames[locale].japanese}</a></nav>`;
  const redirect = isBase ? `<script>(()=>{const langs=Array.isArray(navigator.languages)?navigator.languages:[];const candidate=String(langs[0]||navigator.language||'').toLowerCase();const locale=candidate==='ja'||candidate.startsWith('ja-')?'ja':'en';location.replace('/${page}/'+locale+'/')})()</script>` : '';
  const scriptPolicy = isBase ? "script-src 'unsafe-inline'" : "script-src 'none'";
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="index,follow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${scriptPolicy}; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)} · GuitarDSL</title><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="${site}/${page}/en/"><link rel="alternate" hreflang="ja" href="${site}/${page}/ja/"><link rel="alternate" hreflang="x-default" href="${site}/${page}/"><style>${commonCss}</style>${redirect}</head><body><main><header><a href="/" aria-label="${escapeHtml(pageNames[locale].home)}">GuitarDSL</a>${selector}</header><article>${body}</article><footer><span>${escapeHtml(pageNames[locale].effective)} · puchinya</span><nav aria-label="${escapeHtml(pageNames[locale].homeLink)}"><a href="/">${escapeHtml(pageNames[locale].homeLink)}</a>${legalNav}<a href="mailto:support@guitardsl.app">${escapeHtml(pageNames[locale].contact)} · support@guitardsl.app</a></nav></footer></main></body></html>
`;
  return html;
}

const generated = new Map();
for (const page of pages) {
  for (const locale of locales) {
    const source = join(root, 'docs', 'legal', locale, `${page}.md`);
    if (!existsSync(source)) throw new Error(`Missing legal source ${source}`);
    const markdown = readFileSync(source, 'utf8');
    generated.set(`web/public/${page}/${locale}/index.html`, renderPage(page, locale, markdown));
    if (locale === 'en') generated.set(`web/public/${page}/index.html`, renderPage(page, locale, markdown, true));
  }
}

const mismatches = [];
for (const [relativePath, content] of generated) {
  const path = join(root, relativePath);
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) mismatches.push(relativePath);
  } else {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    console.log(`generate:legal: wrote ${relativePath}`);
  }
}
if (mismatches.length) {
  console.error(`check:legal: generated legal page(s) are stale: ${mismatches.join(', ')}`);
  process.exit(1);
}
if (checkOnly) console.log(`check:legal: ${generated.size} static pages and ${inventory.length} production packages are in sync`);
