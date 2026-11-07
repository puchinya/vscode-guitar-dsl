import * as assert from 'assert';
import { PRACTICE_GUIDE_COMPACT_PATHS, PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS, practiceGuideCompactStrokeVisualWidth, practiceGuideCompactWaveVariant, practiceGuideStrokeVisualWidth, renderPracticeGuideCompactStrokeSvgElement, renderPracticeGuideCompactWavePathSvg, renderPracticeGuideStrokeSvg, renderPracticeGuideStrokeSvgElement, renderPracticeGuideWavePathSvg, renderPracticeGuideWaveSvg } from '../../src/render/practiceGuideStrokeSvg';

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
    const palmMuteDown = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'down', palmMute: true, label: 'PM down stroke' });
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
    assert.strictEqual(palmMuteDown, down, 'compact PM metadata never moves or widens the attack path');
    assert.doesNotMatch(palmMuteDown, /practice-guide-pm-label|>PM</);
    assert.match(`${down}${up}${both}`, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(`${down}${up}${both}`, /[↓↑〜]/u);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', label: 'Attack' }), 4);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'tie', label: 'Tie' }), 5.6);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'brush', label: 'Brush' }), 8);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', direction: 'both', label: 'Both' }), 8);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', palmMute: true, label: 'PM attack' }), 4);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'mute', label: 'Mute' }), 4);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'string', label: 'String' }), 4);
    assert.match(renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'down', label: 'Detailed down' }), /viewBox="0 0 20 34"/);
  });

  it('renders compact continuation waves as fixed variants and keeps ties wide', () => {
    const wave = renderPracticeGuideCompactWavePathSvg('Continuation', 8);
    const narrow = renderPracticeGuideCompactWavePathSvg('Narrow', 16, 'narrow');
    const medium = renderPracticeGuideCompactWavePathSvg('Medium', 16, 'medium');
    const wide = renderPracticeGuideCompactWavePathSvg('Wide', 16, 'wide');
    const tie = renderPracticeGuideCompactStrokeSvgElement({ kind: 'tie', label: 'Tie' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.wave, 'M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15');
    assert.deepStrictEqual(PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS, {
      narrow: { width: 2.4, path: 'M0.15 15 C0.45 9.8 0.90 9.8 1.20 15 S1.95 20.2 2.25 15' },
      medium: { width: 4.2, path: 'M0.45 15 C1.00 10.4 1.55 10.4 2.10 15 S3.20 19.6 3.75 15' },
      wide: { width: 5.6, path: 'M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15' }
    });
    assert.match(wave, /viewBox="0 0 5\.6 30"/);
    assert.match(wave, /data-guide-wave-variant="wide"/);
    assert.match(wave, /<path[^>]*data-guide-stroke="wave"/);
    assert.doesNotMatch(wave, /<svg[^>]*data-guide-stroke="wave"/);
    assert.match(wave, /data-guide-wave-width="5\.60"/);
    assert.match(wave, /d="M0\.40 15 C1\.15 10\.8 2\.00 10\.8 2\.80 15 S4\.45 19\.2 5\.20 15"/);
    assert.match(wave, /stroke-width="1\.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/);
    for (const [svg, variant, width, viewBox, path] of [
      [narrow, 'narrow', '2.40', '0 0 2.4 30', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.narrow.path],
      [medium, 'medium', '4.20', '0 0 4.2 30', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.medium.path],
      [wide, 'wide', '5.60', '0 0 5.6 30', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path]
    ] as const) {
      assert.match(svg, new RegExp(`viewBox="${viewBox.replaceAll('.', '\\.')}"`));
      assert.match(svg, new RegExp(`data-guide-wave-variant="${variant}"`));
      assert.match(svg, new RegExp(`data-guide-wave-width="${width}"`));
      assert.ok(svg.includes(`d="${path}"`));
      assert.match(svg, /stroke-width="1\.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/);
    }
    assert.strictEqual(practiceGuideCompactWaveVariant(100, 4, 16), 'medium');
    assert.strictEqual(practiceGuideCompactWaveVariant(122, 4, 16), 'wide', '7px cells select the wide path');
    assert.strictEqual(practiceGuideCompactWaveVariant(121.99, 4, 16), 'medium', 'cells below 7px select medium');
    assert.strictEqual(practiceGuideCompactWaveVariant(98, 4, 16), 'medium', '5.5px cells select medium');
    assert.strictEqual(practiceGuideCompactWaveVariant(97.99, 4, 16), 'narrow', 'cells below 5.5px select narrow');
    assert.strictEqual(practiceGuideCompactWaveVariant(320 / 4, 4, 16), 'narrow');
    assert.strictEqual(practiceGuideCompactWaveVariant(600 / 4, 4, 16), 'wide');
    assert.strictEqual(practiceGuideCompactWaveVariant(100, 4, 8), 'wide');
    assert.match(tie, /<path[^>]*data-guide-stroke="tie"/);
    assert.match(tie, /data-guide-wave-variant="wide"/);
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
