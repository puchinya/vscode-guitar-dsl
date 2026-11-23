import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { parseGuitarDsl } from '../packages/core/src/compiler.ts';
import { renderContinuousSvg } from '../packages/core/src/render/svg.ts';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = resolve(repoRoot, 'marketing/dist');
const targetMap = {
  development: { appUrl: 'https://dev.guitardsl.app/', siteUrl: 'https://wwwdev.guitardsl.app' },
  production: { appUrl: 'https://guitardsl.app/', siteUrl: 'https://www.guitardsl.app' }
};
const fixtureNames = ['A_chord_lyrics', 'B_melody_lyrics', 'C_guitar_tab'];
const tabVisualAcceptance = {
  fixture: 'marketing/examples/C_guitar_tab.guitardsl',
  capture: 'docs/status/evidence/issue-188/marketing-solo-guitar-tab-1600x900.png',
  webp: 'marketing/public/images/solo-guitar-tab.webp'
};
const expectedChords = [['C', 'G'], ['Am', 'Em'], ['F', 'C'], ['Dm', 'G7']];
const expectedLyrics = ['あさのそらに', 'ひかりがさす', 'まだみぬみち', 'かぜをこえて'];

function parseTarget(args) {
  if (args.length !== 2 || args[0] !== '--target' || !Object.hasOwn(targetMap, args[1])) {
    throw new Error('Usage: npm run check:marketing -- --target development|production');
  }
  return { name: args[1], urls: targetMap[args[1]] };
}

function quarterBeats(noteValue) {
  const denominator = Number(noteValue);
  assert.ok(Number.isFinite(denominator) && denominator > 0, `invalid rhythm value ${noteValue}`);
  return 4 / denominator;
}

function fraction(value) {
  return Number(value.n) / Number(value.d);
}

function svgAttributes(tag) {
  return new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
}

