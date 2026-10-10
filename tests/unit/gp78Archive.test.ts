import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';
import { extractGpif, inspectGp78Archive } from '../../src/gp78/archive';
import { GP78_LIMITS, Gp78AdapterError } from '../../src/gp78/model';
import { parseGpif } from '../../src/gp78/xml';

const ROOT = path.resolve(__dirname, '../..');
const source = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tests/fixtures/gp78/F01-standard-4-4.gp')));

describe('GP7/8 archive and XML safety', () => {
  it('preflights the archive and extracts only the GPIF entry with matching size and CRC', () => {
    const archive = extractGpif(source);
    assert.ok(archive.gpif.byteLength > 0);
    assert.ok(archive.entries.some(entry => entry.name === 'Content/score.gpif'));
    assert.strictEqual(inspectGp78Archive(source).length, archive.entries.length);
  });

  it('rejects traversal paths before extraction', () => {
    const gpif = extractGpif(source).gpif;
    const malicious = zipSync({ 'Content/score.gpif': gpif, '../outside.txt': strToU8('unsafe') });
    assert.throws(() => inspectGp78Archive(malicious), (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'invalidContainer');
  });

  it('rejects a GPIF entry whose declared uncompressed size exceeds the hard limit', () => {
    const mutated = new Uint8Array(source);
    let centralOffset = -1;
    for (let i = 0; i + 46 < mutated.length; i++) {
      if (mutated[i] === 0x50 && mutated[i + 1] === 0x4b && mutated[i + 2] === 0x01 && mutated[i + 3] === 0x02) {
        const nameLength = mutated[i + 28] | (mutated[i + 29] << 8);
        const name = Buffer.from(mutated.subarray(i + 46, i + 46 + nameLength)).toString('utf8');
        if (name === 'Content/score.gpif') { centralOffset = i; break; }
      }
    }
    assert.notStrictEqual(centralOffset, -1);
    const declared = GP78_LIMITS.gpifBytes + 1;
    mutated[centralOffset + 24] = declared & 0xff;
    mutated[centralOffset + 25] = (declared >>> 8) & 0xff;
    mutated[centralOffset + 26] = (declared >>> 16) & 0xff;
    mutated[centralOffset + 27] = (declared >>> 24) & 0xff;
    assert.throws(() => inspectGp78Archive(mutated), (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'resourceLimit');
  });

  it('rejects DTDs, entities, and excessive XML nesting before tree construction', () => {
    assert.throws(() => parseGpif(new TextEncoder().encode('<!DOCTYPE GPIF [<!ENTITY x "x">]><GPIF/>')),
      (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'invalidGpif');
    assert.throws(() => parseGpif(new TextEncoder().encode('<GPIF>&custom;</GPIF>')),
      (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'invalidGpif');
    const deep = `<GPIF>${'<x>'.repeat(GP78_LIMITS.xmlDepth)}${'</x>'.repeat(GP78_LIMITS.xmlDepth)}</GPIF>`;
    assert.throws(() => parseGpif(new TextEncoder().encode(deep)),
      (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'resourceLimit');
  });

  it('rejects corrupted compressed data without returning partial GPIF bytes', () => {
    const mutated = new Uint8Array(source);
    const entry = inspectGp78Archive(mutated).find(value => value.name === 'Content/score.gpif')!;
    mutated[entry.dataOffset] ^= 0xff;
    assert.throws(() => extractGpif(mutated), (error: unknown) => error instanceof Gp78AdapterError && error.gpCode === 'invalidContainer');
  });
});
