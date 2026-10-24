import * as assert from 'assert';
import { practiceGuideStrokeVisualWidth, renderPracticeGuideStrokeSvg, renderPracticeGuideWaveSvg } from '../../src/render/practiceGuideStrokeSvg';

describe('practice guide stroke SVG', () => {
  it('renders down and up attacks as vector geometry with descriptive labels', () => {
    const down = renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'down', label: 'Down stroke' });
    const up = renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'up', label: 'Up stroke' });
    assert.match(down, /viewBox="0 0 20 34"/);
    assert.match(down, /<path/);
    assert.match(up, /<path/);
    assert.match(down, /aria-label="Down stroke"/);
    assert.doesNotMatch(`${down}${up}`, /<text[^>]*>[↓↑〜]/);
  });

  it('renders mute, brush, string and PM marks without font glyph arrows', () => {
    const mute = renderPracticeGuideStrokeSvg({ kind: 'mute', label: 'Mute' });
    const brush = renderPracticeGuideStrokeSvg({ kind: 'brush', direction: 'down', label: 'Brush' });
    const string = renderPracticeGuideStrokeSvg({ kind: 'string', stringNumber: 5, label: '5th string' });
    const palmMute = renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'up', palmMute: true, label: 'Palm mute' });
    assert.match(mute, /<circle/);
    assert.match(brush, /data-guide-stroke="brush"/);
    assert.match(brush, /<path/);
    assert.match(string, />5<\/text>/);
    assert.match(palmMute, /<span class="practice-guide-pm-label">PM<\/span>/);
    assert.doesNotMatch(`${mute}${brush}${string}${palmMute}`, /[↓↑〜]/);
  });

  it('shares each rendered stroke width with compact layout, including palm mute composites', () => {
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'attack', label: 'Attack' }), 14);
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'brush', label: 'Brush' }), 20);
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'tie', label: 'Tie' }), 32);
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'string', label: 'String' }), 16);
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'attack', palmMute: true, label: 'PM attack' }), 28);
    assert.strictEqual(practiceGuideStrokeVisualWidth({ kind: 'brush', palmMute: true, label: 'PM brush' }), 34);
  });

  it('draws one stretchable duration wave with the specified Bezier path', () => {
    const wave = renderPracticeGuideWaveSvg('Duration', 56);
    assert.match(wave, /viewBox="0 0 20 16"/);
    assert.match(wave, /d="M2 9Q6 3 10 9T18 9"/);
    assert.match(wave, /width="56"/);
    assert.doesNotMatch(wave, /<text/);
  });
});
