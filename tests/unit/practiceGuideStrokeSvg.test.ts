import * as assert from 'assert';
import { PRACTICE_GUIDE_COMPACT_PATHS, practiceGuideCompactStrokeVisualWidth, practiceGuideStrokeVisualWidth, renderPracticeGuideCompactStrokeSvgElement, renderPracticeGuideCompactWavePathSvg, renderPracticeGuideStrokeSvg, renderPracticeGuideStrokeSvgElement, renderPracticeGuideWavePathSvg, renderPracticeGuideWaveSvg } from '../../src/render/practiceGuideStrokeSvg';

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

  it('keeps the detailed-grid wave renderer compatible with its existing SVG box', () => {
    const wave = renderPracticeGuideWaveSvg('Duration', 56);
    assert.match(wave, /viewBox="0 0 20 16"/);
    assert.match(wave, /d="M2 9Q6 3 10 9T18 9"/);
    assert.match(wave, /width="56"/);
    assert.doesNotMatch(wave, /<text/);
  });

  it('keeps the legacy wave path renderer unchanged', () => {
    const wave = renderPracticeGuideWavePathSvg('Continuation');
    assert.match(wave, /data-guide-stroke="wave"/);
    assert.match(wave, /data-guide-wave-width="12\.00"/);
    assert.match(wave, /d="M0 9Q3\.00 3 6\.00 9T12\.00 9"/);
    assert.match(wave, /stroke-width="1\.50"/);
    assert.doesNotMatch(wave, /<text[^>]*>[↓↑〜]/u);
  });

  it('embeds attack and PM strokes as valid SVG children', () => {
    const attack = renderPracticeGuideStrokeSvgElement({ kind: 'attack', direction: 'down', label: 'Down stroke' });
    const palmMute = renderPracticeGuideStrokeSvgElement({ kind: 'attack', direction: 'up', palmMute: true, label: 'Palm mute' });
    assert.match(attack, /<g class="practice-guide-stroke-icon"/);
    assert.match(attack, /<path/);
    assert.match(palmMute, /<text[^>]*>PM<\/text>/);
    assert.doesNotMatch(`${attack}${palmMute}`, /<span/);
  });

  it('renders canonical compact down/up paths and horizontal-only stroke masters', () => {
    const down = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'down', label: 'Down stroke' });
    const up = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'up', label: 'Up stroke' });
    const both = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'both', label: 'Both strokes' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.downShaft, 'M2 1 V27.8');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.downHead, 'M0.55 24 L2 28.5 L3.45 24');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.upShaft, 'M2 29 V2.2');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.upHead, 'M0.55 6 L2 1.5 L3.45 6');
    assert.match(down, /viewBox="0 0 4 30"/);
    assert.match(down, /width="4" height="30"/);
    assert.match(down, /data-guide-compact-part="shaft" d="M2 1 V27\.8"/);
    assert.match(down, /data-guide-compact-part="head" d="M0\.55 24 L2 28\.5 L3\.45 24"/);
    assert.match(up, /data-guide-compact-part="shaft" d="M2 29 V2\.2"/);
    assert.match(up, /data-guide-compact-part="head" d="M0\.55 6 L2 1\.5 L3\.45 6"/);
    assert.match(down, /stroke-width="1\.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/);
    assert.match(both, /viewBox="0 0 8 30"/);
    assert.match(both, /translate\(4 0\)/);
    assert.match(`${down}${up}${both}`, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(`${down}${up}${both}`, /[↓↑〜]/u);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', label: 'Attack' }), 4);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'tie', label: 'Tie' }), 5.6);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'brush', label: 'Brush' }), 8);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', direction: 'both', label: 'Both' }), 8);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', palmMute: true, label: 'PM attack' }), 18);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'mute', label: 'Mute' }), 4);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'string', label: 'String' }), 4);
    assert.match(renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'down', label: 'Detailed down' }), /viewBox="0 0 20 34"/);
  });

  it('renders compact continuation and tie waves as a fixed short vector path', () => {
    const wave = renderPracticeGuideCompactWavePathSvg('Continuation');
    const tie = renderPracticeGuideCompactStrokeSvgElement({ kind: 'tie', label: 'Tie' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.wave, 'M0.4 15.2 C1.2 13.3 2 13.3 2.8 15.2 S4.4 17.1 5.2 15.2');
    assert.match(wave, /viewBox="0 0 5\.6 30"/);
    assert.match(wave, /<path[^>]*data-guide-stroke="wave"/);
    assert.doesNotMatch(wave, /<svg[^>]*data-guide-stroke="wave"/);
    assert.match(wave, /data-guide-wave-width="5\.60"/);
    assert.match(wave, /d="M0\.4 15\.2 C1\.2 13\.3 2 13\.3 2\.8 15\.2 S4\.4 17\.1 5\.2 15\.2"/);
    assert.match(wave, /stroke-width="1\.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/);
    assert.match(tie, /<path[^>]*data-guide-stroke="tie"/);
    assert.match(tie, /viewBox="0 0 5\.6 30"/);
  });

  it('keeps compact brush and mute masters on the path-based geometry contract', () => {
    const brush = renderPracticeGuideCompactStrokeSvgElement({ kind: 'brush', label: 'Brush' });
    const mute = renderPracticeGuideCompactStrokeSvgElement({ kind: 'mute', label: 'Mute' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.brushCross, 'M0.5 11 L2.5 13 M2.5 11 L0.5 13');
    assert.match(brush, /viewBox="0 0 8 30"/);
    assert.match(brush, /d="M0\.5 11 L2\.5 13 M2\.5 11 L0\.5 13"/);
    assert.match(mute, /viewBox="0 0 4 30"/);
    assert.match(mute, /<circle cx="2" cy="15" r="1\.6"/);
    assert.doesNotMatch(`${brush}${mute}`, /[↓↑〜]/u);
  });
});
