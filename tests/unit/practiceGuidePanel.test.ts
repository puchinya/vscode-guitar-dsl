import * as assert from 'assert';
import { frac } from '../../src/duration';
import { getMessages } from '../../src/i18n';
import { renderPracticeGuidePanel } from '../../src/render/previewHtml';

describe('Practice guide panel renderer', () => {
  const render = (techniques: Parameters<typeof renderPracticeGuidePanel>[0]['measures'][number]['techniques'] = []) => {
    const data: Parameters<typeof renderPracticeGuidePanel>[0] = {
      automaticGrid: 16,
      automaticFill: false,
      totalBeats: frac(16),
      lyricsHeight: 38,
      pitchMinMidi: 60,
      pitchMaxMidi: 72,
      measures: Array.from({ length: 4 }, (_, index) => ({
        number: index + 1,
        startBeat: frac(index * 4),
        beats: frac(4),
        chords: [],
        melody: [],
        lyrics: [],
        techniques: index === 0 ? techniques : []
      }))
    };
    return renderPracticeGuidePanel(data, getMessages('en'), []);
  };

  it('renders one compact SVG per measure with the shared lane order and four fixed slots', () => {
    const html = render();
    const roots = [...html.matchAll(/<svg class="practice-guide-compact-svg"/g)];
    assert.strictEqual(roots.length, 4);
    assert.strictEqual((html.match(/class="practice-guide-compact-measure"/g) ?? []).length, 4);
    const first = html.slice(html.indexOf('<svg class="practice-guide-compact-svg"'), html.indexOf('</svg>') + 6);
    const laneOrder = [...first.matchAll(/data-guide-lane="([^"]+)"/g)].map(match => match[1]);
    assert.deepStrictEqual(laneOrder, ['ruler', 'melody', 'lyrics', 'technique', 'chord', 'diagrams']);
    assert.match(first, /viewBox="0 0 100 100"/);
    assert.match(html, /data-guide-projections=/);
    assert.doesNotMatch(html, /practice-guide-compact-wave/);
  });

  it('renders each continuation Fraction as its own wave path at the matching grid and event', () => {
    const base = {
      at: frac(0),
      durationBeats: frac(0),
      eventStart: frac(0),
      eventEnd: frac(1),
      label: '〜',
      duration: '',
      kind: 'continuation' as const,
      grid: 16 as const,
      eventIndex: 7,
      durationWaveEligible: false
    };
    const html = render([
      { ...base, at: frac(1, 4) },
      { ...base, at: frac(1, 2) },
      { ...base, at: frac(3, 4) }
    ]);
    const compactStart = html.indexOf('<template data-guide-template-measure="0">');
    const compactEnd = html.indexOf('</div>', compactStart);
    const compactHtml = html.slice(compactStart, compactEnd);
    const paths = [...compactHtml.matchAll(/<path\b[^>]*data-guide-stroke="wave"[^>]*>/g)].map(match => match[0]);
    assert.strictEqual(paths.length, 3, 'every continuation is a separate vector path');
    assert.deepStrictEqual(paths.map(path => path.match(/data-guide-at-fraction="([^"]+)"/)?.[1]), ['1/4', '1/2', '3/4']);
    assert.ok(paths.every(path => /data-guide-wave-grid="16"/.test(path)));
    assert.ok(paths.every(path => /data-guide-event="7"/.test(path)));
    assert.ok(paths.every(path => /data-guide-at-beat="/.test(path)));
    assert.doesNotMatch(compactHtml, /practice-guide-compact-wave/);
  });
});
