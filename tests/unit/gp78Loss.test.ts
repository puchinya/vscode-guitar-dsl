import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { importGp78, exportGp78, inspectGp78 } from '../../src/gp78';
import { extractGpif } from '../../src/gp78/archive';
import { hasBlockingLoss } from '../../src/interchange';

const ROOT = path.resolve(__dirname, '../..');
const fixture = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F01-standard-4-4.gp')));

describe('GP7/8 loss policy', () => {
  it('reports only the contracted RSE and display losses for a selected single track', () => {
    const inspection = inspectGp78(fixture);
    assert.strictEqual(inspection.ok, true);
    if (!inspection.ok) return;
    const imported = importGp78(fixture, inspection.value.tracks[0].id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    assert.deepStrictEqual(imported.loss.entries.map(entry => entry.policyId), [
      'gp78.omit-rse-settings.v1',
      'gp78.omit-display-layout.v1',
    ]);
    assert.strictEqual(hasBlockingLoss(imported.loss), false);
    const exported = exportGp78(imported.value);
    assert.strictEqual(exported.ok, true, JSON.stringify(exported));
    if (exported.ok) assert.strictEqual(hasBlockingLoss(exported.loss), false);
  });

  it('reports every unselected F07 track after selecting the second guitar', () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F07-multitrack-voice2.gp')));
    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const guitar = inspection.value.tracks.find(track => track.eligible);
    assert.ok(guitar);
    if (!guitar) return;
    const imported = importGp78(bytes, guitar.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const unselected = imported.loss.entries.filter(entry => entry.code === 'unselectedTrack');
    assert.strictEqual(unselected.length, 3);
    assert.deepStrictEqual(unselected.map(entry => entry.path), [
      '/GPIF/Tracks/Track[id=0]',
      '/GPIF/Tracks/Track[id=2]',
      '/GPIF/Tracks/Track[id=3]',
    ]);
    assert.deepStrictEqual(unselected.map(entry => entry.policyId), Array(3).fill('gp78.user-selected-single-track.v1'));
    assert.strictEqual(hasBlockingLoss(imported.loss), false);
  });

  it('reports F08 audio and SyncPoints as an explicitly selected-away track and omits them on export', () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F08-audio-syncpoint.gp')));
    const source = extractGpif(bytes);
    const sourceXml = new TextDecoder().decode(source.gpif);
    assert.ok(source.entries.some(entry => /^Content\/Assets\/[^/]+\.wav$/i.test(entry.name)));
    assert.strictEqual((sourceXml.match(/<Type>SyncPoint<\/Type>/g) ?? []).length, 2);

    const inspection = inspectGp78(bytes);
    assert.strictEqual(inspection.ok, true, JSON.stringify(inspection));
    if (!inspection.ok) return;
    const track = inspection.value.tracks.find(candidate => candidate.eligible);
    assert.ok(track);
    if (!track) return;
    const imported = importGp78(bytes, track.id);
    assert.strictEqual(imported.ok, true, JSON.stringify(imported));
    if (!imported.ok) return;
    const audioLoss = imported.loss.entries.filter(entry => entry.path === '/GP8/AudioTrack');
    assert.deepStrictEqual(audioLoss.map(entry => ({ category: entry.category, code: entry.code, policyId: entry.policyId })), [{
      category: 'droppedByPolicy',
      code: 'unselectedTrack',
      policyId: 'gp78.user-selected-single-track.v1',
    }]);
    assert.strictEqual(hasBlockingLoss(imported.loss), false);

    const exported = exportGp78(imported.value);
    assert.strictEqual(exported.ok, true, JSON.stringify(exported));
    if (!exported.ok) return;
    const output = extractGpif(exported.value);
    assert.ok(!output.entries.some(entry => entry.name.startsWith('Content/Assets/')));
    assert.doesNotMatch(new TextDecoder().decode(output.gpif), /<Type>SyncPoint<\/Type>/);
  });
});
