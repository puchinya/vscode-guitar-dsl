import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ENVIRONMENTS = {
  development: [
    { kind: 'app', hostname: 'dev.guitardsl.app', productUrl: 'https://wwwdev.guitardsl.app/' },
    { kind: 'marketing', hostname: 'wwwdev.guitardsl.app', appUrl: 'https://dev.guitardsl.app/', siteUrl: 'https://wwwdev.guitardsl.app' }
  ],
  production: [
    { kind: 'app', hostname: 'guitardsl.app', productUrl: 'https://www.guitardsl.app/' },
    { kind: 'marketing', hostname: 'www.guitardsl.app', appUrl: 'https://guitardsl.app/', siteUrl: 'https://www.guitardsl.app' }
  ]
};

const ERROR_PATH = '/__guitardsl_release_readback_missing__';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const timeoutSignal = () => AbortSignal.timeout(15_000);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function readCloudflareJson(url, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: timeoutSignal()
    });
  } catch (error) {
    throw new Error(`Cloudflare settings readback request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  requireValue(response.ok, `Cloudflare settings readback returned HTTP ${response.status}.`);
  const payload = await response.json();
  requireValue(payload?.success === true, 'Cloudflare settings readback API returned success=false.');
  return payload.result;
}

async function verifyCloudflareSettings(token, fetchImpl) {
  const zones = await readCloudflareJson(`${CLOUDFLARE_API}/zones?name=guitardsl.app&status=active`, token, fetchImpl);
  requireValue(Array.isArray(zones) && zones.length === 1 && zones[0]?.name === 'guitardsl.app', 'Cloudflare must return exactly one active guitardsl.app zone.');
  const zoneId = zones[0].id;
  requireValue(typeof zoneId === 'string' && zoneId.length > 0, 'Cloudflare zone readback did not include a zone ID.');
  const [httpsSetting, sslSetting] = await Promise.all([
    readCloudflareJson(`${CLOUDFLARE_API}/zones/${encodeURIComponent(zoneId)}/settings/always_use_https`, token, fetchImpl),
    readCloudflareJson(`${CLOUDFLARE_API}/zones/${encodeURIComponent(zoneId)}/settings/ssl`, token, fetchImpl)
  ]);
  requireValue(httpsSetting?.id === 'always_use_https' && httpsSetting.value === 'on', 'Cloudflare Always Use HTTPS must read back as on.');
  requireValue(sslSetting?.id === 'ssl' && sslSetting.value === 'full', 'Cloudflare SSL mode must read back as Full.');
}

async function fetchChecked(url, fetchImpl) {
  try {
    return await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: timeoutSignal() });
  } catch (error) {
    throw new Error(`Request to ${new URL(url).host} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyHttpRedirect(hostname, fetchImpl) {
  const response = await fetchChecked(`http://${hostname}/`, fetchImpl);
  requireValue([301, 302, 307, 308].includes(response.status), `${hostname}: HTTP / must redirect to HTTPS (received ${response.status}).`);
  const location = response.headers.get('location');
  requireValue(Boolean(location), `${hostname}: HTTP redirect did not include a Location header.`);
  let target;
  try { target = new URL(location, `http://${hostname}/`); }
  catch { throw new Error(`${hostname}: HTTP redirect Location is invalid.`); }
  requireValue(target.protocol === 'https:' && target.hostname === hostname && target.pathname === '/', `${hostname}: HTTP / must redirect to https://${hostname}/.`);
}

async function fetchHtml(hostname, fetchImpl) {
  const response = await fetchChecked(`https://${hostname}/`, fetchImpl);
  requireValue(response.status === 200, `${hostname}: HTTPS / must return 200 (received ${response.status}).`);
  const contentType = response.headers.get('content-type') ?? '';
  requireValue(/text\/html/iu.test(contentType), `${hostname}: HTTPS / did not return an HTML document.`);
  return response.text();
}

async function readAppBundleText(hostname, html, fetchImpl) {
  const entryScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/giu)].map(match => match[1]);
  requireValue(entryScripts.length > 0, `${hostname}: app HTML does not reference a JavaScript entry module.`);
  const pending = entryScripts.map(source => new URL(source, `https://${hostname}/`).href);
  const visited = new Set();
  const bundles = [];
  while (pending.length) {
    const url = pending.pop();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const parsed = new URL(url);
    if (parsed.origin !== `https://${hostname}` || !parsed.pathname.startsWith('/assets/') || !parsed.pathname.endsWith('.js')) continue;
    const response = await fetchChecked(url, fetchImpl);
    requireValue(response.status === 200, `${hostname}: JavaScript asset ${parsed.pathname} must return 200 (received ${response.status}).`);
    const source = await response.text();
    bundles.push(source);
    for (const match of source.matchAll(/\b(?:from\s*|import\s*\()(["'])([^"']+\.js(?:\?[^"']*)?)\1\s*\)?/gu)) {
      const imported = new URL(match[2], url);
      if (imported.origin === `https://${hostname}` && imported.pathname.startsWith('/assets/')) pending.push(imported.href);
    }
  }
  return bundles.join('\n');
}

