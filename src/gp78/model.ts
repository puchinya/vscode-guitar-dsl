import { emptyLossReport } from '../interchange';
import type { InterchangeLossReport } from '../interchange';

export type Gp78ErrorCode =
  | 'invalidContainer'
  | 'unsupportedVersion'
  | 'invalidGpif'
  | 'unsupportedSemantics'
  | 'invalidIr'
  | 'unrepresentableValue'
  | 'roundTripMismatch'
  | 'resourceLimit';

export interface Gp78Error {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}

export type Gp78Result<T> =
  | { readonly ok: true; readonly value: T; readonly loss: InterchangeLossReport }
  | {
      readonly ok: false;
      readonly code: Gp78ErrorCode;
      readonly errors: readonly Gp78Error[];
      readonly loss: InterchangeLossReport;
    };

export interface Gp78TrackSummary {
  readonly id: number;
  readonly order: number;
  readonly name: string;
  readonly stringCount: number | null;
  readonly staffCount: number;
  readonly eligible: boolean;
  readonly reasonCode?: string;
}

export interface Gp78Inspection {
  readonly family: 'gp7' | 'gp8';
  readonly gpVersion: string;
  readonly tracks: readonly Gp78TrackSummary[];
}

export interface Gp78ArchiveEntry {
  readonly name: string;
  readonly flags: number;
  readonly compression: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly dataOffset: number;
}

export interface Gp78Archive {
  readonly entries: readonly Gp78ArchiveEntry[];
  readonly gpif: Uint8Array;
  readonly partConfiguration?: Uint8Array;
}

export const GP78_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  entryCount: 4096,
  declaredTotalBytes: 128 * 1024 * 1024,
  gpifBytes: 32 * 1024 * 1024,
  partConfigurationBytes: 1 * 1024 * 1024,
  xmlDepth: 128,
  xmlNodes: 1_000_000,
});

export function gp78Success<T>(value: T, loss: InterchangeLossReport = emptyLossReport()): Gp78Result<T> {
  return { ok: true, value, loss };
}

export function gp78Failure<T = never>(
  code: Gp78ErrorCode,
  path: string,
  detail: string,
  loss: InterchangeLossReport = emptyLossReport(),
): Gp78Result<T> {
  return { ok: false, code, errors: [{ code, path, detail }], loss };
}

export class Gp78AdapterError extends Error {
  constructor(
    readonly gpCode: Gp78ErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'Gp78AdapterError';
  }
}
