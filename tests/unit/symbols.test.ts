import * as assert from 'assert';
import type * as vscode from 'vscode';
import { formatMeasureSummary, GuitarDslDocumentSymbolProvider } from '../../src/symbols';

function mockTextDocument(source: string): vscode.TextDocument {
  const lines = source.split(/\r?\n/);
  return {
    lineCount: lines.length,
    lineAt(line: number) {
      const text = lines[line];
      return {
        text,
        range: {
          start: { line, character: 0 },
          end: { line, character: text.length }
        }
      };
    }
  } as unknown as vscode.TextDocument;
}

function metadataDetails(source: string): Map<string, string> {
  const symbols = new GuitarDslDocumentSymbolProvider()
    .provideDocumentSymbols(mockTextDocument(source)) as vscode.DocumentSymbol[];
  const metadata = symbols.find(symbol => symbol.name === 'Metadata');
  assert.ok(metadata);
  return new Map(metadata.children.map(symbol => [symbol.name, symbol.detail]));
}

describe('symbols - formatMeasureSummary', () => {
  it('should extract chord names from measure line', () => {
    const line = '| C G | Am Em |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should strip lyrics when formatting summary', () => {
    const line = '| C G | Am Em | l:"思い出すメロディ"';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should handle measure repeat % symbols', () => {
    const line = '| C | % | % | G |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C | % | % | G |');
  });

  it('should strip repeat colons |: and :| from chord tokens', () => {
    const line = '|: C G | Am Em :|';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| C G | Am Em |');
  });

  it('should handle chord extensions and slashed chords', () => {
    const line = '| Cadd9 D/F# | Em7 Bm7 |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| Cadd9 D/F# | Em7 Bm7 |');
  });

  it('should fallback to tokens when no recognized chords are present', () => {
    const line = '| foo bar baz |';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| foo bar baz |');
  });

  it('should format line even without barlines', () => {
    const line = 'No bars here';
    const summary = formatMeasureSummary(line);
    assert.strictEqual(summary, '| No bars here |');
  });
});

describe('symbols - metadata header details', () => {
  it('omits trailing comments while preserving sharp keys', () => {
    const details = metadataDetails('title: Wind Song # note\nkey: F# # note');

    assert.strictEqual(details.get('title'), 'Wind Song');
    assert.strictEqual(details.get('key'), 'F#');
  });

  it('preserves an attached hash in metadata detail', () => {
    assert.strictEqual(metadataDetails('title: Song#1').get('title'), 'Song#1');
  });
});