function verifyTabRhythmAlignment(svg, score) {
  const fretCenters = new Map();
  const fretMarks = [...svg.matchAll(/<text class="tab-fret"[^>]*>/gu)];
  const expectedFretCount = score.measures.reduce((sum, measure) => sum + (measure.tabVoices?.find(voice => voice.voice === 1)?.beats ?? [])
    .reduce((beatSum, beat) => beatSum + beat.notes.length, 0), 0);
  assert.equal(fretMarks.length, expectedFretCount, 'rendered fret labels differ from fixture note count');
  for (const match of fretMarks) {
    const attrs = svgAttributes(match[0]);
    const key = `${attrs.get('data-measure-index')}:${attrs.get('data-beat-index')}`;
    const centers = fretCenters.get(key) ?? [];
    centers.push(Number(attrs.get('x')));
    fretCenters.set(key, centers);
  }

  const assertAnchor = (measure, beat, x, kind) => {
    const key = `${measure}:${beat}`;
    const centers = fretCenters.get(key);
    assert.ok(centers?.length, `${kind} refers to beat ${key} without fret labels`);
    assert.ok(centers.every(center => Number.isFinite(center) && Math.abs(center - centers[0]) < 0.01), `simultaneous fret centers differ at beat ${key}`);
    assert.ok(Number.isFinite(x) && Math.abs(x - centers[0]) < 0.01, `${kind} is not aligned with fret center at beat ${key}`);
  };

  const stems = [...svg.matchAll(/<line class="tab-stem"[^>]*>/gu)];
  for (const match of stems) {
    const attrs = svgAttributes(match[0]);
    const measure = attrs.get('data-measure-index');
    const beat = attrs.get('data-beat-index');
    assertAnchor(measure, beat, Number(attrs.get('x1')), 'TAB stem');
    assert.equal(attrs.get('x1'), attrs.get('x2'), `TAB stem is not vertical at beat ${measure}:${beat}`);
  }
  const flags = [...svg.matchAll(/<g class="tab-rhythm-flag"([^>]*)>([\s\S]*?)<\/g><\/g>/gu)];
  for (const match of flags) {
    const attrs = svgAttributes(match[1]);
    const transform = match[2].match(/<g transform="translate\(([-\d.]+),/u);
    assert.ok(transform, 'TAB flag anchor is missing');
    assertAnchor(attrs.get('data-measure-index'), attrs.get('data-beat-index'), Number(transform[1]), 'TAB flag');
  }
  const beams = [...svg.matchAll(/<line class="tab-beam(?:-secondary)?"[^>]*>/gu)];
  for (const match of beams) {
    const attrs = svgAttributes(match[0]);
    const measure = attrs.get('data-measure-index');
    assertAnchor(measure, attrs.get('data-first-beat'), Number(attrs.get('x1')), 'TAB beam start');
    assertAnchor(measure, attrs.get('data-last-beat'), Number(attrs.get('x2')), 'TAB beam end');
  }
  assert.ok(stems.length > 0, 'TAB fixture must render rhythmic stems');
  assert.ok(beams.length > 0, 'TAB fixture must render beam endpoints');
}

async function verifyTabVisualAcceptance(tabScore) {
  const manifestPath = resolve(repoRoot, 'docs/status/evidence/issue-188/tab-visual-acceptance.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 1, 'unsupported TAB visual acceptance manifest');
  assert.equal(manifest.acceptance?.status, 'reviewed', 'TAB visual revision has not been reviewed');
  assert.equal(manifest.acceptance?.reviewer, 'Codex', 'TAB visual reviewer is missing');
  assert.equal(manifest.acceptance?.method, 'real-app-capture-and-svg-anchor-check', 'TAB visual acceptance method differs');
  assert.equal(manifest.capture?.browser, 'Playwright Chromium 1.65.0', 'TAB capture browser provenance is missing');
  assert.equal(manifest.capture?.viewportCssPixels, '1600x900', 'TAB capture viewport differs');
  assert.equal(manifest.capture?.deviceScaleFactor, 1, 'TAB capture scale differs');
  for (const [key, path] of Object.entries(tabVisualAcceptance)) {
    assert.equal(manifest[key]?.path, path, `TAB visual acceptance ${key} path differs`);
    const bytes = await readFile(resolve(repoRoot, path));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.match(manifest[key]?.sha256 ?? '', /^[a-f0-9]{64}$/u, `TAB visual acceptance ${key} SHA-256 is missing`);
    assert.equal(digest, manifest[key].sha256, `TAB visual acceptance ${key} changed; review the new fixture/image revision and update the manifest`);
    if (key === 'capture') {
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'TAB source capture is not a PNG');
      assert.equal(bytes.readUInt32BE(16), 1600, 'TAB source capture width changed');
      assert.equal(bytes.readUInt32BE(20), 900, 'TAB source capture height changed');
    }
  }
  const webpBytes = await readFile(resolve(repoRoot, tabVisualAcceptance.webp));
  assert.equal(webpBytes.subarray(0, 4).toString('ascii'), 'RIFF', 'TAB image is not WebP');
  assert.equal(webpBytes.subarray(8, 12).toString('ascii'), 'WEBP', 'TAB image is not WebP');
  verifyTabRhythmAlignment(renderContinuousSvg(tabScore), tabScore);
}

function decodeHtmlText(value) {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function extractFixtureSnippets(html) {
  const snippets = new Map();
  const regex = /<code\s+data-fixture="([^"]+)"[^>]*>([\s\S]*?)<\/code>/gu;
  for (const match of html.matchAll(regex)) {
    assert.ok(!snippets.has(match[1]), `duplicate source snippet for ${match[1]}`);
    snippets.set(match[1], decodeHtmlText(match[2]).replace(/\r\n?/gu, '\n') + '\n');
  }
  return snippets;
}

