import * as assert from 'assert';
import { resolveLocale, getMessages, MESSAGES_JA, MESSAGES_EN } from '../../src/i18n';

describe('i18n - resolveLocale', () => {
  it('should resolve Japanese locale for ja and regional variants', () => {
    assert.strictEqual(resolveLocale('ja'), 'ja');
    assert.strictEqual(resolveLocale('ja-JP'), 'ja');
    assert.strictEqual(resolveLocale('ja-jp'), 'ja');
    assert.strictEqual(resolveLocale('JA'), 'ja');
    assert.strictEqual(resolveLocale('JA-JP'), 'ja');
    assert.strictEqual(resolveLocale('ja_JP'), 'ja');
  });

  it('should fallback to English for non-Japanese locales', () => {
    assert.strictEqual(resolveLocale('en'), 'en');
    assert.strictEqual(resolveLocale('en-US'), 'en');
    assert.strictEqual(resolveLocale('en-GB'), 'en');
    assert.strictEqual(resolveLocale('fr'), 'en');
    assert.strictEqual(resolveLocale('de'), 'en');
    assert.strictEqual(resolveLocale('zh-CN'), 'en');
    assert.strictEqual(resolveLocale('es'), 'en');
  });

  it('should fallback to English when language is undefined or empty', () => {
    assert.strictEqual(resolveLocale(undefined), 'en');
    assert.strictEqual(resolveLocale(''), 'en');
    assert.strictEqual(resolveLocale('   '), 'en');
  });
});

describe('i18n - getMessages', () => {
  it('should return MESSAGES_JA for ja', () => {
    const msgs = getMessages('ja');
    assert.strictEqual(msgs, MESSAGES_JA);
    assert.strictEqual(msgs.uiView, '表示');
    assert.strictEqual(msgs.msgOpenFile, 'ファイルを開く');
    assert.strictEqual(msgs.msgPdfSaved('score.pdf'), 'PDFを保存しました: score.pdf');
  });

  it('should return MESSAGES_EN for en', () => {
    const msgs = getMessages('en');
    assert.strictEqual(msgs, MESSAGES_EN);
    assert.strictEqual(msgs.uiView, 'View');
    assert.strictEqual(msgs.msgOpenFile, 'Open File');
    assert.strictEqual(msgs.msgPdfSaved('score.pdf'), 'PDF saved: score.pdf');
  });

  it('should have symmetric keys between MESSAGES_JA and MESSAGES_EN', () => {
    const jaKeys = Object.keys(MESSAGES_JA).sort();
    const enKeys = Object.keys(MESSAGES_EN).sort();
    assert.deepStrictEqual(jaKeys, enKeys);
  });
});
