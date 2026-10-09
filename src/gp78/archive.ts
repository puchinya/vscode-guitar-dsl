import { Unzip, UnzipInflate, UnzipPassThrough, strToU8, zipSync } from 'fflate';
import { Gp78AdapterError, GP78_LIMITS } from './model';
import type { Gp78Archive, Gp78ArchiveEntry } from './model';
import { createGp7PartConfiguration } from './partConfiguration';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const GPIF_PATH = 'Content/score.gpif';
const PART_CONFIGURATION_PATH = 'Content/PartConfiguration';
const utf8 = new TextDecoder('utf-8', { fatal: true });

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Gp78AdapterError('invalidContainer', 'zip', 'ZIP field is outside the archive.');
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Gp78AdapterError('invalidContainer', 'zip', 'ZIP field is outside the archive.');
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeName(bytes: Uint8Array, start: number, length: number, flags: number): string {
  const nameBytes = bytes.subarray(start, start + length);
  if ((flags & 0x0800) === 0 && nameBytes.some(byte => byte > 0x7f)) {
    throw new Gp78AdapterError('invalidContainer', 'zip.name', 'Non-ASCII ZIP names must declare UTF-8 encoding.');
  }
  try {
    return utf8.decode(nameBytes);
  } catch {
    throw new Gp78AdapterError('invalidContainer', 'zip.name', 'ZIP entry name is not valid UTF-8.');
  }
}

function validateName(name: string): string {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Gp78AdapterError('invalidContainer', 'zip.name', 'ZIP entry has an unsafe path.');
  }
  const segments = name.split('/');
  const pathSegments = name.endsWith('/') ? segments.slice(0, -1) : segments;
  if (pathSegments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Gp78AdapterError('invalidContainer', 'zip.name', 'ZIP entry has an unsafe path segment.');
  }
  return name.normalize('NFC');
}

function rejectZip64(extra: Uint8Array, path: string): void {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw new Gp78AdapterError('invalidContainer', path, 'Malformed ZIP extra field.');
    const tag = u16(extra, offset);
    const length = u16(extra, offset + 2);
    offset += 4;
    if (offset + length > extra.length) throw new Gp78AdapterError('invalidContainer', path, 'Malformed ZIP extra field length.');
    if (tag === 0x0001) throw new Gp78AdapterError('invalidContainer', path, 'ZIP64 archives are not supported.');
    offset += length;
  }
}

function findEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minimum; i--) {
    if (u32(bytes, i) !== EOCD) continue;
    const commentLength = u16(bytes, i + 20);
    if (i + 22 + commentLength === bytes.length) return i;
  }
  throw new Gp78AdapterError('invalidContainer', 'zip.eocd', 'ZIP end-of-directory record is missing or malformed.');
}

