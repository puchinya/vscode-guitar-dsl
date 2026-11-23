import { strict as assert } from 'node:assert';
import test from 'node:test';
import { runReleaseReadback } from '../../../scripts/release-readback.mjs';

interface FixtureOptions {
  alwaysUseHttps?: string;
  ssl?: string;
  wrongDevelopmentTarget?: boolean;
  wrongDevelopmentMarketingTarget?: boolean;
  disableDevelopmentRedirect?: boolean;
  failDevelopmentTls?: boolean;
}

function createFetchFixture(options: FixtureOptions = {}) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    calls.push({ url, init });
    if (url.hostname === 'api.cloudflare.com') {
      if (url.pathname === '/client/v4/zones') {
        return Response.json({ success: true, result: [{ id: 'zone-1', name: 'guitardsl.app' }] });
      }
      if (url.pathname.endsWith('/settings/always_use_https')) {
        return Response.json({ success: true, result: { id: 'always_use_https', value: options.alwaysUseHttps ?? 'on' } });
      }
      if (url.pathname.endsWith('/settings/ssl')) {
        return Response.json({ success: true, result: { id: 'ssl', value: options.ssl ?? 'full' } });
      }
      return Response.json({ success: false, errors: [{ message: 'unexpected API request' }] }, { status: 404 });
    }

    const isDevelopment = url.hostname.includes('dev.');
    if (url.protocol === 'http:') {
      if (isDevelopment && options.disableDevelopmentRedirect) return new Response('', { status: 200 });
      return new Response('', { status: 308, headers: { location: `https://${url.hostname}/` } });
    }
    if (isDevelopment && options.failDevelopmentTls && url.pathname === '/') throw new Error('simulated certificate error');
    if (url.pathname === '/') {
      if (url.hostname === 'dev.guitardsl.app' || url.hostname === 'guitardsl.app') {
        return new Response('<html><title>GuitarDSL</title><script type="module" src="/assets/main.js"></script></html>', {
          status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
      const development = url.hostname === 'wwwdev.guitardsl.app';
      const appUrl = development ? 'https://dev.guitardsl.app/' : 'https://guitardsl.app/';
      const expectedAppUrl = development && options.wrongDevelopmentMarketingTarget ? 'https://guitardsl.app/' : appUrl;
      const siteUrl = `https://${url.hostname}`;
      return new Response(`<html><title>GuitarDSL</title><link rel="canonical" href="${siteUrl}/"><a href="${expectedAppUrl}">Start</a></html>`, {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (url.pathname === '/assets/main.js') {
      return new Response('export * from "./runtime.js";', { status: 200, headers: { 'content-type': 'text/javascript' } });
    }
    if (url.pathname === '/assets/runtime.js') {
      const expectedProduct = isDevelopment ? 'https://wwwdev.guitardsl.app/' : 'https://www.guitardsl.app/';
      const productUrl = isDevelopment && options.wrongDevelopmentTarget ? 'https://www.guitardsl.app/' : expectedProduct;
      return new Response(`export const VITE_GUITARDSL_PRODUCT_INTRO_URL="${productUrl}";`, { status: 200, headers: { 'content-type': 'text/javascript' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { calls, fetchImpl };
}

test('release readback validates the development URLs, exact environment targets, HTTPS redirects, and zone settings', async () => {
  const fixture = createFetchFixture();
  await runReleaseReadback({ environment: 'development', token: 'test-token', fetchImpl: fixture.fetchImpl, attempts: 1 });

  const hosts = new Set(fixture.calls.filter(call => call.url.protocol === 'http:').map(call => call.url.hostname));
  assert.deepEqual(hosts, new Set(['dev.guitardsl.app', 'wwwdev.guitardsl.app']));
  assert.ok(fixture.calls.some(call => call.url.pathname === '/__guitardsl_release_readback_missing__' && call.url.hostname === 'wwwdev.guitardsl.app'));
  assert.ok(fixture.calls.filter(call => call.url.hostname === 'api.cloudflare.com').every(call => call.init?.headers && (call.init.headers as Record<string, string>).Authorization === 'Bearer test-token'));
});

test('production readback checks all four hosts after publication', async () => {
  const fixture = createFetchFixture();
  await runReleaseReadback({ environment: 'all', token: 'test-token', fetchImpl: fixture.fetchImpl, attempts: 1 });
  assert.deepEqual(new Set(fixture.calls.filter(call => call.url.protocol === 'http:').map(call => call.url.hostname)), new Set([
    'dev.guitardsl.app', 'wwwdev.guitardsl.app', 'guitardsl.app', 'www.guitardsl.app'
  ]));
});

test('release readback fails when HTTPS, zone settings, or environment links do not match', async () => {
  const cases: Array<{ options: FixtureOptions; environment: 'development'; message: RegExp }> = [
    { options: { alwaysUseHttps: 'off' }, environment: 'development', message: /Always Use HTTPS must read back as on/u },
    { options: { disableDevelopmentRedirect: true }, environment: 'development', message: /must redirect to HTTPS/u },
    { options: { wrongDevelopmentTarget: true }, environment: 'development', message: /Help action does not target the matching site/u },
    { options: { wrongDevelopmentMarketingTarget: true }, environment: 'development', message: /primary app link does not point to the matching environment/u },
    { options: { failDevelopmentTls: true }, environment: 'development', message: /simulated certificate error/u }
  ];
  for (const scenario of cases) {
    const fixture = createFetchFixture(scenario.options);
    await assert.rejects(
      runReleaseReadback({ environment: scenario.environment, token: 'test-token', fetchImpl: fixture.fetchImpl, attempts: 1 }),
      scenario.message
    );
  }
});
