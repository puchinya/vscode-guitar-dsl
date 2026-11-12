import * as assert from 'assert';
import { PRACTICE_GUIDE_COMPACT_PATHS, PRACTICE_GUIDE_COMPACT_REFERENCE_LAYOUT, PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS, practiceGuideCompactStrokeVisualWidth, practiceGuideCompactWaveVariant, practiceGuideStrokeVisualWidth, renderPracticeGuideCompactStrokeSvgElement, renderPracticeGuideCompactWavePathSvg, renderPracticeGuideStrokeSvg, renderPracticeGuideStrokeSvgElement, renderPracticeGuideWavePathSvg, renderPracticeGuideWaveSvg } from '../../src/render/practiceGuideStrokeSvg';

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

  it('keeps the legacy general-purpose wave renderer compatible with its existing SVG box', () => {
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

  it('renders reference-traced 15x47 compact arrows with separate solid heads', () => {
    const down = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'down', label: 'Down stroke' });
    const up = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'up', label: 'Up stroke' });
    const both = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'both', label: 'Both strokes' });
    const palmMuteDown = renderPracticeGuideCompactStrokeSvgElement({ kind: 'attack', direction: 'down', palmMute: true, label: 'PM down stroke' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.downShaft, 'M0 0 V31');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.downHead, 'M-7.5 30 L7.5 30 L0 47 Z');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.upShaft, 'M0 47 V17');
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.upHead, 'M-7.5 17 L0 0 L7.5 17 Z');
    assert.match(down, /viewBox="0 0 15 47"/);
    assert.match(down, /width="15" height="47"/);
    assert.match(down, /data-guide-compact-part="shaft" d="M0 0 V31" fill="none" stroke="currentColor" stroke-width="2\.65" stroke-linecap="butt"/);
    assert.match(down, /data-guide-compact-part="head" d="M-7\.5 30 L7\.5 30 L0 47 Z" fill="currentColor" stroke="none"/);
    assert.match(up, /data-guide-compact-part="shaft" d="M0 47 V17" fill="none" stroke="currentColor" stroke-width="2\.65" stroke-linecap="butt"/);
    assert.match(up, /data-guide-compact-part="head" d="M-7\.5 17 L0 0 L7\.5 17 Z" fill="currentColor" stroke="none"/);
    assert.match(both, /viewBox="0 0 30 47"/);
    assert.match(both, /translate\(22\.5 0\)/);
    assert.strictEqual(palmMuteDown, down, 'compact PM metadata never moves or widens the attack path');
    assert.doesNotMatch(palmMuteDown, /practice-guide-pm-label|>PM</);
    assert.match(`${down}${up}${both}`, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(`${down}${up}${both}`, /[↓↑〜]/u);
    assert.doesNotMatch(`${down}${up}${both}`, /preserveAspectRatio="none"/,
      'compact attack masters keep their natural proportions when scaled');
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', label: 'Attack' }), 15);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'tie', label: 'Tie' }), 15);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'brush', label: 'Brush' }), 30);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', direction: 'both', label: 'Both' }), 30);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'attack', palmMute: true, label: 'PM attack' }), 15);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'mute', label: 'Mute' }), 15);
    assert.strictEqual(practiceGuideCompactStrokeVisualWidth({ kind: 'string', label: 'String' }), 15);
    assert.match(renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'down', label: 'Detailed down' }), /viewBox="0 0 20 34"/);
  });

  it('keeps the reference-measure and inset stroke-track coordinates', () => {
    assert.deepStrictEqual(PRACTICE_GUIDE_COMPACT_REFERENCE_LAYOUT, {
      8: { measureWidth: 366, trackInset: 34, trackWidth: 324 },
      16: { measureWidth: 400, trackInset: 32, trackWidth: 324 }
    });
  });

  it('renders the traced compact continuation wave in one 15x47 master at y=21', () => {
    const wave = renderPracticeGuideCompactWavePathSvg('Continuation', 8);
    const narrow = renderPracticeGuideCompactWavePathSvg('Narrow', 16, 'narrow');
    const medium = renderPracticeGuideCompactWavePathSvg('Medium', 16, 'medium');
    const wide = renderPracticeGuideCompactWavePathSvg('Wide', 16, 'wide');
    const tie = renderPracticeGuideCompactStrokeSvgElement({ kind: 'tie', label: 'Tie' });
    const masterPath = 'M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0';
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.wave, masterPath);
    assert.deepStrictEqual(PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS, {
      narrow: { width: 15, path: masterPath },
      medium: { width: 15, path: masterPath },
      wide: { width: 15, path: masterPath }
    });
    assert.match(wave, /viewBox="0 0 15 47"/);
    assert.match(wave, /data-guide-wave-variant="wide"/);
    assert.match(wave, /<path[^>]*data-guide-stroke="wave"/);
    assert.doesNotMatch(wave, /<svg[^>]*data-guide-stroke="wave"/);
    assert.match(wave, /data-guide-wave-width="15\.00"/);
    assert.match(wave, /data-guide-wave-offset-y="21"/);
    assert.match(wave, /d="M0 0 C3\.2 -3\.35 5\.2 -3\.35 7\.5 0 S12\.4 3\.35 15 0"/);
    assert.match(wave, /stroke-width="2\.35" stroke-linecap="round" stroke-linejoin="round"/);
    assert.doesNotMatch(`${wave}${narrow}${medium}${wide}${tie}`, /preserveAspectRatio="none"/,
      'the compact master SVGs keep their natural proportions when scaled');
    for (const [svg, variant, width, viewBox, path] of [
      [narrow, 'narrow', '15.00', '0 0 15 47', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.narrow.path],
      [medium, 'medium', '15.00', '0 0 15 47', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.medium.path],
      [wide, 'wide', '15.00', '0 0 15 47', PRACTICE_GUIDE_COMPACT_WAVE_VARIANTS.wide.path]
    ] as const) {
      assert.match(svg, new RegExp(`viewBox="${viewBox.replaceAll('.', '\\.')}"`));
      assert.match(svg, new RegExp(`data-guide-wave-variant="${variant}"`));
      assert.match(svg, new RegExp(`data-guide-wave-width="${width}"`));
      assert.ok(svg.includes(`d="${path}"`));
      assert.match(svg, /stroke-width="2\.35" stroke-linecap="round" stroke-linejoin="round"/);
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
    assert.match(tie, /viewBox="0 0 15 47"/);
  });

  it('keeps compact brush and mute masters on the path-based geometry contract', () => {
    const brush = renderPracticeGuideCompactStrokeSvgElement({ kind: 'brush', label: 'Brush' });
    const mute = renderPracticeGuideCompactStrokeSvgElement({ kind: 'mute', label: 'Mute' });
    assert.strictEqual(PRACTICE_GUIDE_COMPACT_PATHS.brushCross, 'M5.5 15 L9.5 19 M9.5 15 L5.5 19');
    assert.match(brush, /viewBox="0 0 30 47"/);
    assert.match(brush, /d="M5\.5 15 L9\.5 19 M9\.5 15 L5\.5 19"/);
    assert.match(mute, /viewBox="0 0 15 47"/);
    assert.match(mute, /<circle cx="7\.5" cy="23\.5" r="2\.8"/);
    assert.doesNotMatch(`${brush}${mute}`, /[↓↑〜]/u);
  });
});