export function inspectGp78Archive(bytes: Uint8Array): readonly Gp78ArchiveEntry[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22) {
    throw new Gp78AdapterError('invalidContainer', 'zip', 'Input is not a complete ZIP archive.');
  }
  if (bytes.byteLength > GP78_LIMITS.archiveBytes) {
    throw new Gp78AdapterError('resourceLimit', 'zip', `ZIP input exceeds ${GP78_LIMITS.archiveBytes} bytes.`);
  }

  const eocd = findEocd(bytes);
  const disk = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const diskCount = u16(bytes, eocd + 8);
  const count = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Gp78AdapterError('invalidContainer', 'zip.eocd', 'Multi-disk and ZIP64 archives are not supported.');
  }
  if (count > GP78_LIMITS.entryCount) {
    throw new Gp78AdapterError('resourceLimit', 'zip.entries', `ZIP archive exceeds ${GP78_LIMITS.entryCount} entries.`);
  }
  if (centralOffset + centralSize !== eocd || centralOffset > bytes.length || centralSize > bytes.length) {
    throw new Gp78AdapterError('invalidContainer', 'zip.directory', 'ZIP central directory bounds are inconsistent.');
  }

  const entries: Gp78ArchiveEntry[] = [];
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < count; index++) {
    if (u32(bytes, offset) !== CENTRAL) throw new Gp78AdapterError('invalidContainer', 'zip.directory', 'Malformed ZIP central directory entry.');
    const flags = u16(bytes, offset + 8);
    const compression = u16(bytes, offset + 10);
    const crc32 = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const startDisk = u16(bytes, offset + 34);
    const localHeaderOffset = u32(bytes, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || end < offset) throw new Gp78AdapterError('invalidContainer', 'zip.directory', 'ZIP central directory entry exceeds its bounds.');
    const name = decodeName(bytes, offset + 46, nameLength, flags);
    const normalizedName = validateName(name);
    if (names.has(normalizedName)) throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, 'Duplicate ZIP entry name.');
    names.add(normalizedName);
    if (startDisk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, 'Multi-disk and ZIP64 entries are not supported.');
    }
    if ((flags & (0x0001 | 0x0040)) !== 0) throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, 'Encrypted ZIP entries are not supported.');
    if ((flags & ~(0x0002 | 0x0004 | 0x0008 | 0x0800)) !== 0) throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, 'ZIP entry uses unsupported general-purpose flags.');
    if (compression !== 0 && compression !== 8) throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, `Unsupported ZIP compression method ${compression}.`);
    if (compression === 0 && compressedSize !== uncompressedSize) throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}`, 'Stored ZIP entry sizes do not match.');
    rejectZip64(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength), `zip.entries.${name}.extra`);
    totalUncompressed += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > GP78_LIMITS.declaredTotalBytes) {
      throw new Gp78AdapterError('resourceLimit', 'zip.entries', `Declared ZIP expansion exceeds ${GP78_LIMITS.declaredTotalBytes} bytes.`);
    }

    if (localOffsets.has(localHeaderOffset) || localHeaderOffset + 30 > centralOffset || u32(bytes, localHeaderOffset) !== LOCAL) {
      throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}.localHeader`, 'ZIP local header is missing, duplicated, or outside the data area.');
    }
    localOffsets.add(localHeaderOffset);
    const localFlags = u16(bytes, localHeaderOffset + 6);
    const localCompression = u16(bytes, localHeaderOffset + 8);
    const localNameLength = u16(bytes, localHeaderOffset + 26);
    const localExtraLength = u16(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const localName = decodeName(bytes, localHeaderOffset + 30, localNameLength, localFlags);
    if (localName !== name || localFlags !== flags || localCompression !== compression || dataOffset + compressedSize > centralOffset) {
      throw new Gp78AdapterError('invalidContainer', `zip.entries.${name}.localHeader`, 'ZIP local and central directory metadata do not match.');
    }
    rejectZip64(bytes.subarray(localHeaderOffset + 30 + localNameLength, dataOffset), `zip.entries.${name}.localExtra`);
    entries.push(Object.freeze({ name, flags, compression, crc32, compressedSize, uncompressedSize, localHeaderOffset, dataOffset }));
    offset = end;
  }
  if (offset !== eocd) throw new Gp78AdapterError('invalidContainer', 'zip.directory', 'ZIP central directory size does not match its entries.');
  if (entries.filter(entry => entry.name === GPIF_PATH).length !== 1) {
    throw new Gp78AdapterError('invalidContainer', GPIF_PATH, 'Archive must contain exactly one Content/score.gpif entry.');
  }
  const gpif = entries.find(entry => entry.name === GPIF_PATH)!;
  if (gpif.uncompressedSize > GP78_LIMITS.gpifBytes) {
    throw new Gp78AdapterError('resourceLimit', GPIF_PATH, `GPIF exceeds ${GP78_LIMITS.gpifBytes} bytes.`);
  }
  return Object.freeze(entries);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function extractGpif(bytes: Uint8Array): Gp78Archive {
  const entries = inspectGp78Archive(bytes);
  const gpifEntry = entries.find(entry => entry.name === GPIF_PATH)!;
  const partConfigurationEntry = entries.find(entry => entry.name === PART_CONFIGURATION_PATH);
  if (partConfigurationEntry && partConfigurationEntry.uncompressedSize > GP78_LIMITS.partConfigurationBytes) {
    throw new Gp78AdapterError('resourceLimit', PART_CONFIGURATION_PATH, `Part configuration exceeds ${GP78_LIMITS.partConfigurationBytes} bytes.`);
  }
  const targets = new Map<string, { readonly expected: Gp78ArchiveEntry; readonly maxBytes: number; chunks: Uint8Array[]; length: number; seen: boolean }>();
  targets.set(GPIF_PATH, { expected: gpifEntry, maxBytes: GP78_LIMITS.gpifBytes, chunks: [], length: 0, seen: false });
  if (partConfigurationEntry) {
    targets.set(PART_CONFIGURATION_PATH, { expected: partConfigurationEntry, maxBytes: GP78_LIMITS.partConfigurationBytes, chunks: [], length: 0, seen: false });
  }
  let streamError: Gp78AdapterError | undefined;
  const entryByName = new Map(entries.map(entry => [entry.name, entry]));
  const unzip = new Unzip(file => {
    const metadata = entryByName.get(file.name);
    if (!metadata || metadata.compression !== file.compression ||
        (file.size !== undefined && metadata.compressedSize !== file.size) ||
        (file.originalSize !== undefined && metadata.uncompressedSize !== file.originalSize)) {
      streamError = new Gp78AdapterError('invalidContainer', `zip.entries.${file.name}`, 'ZIP local entry does not match the preflighted central directory.');
      return;
    }
    const target = targets.get(file.name);
    if (!target) return;
    if (target.seen) {
      streamError = new Gp78AdapterError('invalidContainer', file.name, 'Duplicate target local entry.');
      return;
    }
    target.seen = true;
    file.ondata = (error, chunk, final) => {
      if (error) {
        streamError = new Gp78AdapterError('invalidContainer', file.name, 'Target ZIP decompression failed.');
        return;
      }
      target.length += chunk.byteLength;
      if (target.length > target.maxBytes || target.length > target.expected.uncompressedSize) {
        streamError = new Gp78AdapterError('resourceLimit', file.name, `ZIP expansion exceeds ${target.maxBytes} bytes or its declared size.`);
        file.terminate();
        return;
      }
      target.chunks.push(chunk.slice());
      if (final && target.length !== target.expected.uncompressedSize) {
        streamError = new Gp78AdapterError('invalidContainer', file.name, 'Expanded size does not match the central directory.');
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  try {
    unzip.push(bytes, true);
  } catch {
    throw new Gp78AdapterError('invalidContainer', 'zip', 'ZIP stream is malformed or cannot be decoded.');
  }
  if (streamError) throw streamError;
  const extracted = new Map<string, Uint8Array>();
  for (const [name, target] of targets) {
    if (!target.seen) {
      if (name === GPIF_PATH) throw new Gp78AdapterError('invalidContainer', GPIF_PATH, 'GPIF local entry was not found.');
      continue;
    }
    if (target.length !== target.expected.uncompressedSize) {
      throw new Gp78AdapterError('invalidContainer', name, 'Expanded size does not match the central directory.');
    }
    const data = new Uint8Array(target.length);
    let cursor = 0;
    for (const chunk of target.chunks) {
      data.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    if (crc32(data) !== target.expected.crc32) throw new Gp78AdapterError('invalidContainer', name, 'CRC-32 does not match the central directory.');
    extracted.set(name, data);
  }
  const gpif = extracted.get(GPIF_PATH)!;
  const partConfiguration = extracted.get(PART_CONFIGURATION_PATH);
  return { entries, gpif, ...(partConfiguration ? { partConfiguration } : {}) };
}

export function createGp7Archive(gpif: Uint8Array, partConfiguration = createGp7PartConfiguration(true)): Uint8Array {
  if (gpif.byteLength > GP78_LIMITS.gpifBytes) throw new Gp78AdapterError('resourceLimit', GPIF_PATH, 'Generated GPIF exceeds the extraction limit.');
  if (partConfiguration.byteLength > GP78_LIMITS.partConfigurationBytes) throw new Gp78AdapterError('resourceLimit', PART_CONFIGURATION_PATH, 'Generated part configuration exceeds the extraction limit.');
  const fixedMtime = new Date('1980-01-01T00:00:00.000Z');
  const archive = zipSync({
    'VERSION': [strToU8('7.0'), { level: 6, mtime: fixedMtime }],
    'Content/score.gpif': [gpif, { level: 6, mtime: fixedMtime }],
    [PART_CONFIGURATION_PATH]: [partConfiguration, { level: 6, mtime: fixedMtime }],
    'meta.json': [strToU8('{}'), { level: 6, mtime: fixedMtime }],
  }, { level: 6, mtime: fixedMtime });
  if (archive.byteLength > GP78_LIMITS.archiveBytes) throw new Gp78AdapterError('resourceLimit', 'zip', 'Generated archive exceeds the input size limit.');
  return archive;
}