async function verifyFixtures() {
  const parsed = new Map();
  for (const name of fixtureNames) {
    const source = await readFile(resolve(repoRoot, `marketing/examples/${name}.guitardsl`), 'utf8');
    const score = parseGuitarDsl(source);
    const unexpected = score.diagnostics.filter(item => item.severity === 'error' || item.severity === 'warning');
    assert.deepEqual(unexpected, [], `${name} has compiler errors or warnings`);
    assert.equal(score.measures.length, 4, `${name} must contain four measures`);
    assert.equal(score.timeSignature.numerator, 4, `${name} must use 4/4`);
    assert.equal(score.timeSignature.denominator, 4, `${name} must use 4/4`);
    assert.deepEqual(score.measures.map(measure => measure.chords.map(chord => chord.name)), expectedChords, `${name} chord progression differs`);
    assert.ok(score.measures.every(measure => Math.abs(fraction(measure.expectedBeats) - 4) < 1e-9), `${name} must have four quarter-note beats per bar`);
    parsed.set(name, { source, score });
  }

  const melodyFree = parsed.get('A_chord_lyrics').score;
  assert.equal(melodyFree.hasTab, false, 'A must not contain TAB');
  assert.deepEqual(melodyFree.measures.map(measure => measure.lyric), expectedLyrics, 'A lyrics differ from the approved source');
  let melodyFreeRhythm = [];
  for (const [index, measure] of melodyFree.measures.entries()) {
    assert.equal(measure.melody, undefined, `A measure ${index + 1} unexpectedly has a melody`);
    if (measure.rhythmOrigin === 'repeat') assert.equal(measure.isMeasureRepeat, true, `A measure ${index + 1} repeat was not parsed as a repeat`);
    else melodyFreeRhythm = measure.rhythms;
    const rhythms = measure.rhythmOrigin === 'repeat' ? melodyFreeRhythm : measure.rhythms;
    assert.equal(rhythms.length, 6, `A measure ${index + 1} must contain six effective strums`);
    const total = rhythms.reduce((sum, rhythm) => sum + quarterBeats(rhythm.duration), 0);
    assert.equal(total, 4, `A measure ${index + 1} strums must fill four beats`);
  }

  const withMelody = parsed.get('B_melody_lyrics').score;
  assert.equal(withMelody.hasTab, false, 'B must not contain TAB');
  let melodyRhythm = [];
  for (const [index, measure] of withMelody.measures.entries()) {
    if (measure.rhythmOrigin === 'repeat') assert.equal(measure.isMeasureRepeat, true, `B measure ${index + 1} repeat was not parsed as a repeat`);
    else melodyRhythm = measure.rhythms;
    const accompaniment = measure.rhythmOrigin === 'repeat' ? melodyRhythm : measure.rhythms;
    assert.equal(accompaniment.length, 6, `B measure ${index + 1} must contain six effective accompaniment strokes`);
    assert.equal(accompaniment.reduce((sum, rhythm) => sum + quarterBeats(rhythm.duration), 0), 4, `B measure ${index + 1} accompaniment must fill four beats`);
    assert.equal(measure.melody?.length, 6, `B measure ${index + 1} must contain six melody notes`);
    assert.ok(measure.melody?.every(note => !note.isRest && note.syllables.length === 1), `B measure ${index + 1} needs one lyric syllable per note`);
    assert.equal(measure.melody.reduce((sum, note) => sum + fraction(note.beats), 0), 4, `B measure ${index + 1} melody must fill four beats`);
  }

  const tabScore = parsed.get('C_guitar_tab').score;
  assert.equal(tabScore.hasTab, true, 'C must use the actual TAB parser');
  const chordPitchClasses = [
    [[0, 4, 7], [7, 11, 2]],
    [[9, 0, 4], [4, 7, 11]],
    [[5, 9, 0], [0, 4, 7]],
    [[2, 5, 9], [7, 11, 2, 5]]
  ];
  for (const [measureIndex, measure] of tabScore.measures.entries()) {
    const beats = measure.tabVoices?.find(voice => voice.voice === 1)?.beats;
    assert.equal(beats?.length, 8, `C measure ${measureIndex + 1} must contain eight TAB attacks`);
    assert.ok(beats?.every(beat => Math.abs(fraction(beat.duration.beats) - 0.5) < 1e-9), `C measure ${measureIndex + 1} must use inherited eighth-note values`);
    assert.equal(beats?.reduce((sum, beat) => sum + fraction(beat.duration.beats), 0), 4, `C measure ${measureIndex + 1} TAB must fill four beats`);
    assert.ok((beats?.[0]?.notes.length ?? 0) > 1 && (beats?.[4]?.notes.length ?? 0) > 1, `C measure ${measureIndex + 1} must include simultaneous bass/melody notes`);
    for (const [beatIndex, beat] of (beats ?? []).entries()) {
      const chordIndex = beatIndex < 4 ? 0 : 1;
      for (const note of beat.notes) {
        assert.ok(chordPitchClasses[measureIndex][chordIndex].includes(note.soundingPitch % 12), `C measure ${measureIndex + 1}, beat ${beatIndex + 1} has a note outside its chord`);
      }
    }
  }
  await verifyTabVisualAcceptance(tabScore);
  return parsed;
}

