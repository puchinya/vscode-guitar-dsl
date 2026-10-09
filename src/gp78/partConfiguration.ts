import { Gp78AdapterError, GP78_LIMITS } from './model';

const PATH = 'Content/PartConfiguration';
const MAX_SCORE_VIEWS = 256;
const MAX_TRACK_VIEW_GROUPS = 256;

export interface Gp78TrackNotation {
  readonly standard: boolean;
  readonly tablature: boolean;
  readonly slash: boolean;
  readonly numbered: boolean;
}

function invalid(detail: string): never {
  throw new Gp78AdapterError('invalidContainer', PATH, detail);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return invalid('Part configuration ended inside a 32-bit field.');
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

export function parsePartConfiguration(bytes: Uint8Array | undefined): readonly Gp78TrackNotation[] | undefined {
  if (!bytes) return undefined;
  if (bytes.byteLength > GP78_LIMITS.partConfigurationBytes) {
    throw new Gp78AdapterError('resourceLimit', PATH, `Part configuration exceeds ${GP78_LIMITS.partConfigurationBytes} bytes.`);
  }
  let cursor = 0;
  const scoreViewCount = readUInt32(bytes, cursor);
  cursor += 4;
  if (scoreViewCount < 1 || scoreViewCount > MAX_SCORE_VIEWS) return invalid(`Invalid score view count ${scoreViewCount}.`);

  const views: Gp78TrackNotation[][] = [];
  for (let viewIndex = 0; viewIndex < scoreViewCount; viewIndex++) {
    if (cursor >= bytes.length) return invalid('Part configuration ended before a score view.');
    const multiRest = bytes[cursor++];
    if (multiRest !== 0 && multiRest !== 1) return invalid('Score view multi-rest flag must be zero or one.');
    const trackCount = readUInt32(bytes, cursor);
    cursor += 4;
    if (trackCount > MAX_TRACK_VIEW_GROUPS) return invalid(`Invalid track view count ${trackCount}.`);
    const tracks: Gp78TrackNotation[] = [];
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
      if (cursor >= bytes.length) return invalid('Part configuration ended inside a track view group.');
      const flags = bytes[cursor++];
      if ((flags & 0xf0) !== 0) return invalid(`Unsupported track notation flags 0x${flags.toString(16)}.`);
      const normalized = flags === 0 ? 1 : flags;
      tracks.push(Object.freeze({
        standard: (normalized & 0x01) !== 0,
        tablature: (normalized & 0x02) !== 0,
        slash: (normalized & 0x04) !== 0,
        numbered: (normalized & 0x08) !== 0,
      }));
    }
    views.push(tracks);
  }

  const remaining = bytes.length - cursor;
  if (remaining !== 0 && remaining !== 4) return invalid('Part configuration has an unexpected trailing payload.');
  if (remaining === 4) {
    const activeView = readUInt32(bytes, cursor);
    if (activeView >= scoreViewCount) return invalid(`Active score view ${activeView} is out of range.`);
  }
  return Object.freeze(views[0]);
}

export function createGp7PartConfiguration(showTablature: boolean): Uint8Array {
  const flags = 0x01 | (showTablature ? 0x02 : 0x00);
  return Uint8Array.from([
    0, 0, 0, 2,
    0, 0, 0, 0, 1, flags,
    0, 0, 0, 0, 1, flags,
    0, 0, 0, 1,
  ]);
}
