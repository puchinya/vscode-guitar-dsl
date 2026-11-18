import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebI18n } from '../../src/i18n';
import { en } from '../../src/i18n/messages/en';
import { ja } from '../../src/i18n/messages/ja';

function flattenMessages(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected a nested message object at ${prefix || '<root>'}.`);
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return Object.entries(flattenMessages(child, path));
  }));
}

function interpolationNames(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!).sort();
}

test('English and Japanese message keys and interpolation variables match', () => {
  const english = flattenMessages(en);
  const japanese = flattenMessages(ja);

  assert.deepEqual(Object.keys(japanese).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english)) {
    assert.deepEqual(interpolationNames(japanese[key]!), interpolationNames(english[key]!), `${key} interpolation`);
  }
});

test('Problem severity labels keep their existing tokens and define info in both locales', () => {
  const expected = { error: 'error', warning: 'warning', info: 'info' };
  assert.deepEqual(en.problems.severityType, expected);
  assert.deepEqual(ja.problems.severityType, expected);
});

test('global Composer starts at the Controller locale and switches both ways', () => {
  const i18n = createWebI18n('en');
  assert.equal(i18n.global.locale.value, 'en');
  assert.equal(i18n.global.t('menu.file'), 'File');

  i18n.global.locale.value = 'ja';
  assert.equal(i18n.global.t('menu.file'), 'ファイル');
  i18n.global.locale.value = 'en';
  assert.equal(i18n.global.t('menu.file'), 'File');
});

test('missing Japanese messages fall back to English and missing keys remain detectable', () => {
  const i18n = createWebI18n('ja');
  i18n.global.setLocaleMessage('ja', {} as typeof ja);

  assert.equal(i18n.global.t('menu.file'), en.menu.file);
  assert.equal(i18n.global.te('missing.message.key'), false);
});