async function verifyHost(target, fetchImpl) {
  await verifyHttpRedirect(target.hostname, fetchImpl);
  const html = await fetchHtml(target.hostname, fetchImpl);
  requireValue(html.includes('GuitarDSL'), `${target.hostname}: page is missing the GuitarDSL product marker.`);

  if (target.kind === 'marketing') {
    requireValue(html.includes(target.siteUrl), `${target.hostname}: canonical site URL does not match this environment.`);
    requireValue(html.includes(target.appUrl), `${target.hostname}: primary app link does not point to the matching environment.`);
    const otherAppUrl = target.appUrl.includes('dev.') ? 'https://guitardsl.app/' : 'https://dev.guitardsl.app/';
    requireValue(!html.includes(otherAppUrl), `${target.hostname}: page contains an app link for the other environment.`);
    const missing = await fetchChecked(`https://${target.hostname}${ERROR_PATH}`, fetchImpl);
    requireValue(missing.status === 404, `${target.hostname}: unknown marketing paths must return 404 (received ${missing.status}).`);
  } else {
    const bundles = await readAppBundleText(target.hostname, html, fetchImpl);
    requireValue(bundles.includes(target.productUrl), `${target.hostname}: Product introduction Help action does not target the matching site.`);
    const otherProductUrl = target.productUrl.includes('wwwdev.') ? 'https://www.guitardsl.app/' : 'https://wwwdev.guitardsl.app/';
    requireValue(!bundles.includes(otherProductUrl), `${target.hostname}: app bundle contains the other environment's Product introduction target.`);
  }
}

function wait(milliseconds) {
  return new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
}

async function verifyHostWithRetry(target, fetchImpl, attempts, retryDelayMs, sleepImpl) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await verifyHost(target, fetchImpl);
      console.log(`release-readback: PASS ${target.hostname}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`release-readback: ${target.hostname} check ${attempt}/${attempts} did not pass; retrying in ${retryDelayMs / 1000}s.`);
        await sleepImpl(retryDelayMs);
      }
    }
  }
  throw new Error(`${target.hostname}: release readback failed after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function runReleaseReadback({ environment, token = process.env.CLOUDFLARE_API_TOKEN, fetchImpl = fetch, attempts = 6, retryDelayMs = 10_000, sleepImpl = wait } = {}) {
  requireValue(environment === 'development' || environment === 'production' || environment === 'all', 'Usage: node scripts/release-readback.mjs --environment development|production|all');
  requireValue(typeof token === 'string' && token.length > 0, 'CLOUDFLARE_API_TOKEN is required for Cloudflare zone-settings readback.');
  requireValue(Number.isInteger(attempts) && attempts > 0, 'attempts must be a positive integer.');
  await verifyCloudflareSettings(token, fetchImpl);
  console.log('release-readback: PASS Cloudflare Always Use HTTPS=on, SSL=Full');
  const targets = environment === 'all' ? [...ENVIRONMENTS.development, ...ENVIRONMENTS.production] : ENVIRONMENTS[environment];
  await Promise.all(targets.map(target => verifyHostWithRetry(target, fetchImpl, attempts, retryDelayMs, sleepImpl)));
  console.log(`release-readback: PASS environment=${environment}`);
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--environment') {
    throw new Error('Usage: node scripts/release-readback.mjs --environment development|production|all');
  }
  await runReleaseReadback({ environment: args[1] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`release-readback: FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