async function verifyBuiltFiles(urls, parsed) {
  const jaPath = resolve(distRoot, 'index.html');
  const enPath = resolve(distRoot, 'en/index.html');
  const [jaHtml, enHtml] = await Promise.all([readFile(jaPath, 'utf8'), readFile(enPath, 'utf8')]);
  const allHtml = [jaHtml, enHtml];
  for (const [index, html] of allHtml.entries()) {
    const locale = index === 0 ? 'ja' : 'en';
    assert.ok(html.includes(`<html lang="${locale}">`), `${locale} document lang is missing`);
    assert.ok(html.includes(`<link rel="canonical" href="${urls.siteUrl}/${locale === 'en' ? 'en/' : ''}">`), `${locale} canonical URL is incorrect`);
    assert.equal((html.match(/href="[^"]*GuitarDSLの使用を開始する|href="[^"]*Start using GuitarDSL/gu) ?? []).length, 0, 'CTA wording must not be part of href');
    const ctaLinks = [...html.matchAll(/<a\b[^>]*class="button"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)];
    assert.equal(ctaLinks.length, 2, `${locale} must have exactly two CTA links`);
    assert.ok(ctaLinks.every(match => match[1] === urls.appUrl), `${locale} CTA does not use its same-environment app URL`);
    const unbound = html.match(/__[A-Z][A-Z0-9_]*__/u);
    assert.equal(unbound, null, `${locale} output contains an unbound template token`);
    for (const forbidden of ['raw.githubusercontent.com', 'data-start', 'CODEX TODO', 'draft-notice', 'preview-pending', 'photograph planned', 'placeholder', '個人開発', 'individually developed']) {
      assert.ok(!html.toLowerCase().includes(forbidden.toLowerCase()), `${locale} output contains forbidden draft text: ${forbidden}`);
    }
    assert.ok(!/<script\b/iu.test(html), `${locale} page must not need JavaScript`);
    assert.equal((html.match(/<img\b/giu) ?? []).length, 5, `${locale} must display a brand icon and four actual screenshots`);
    assert.equal((html.match(/<img\b[^>]*\balt="[^"]+"/giu) ?? []).length, 4, `${locale} screenshot alt text is missing`);
    assert.ok(html.includes('/icons/guitardsl-sidebar.svg'), `${locale} page does not use the product icon`);
    const snippets = extractFixtureSnippets(html);
    assert.deepEqual([...snippets.keys()].sort(), [...fixtureNames].sort(), `${locale} page fixture list differs`);
    for (const [name, snippet] of snippets) {
      assert.equal(snippet, parsed.get(name).source.replace(/\r\n?/gu, '\n'), `${locale} displayed source for ${name} differs from the validated fixture`);
    }
    for (const path of ['/images/editor-split.webp', '/images/melody-free.webp', '/images/melody-lyrics.webp', '/images/solo-guitar-tab.webp']) {
      assert.ok(html.includes(`src="${path}"`), `${locale} page is missing ${path}`);
    }
  }

  await access(resolve(distRoot, 'site.css'));
  await access(resolve(distRoot, 'icons/guitardsl-sidebar.svg'));
  for (const name of ['editor-split', 'melody-free', 'melody-lyrics', 'solo-guitar-tab']) {
    const imagePath = resolve(distRoot, `images/${name}.webp`);
    const imageStat = await stat(imagePath);
    assert.ok(imageStat.size > 1000, `${name}.webp is missing or implausibly small`);
    const header = await readFile(imagePath);
    assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF', `${name}.webp is not a WebP asset`);
    assert.equal(header.subarray(8, 12).toString('ascii'), 'WEBP', `${name}.webp is not a WebP asset`);
  }
  const publicTabImage = await readFile(resolve(repoRoot, tabVisualAcceptance.webp));
  const builtTabImage = await readFile(resolve(distRoot, 'images/solo-guitar-tab.webp'));
  assert.deepEqual(builtTabImage, publicTabImage, 'built TAB image differs from the revision-bound accepted source image');
}

