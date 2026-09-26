import * as vscode from 'vscode';

const CHORD_REGEX = /^[A-G][b#]?(?:maj|m|min|aug|dim|sus[24]|add9|[0-9]+)*(?:\/[A-G][b#]?)?(?::[0-9]+(?:\.[0-9]+)?)?$/;

export function formatMeasureSummary(lineText: string): string {
  // Strip lyrics first
  const noLyrics = lineText.replace(/l:\"[^\"]*\"/g, '').trim();
  const rawBars = noLyrics.split('|').map(s => s.trim()).filter(Boolean);

  const barSummaries: string[] = [];
  let hasAnyChord = false;

  for (const bar of rawBars) {
    const cleanBar = bar.replace(/^:+|:+$/g, '').trim();
    if (!cleanBar) continue;
    const tokens = cleanBar.split(/\s+/).filter(Boolean);
    const chordsOrRepeats = tokens.filter(t => CHORD_REGEX.test(t) || t === '%');
    if (chordsOrRepeats.length > 0) {
      hasAnyChord = true;
      barSummaries.push(chordsOrRepeats.join(' '));
    }
  }

  if (hasAnyChord && barSummaries.length > 0) {
    return '| ' + barSummaries.join(' | ') + ' |';
  }

  for (const bar of rawBars) {
    const cleanBar = bar.replace(/^:+|:+$/g, '').trim();
    if (!cleanBar) continue;
    const tokens = cleanBar.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      barSummaries.push(tokens.slice(0, 3).join(' '));
    }
  }

  if (barSummaries.length > 0) {
    return '| ' + barSummaries.join(' | ') + ' |';
  }
  return noLyrics || lineText.trim();
}

export class GuitarDslDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const metadataSymbols: vscode.DocumentSymbol[] = [];

    const lineCount = document.lineCount;
    let currentSectionSymbol: vscode.DocumentSymbol | undefined = undefined;
    let sectionStartLine = -1;

    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const line = document.lineAt(lineIdx);
      const text = line.text.trim();

      if (!text || text.startsWith('#') || /^---+$/.test(text) || /^pagebreak$/i.test(text)) {
        continue;
      }

      // Metadata headers: title, artist, capo, key, original_key, tempo, bpm, memo, style properties
      const headerMatch = text.match(/^(title|artist|capo|key|original_key|tempo|bpm|memo|time|time_signature|meter|feel|pickup|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size|text_size)):\s*(.*)$/i);
      if (headerMatch) {
        const key = headerMatch[1];
        const val = headerMatch[2].trim();
        const propSymbol = new vscode.DocumentSymbol(
          key,
          val,
          vscode.SymbolKind.Property,
          line.range,
          line.range
        );
        metadataSymbols.push(propSymbol);
        continue;
      }

      // Score event: @key: D, @tempo: 132, @time: 7/8 ... (label keeps the name and the value without a comment)
      const eventMatch = text.match(/^@([A-Za-z_]+)\s*:\s*(.*)$/);
      if (eventMatch) {
        const comment = eventMatch[2].search(/\s+#/);
        const value = (comment >= 0 ? eventMatch[2].slice(0, comment) : eventMatch[2]).trim();
        const eventSymbol = new vscode.DocumentSymbol(
          `@${eventMatch[1].toLowerCase()}: ${value}`,
          '',
          vscode.SymbolKind.Event,
          line.range,
          line.range
        );
        if (currentSectionSymbol) {
          currentSectionSymbol.children.push(eventSymbol);
        } else {
          symbols.push(eventSymbol);
        }
        continue;
      }

      // Section label: [Intro], [Aメロ], etc.
      const secMatch = text.match(/^\[([^\]]+)\]$/);
      if (secMatch) {
        // If there was a previous section, finalize its range
        if (currentSectionSymbol && sectionStartLine >= 0) {
          const prevEndLine = Math.max(sectionStartLine, lineIdx - 1);
          currentSectionSymbol.range = new vscode.Range(
            document.lineAt(sectionStartLine).range.start,
            document.lineAt(prevEndLine).range.end
          );
        }

        const secName = secMatch[1];
        currentSectionSymbol = new vscode.DocumentSymbol(
          secName,
          '',
          vscode.SymbolKind.Namespace,
          line.range,
          line.range
        );
        symbols.push(currentSectionSymbol);
        sectionStartLine = lineIdx;
        continue;
      }

      // Measure line: | C | 4.d ... |
      if (text.includes('|')) {
        let lyric = '';
        const lyricMatch = text.match(/l:\"([^\"]*)\"/);
        if (lyricMatch) {
          lyric = lyricMatch[1];
        }

        const summary = formatMeasureSummary(text);

        const measureSymbol = new vscode.DocumentSymbol(
          summary,
          lyric,
          vscode.SymbolKind.String,
          line.range,
          line.range
        );

        if (currentSectionSymbol) {
          currentSectionSymbol.children.push(measureSymbol);
        } else {
          symbols.push(measureSymbol);
        }
      }
    }

    // Finalize last section's range to the end of document
    if (currentSectionSymbol && sectionStartLine >= 0 && lineCount > 0) {
      currentSectionSymbol.range = new vscode.Range(
        document.lineAt(sectionStartLine).range.start,
        document.lineAt(lineCount - 1).range.end
      );
    }

    // If metadata exists, prepend Metadata group symbol
    if (metadataSymbols.length > 0) {
      const firstRange = metadataSymbols[0].range;
      const lastRange = metadataSymbols[metadataSymbols.length - 1].range;
      const metaGroup = new vscode.DocumentSymbol(
        'Metadata',
        '',
        vscode.SymbolKind.Module,
        new vscode.Range(firstRange.start, lastRange.end),
        firstRange
      );
      metaGroup.children = metadataSymbols;
      symbols.unshift(metaGroup);
    }

    return symbols;
  }
}
