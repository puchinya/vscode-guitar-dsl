import * as assert from 'assert';
import { frac } from '../../src/duration';
import { getMessages } from '../../src/i18n';
import { renderPracticeGuidePanel } from '../../src/render/previewHtml';

describe('Practice guide panel renderer', () => {
  it('calculates the shared compact technique height from simultaneous internal events', () => {
    const attack = (eventIndex: number) => ({
      at: frac(0),
      durationBeats: frac(1),
      eventStart: frac(0),
      eventEnd: frac(1),
      label: 'down',
      duration: '4',
      kind: 'attack' as const,
      eventIndex,
      durationWaveEligible: true,
      stroke: { kind: 'attack' as const, direction: 'down' as const, label: 'down' }
    });
    const data: Parameters<typeof renderPracticeGuidePanel>[0] = {
      automaticGrid: 4,
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
        techniques: index === 0 ? [attack(0), attack(1)] : [attack(index + 1)]
      }))
    };

    const html = renderPracticeGuidePanel(data, getMessages('en'), []);
    const rowTops = [...html.matchAll(/class="practice-guide-compact-symbol"[^>]*style="left:[^"]+;top:([\d.]+)px"/g)]
      .map(match => Number(match[1]));

    assert.match(html, /data-guide-technique-height="67"/,
      'the renderer derives a 67px shared compact lane from the two allocated rows');
    assert.match(html, /--guide-compact-technique-height:67px/,
      'the computed maximum is published to the compact panel for all cards and its label rail');
    assert.strictEqual((html.match(/class="practice-guide-compact-measure"/g) ?? []).length, 4,
      'the compact renderer retains the fixed four-measure page');
    assert.deepStrictEqual(rowTops, [2, 33, 2, 2, 2],
      'only the measure with two simultaneous events is split into the two 31px-pitched rows');
  });
});