function startStaticServer() {
  const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname === '/en/' ? 'en/index.html' : pathname.replace(/^\//u, '');
    const filePath = resolve(distRoot, relative);
    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream', 'Content-Length': body.byteLength });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(request.method === 'HEAD' ? undefined : 'Not Found');
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not start marketing static server.'));
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function verifyBrowser(browserType, origin, urls) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
    const page = await context.newPage();
    const failedRequests = [];
    const externalRequests = [];
    page.on('requestfailed', request => failedRequests.push(request.url()));
    page.on('request', request => {
      if (!request.url().startsWith(`${origin}/`) && !request.url().startsWith('data:')) externalRequests.push(request.url());
    });
    const footerLinks = [
      'https://github.com/puchinya/vscode-guitar-dsl',
      `${urls.appUrl}licenses/`,
      `${urls.appUrl}privacy/`
    ];
    const evidenceDir = resolve(repoRoot, 'docs/status/evidence/issue-188/marketing-site');
    await mkdir(evidenceDir, { recursive: true });
    for (const route of ['/', '/en/']) {
      const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200, `${browserType.name()} ${route} should return 200`);
      assert.equal(await page.locator('main h1').count(), 1, `${browserType.name()} ${route} needs a main heading`);
      assert.equal(await page.locator('.usecase').count(), 3, `${browserType.name()} ${route} needs three score examples`);
      assert.equal(await page.locator('a.button').count(), 2, `${browserType.name()} ${route} needs two native CTA links`);
      const expectedAppUrl = urls.appUrl;
      assert.deepEqual(await page.locator('a.button').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), [expectedAppUrl, expectedAppUrl]);
      assert.equal(await page.locator('a.button').first().getAttribute('target'), null, 'CTA should keep normal same-tab browser navigation');
      assert.equal(await page.locator('html').getAttribute('lang'), route === '/en/' ? 'en' : 'ja');
      assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)', 'dark OS preference must keep the approved light palette');
      assert.equal(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth), true, `${browserType.name()} ${route} has viewport horizontal overflow`);
      assert.equal(await page.locator('pre.dsl').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).overflowX === 'auto')), true, 'code examples must own horizontal scrolling');
      assert.equal(await page.locator('img').evaluateAll(nodes => nodes.every(node => node.complete && node.naturalWidth > 0)), true, `${browserType.name()} ${route} has a missing image`);
      assert.deepEqual(await page.locator('img[src$=".webp"]').evaluateAll(nodes => nodes.map(node => [node.naturalWidth, node.naturalHeight])), Array.from({ length: 4 }, () => [1600, 900]), `${browserType.name()} ${route} screenshots must be 1600×900`);
      assert.equal(await page.locator('img:not([alt])').count(), 0, `${browserType.name()} ${route} has an image without alt`);
      const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
      assert.equal(canonical, `${urls.siteUrl}/${route === '/en/' ? 'en/' : ''}`);
      const footerHrefs = await page.locator('footer a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.deepEqual(footerHrefs, footerLinks, `${browserType.name()} ${route} footer must link to the matching app environment`);

      for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth), true, `${browserType.name()} ${route} overflows at ${viewport.width}px`);
        assert.equal(await page.locator('main h1').isVisible(), true, `${browserType.name()} ${route} heading is not visible at ${viewport.width}px`);
        assert.equal(await page.locator('a.button').first().isVisible(), true, `${browserType.name()} ${route} CTA is not visible at ${viewport.width}px`);
        const locale = route === '/en/' ? 'en' : 'ja';
        await page.screenshot({ path: resolve(evidenceDir, `marketing-site-${browserType.name()}-${locale}-${viewport.width}x${viewport.height}.png`) });
      }
    }
    const missing = await page.goto(`${origin}/unlisted-route/`, { waitUntil: 'networkidle' });
    assert.equal(missing?.status(), 404, `${browserType.name()} marketing unknown path must return 404`);
    assert.deepEqual(failedRequests, [], `${browserType.name()} had failed static asset requests`);
    assert.deepEqual(externalRequests, [], `${browserType.name()} marketing page attempted an external network request`);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const { name: target, urls } = parseTarget(process.argv.slice(2));
  const parsed = await verifyFixtures();
  await verifyBuiltFiles(urls, parsed);
  const { server, origin } = await startStaticServer();
  try {
    await verifyBrowser(chromium, origin, urls);
    await verifyBrowser(webkit, origin, urls);
  } finally {
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
  console.log(`check:marketing: ${target} HTML, host bindings, original fixtures, assets, Chromium and WebKit passed`);
}

main().catch(error => {
  console.error(`check:marketing: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
