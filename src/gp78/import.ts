import { extractGpif } from './archive';
import { parseGp78Version } from './compatibility';
import { gp78Failure, gp78Success } from './model';
import type { Gp78Inspection, Gp78Result } from './model';
import { appendLoss, emptyLossReport } from '../interchange';
import { gpifToInterchange, summarizeGp78Tracks } from './tracks';
import { parseGpif, xmlChild, xmlChildren, xmlText } from './xml';
import { parsePartConfiguration } from './partConfiguration';

function withGpif<T>(bytes: Uint8Array, action: (root: Record<string, unknown>, gpVersion: string, family: 'gp7' | 'gp8', trackNotations: ReturnType<typeof parsePartConfiguration>, archive: ReturnType<typeof extractGpif>) => T): Gp78Result<T> {
  try {
    const archive = extractGpif(bytes);
    const root = parseGpif(archive.gpif);
    const trackNotations = parsePartConfiguration(archive.partConfiguration);
    const { family, version } = parseGp78Version(xmlText(xmlChild(root, 'GPVersion')));
    return gp78Success(action(root, version, family, trackNotations, archive));
  } catch (error) {
    if (error && typeof error === 'object' && 'gpCode' in error && 'path' in error && error instanceof Error) {
      const typed = error as Error & { gpCode: Parameters<typeof gp78Failure>[0]; path: string };
      const loss = typed.gpCode === 'unsupportedSemantics'
        ? appendLoss(emptyLossReport(), {
            category: 'unsupported',
            code: 'unsupportedSemantics',
            path: typed.path,
            detail: typed.message,
          })
        : emptyLossReport();
      return gp78Failure(typed.gpCode, typed.path, typed.message, loss);
    }
    return gp78Failure('invalidGpif', 'GPIF', error instanceof Error ? error.message : 'GPIF could not be read.');
  }
}

export function inspectGp78(bytes: Uint8Array): Gp78Result<Gp78Inspection> {
  return withGpif(bytes, (root, gpVersion, family) => ({ family, gpVersion, tracks: summarizeGp78Tracks(root) }));
}

export function importGp78(bytes: Uint8Array, selectedTrackId: number): Gp78Result<import('../interchange').InterchangeScore> {
  if (!Number.isSafeInteger(selectedTrackId) || selectedTrackId < 0) return gp78Failure('unsupportedSemantics', 'selectedTrackId', 'Selected track ID must be a non-negative integer.');
  let loss: import('../interchange').InterchangeLossReport | undefined;
  const result = withGpif(bytes, (root, _gpVersion, _family, trackNotations, archive) => {
    const hasAudioAsset = archive.entries.some(entry => /^Content\/Assets\/[^/]+\.(?:mp3|mpga|m4a|f4a|wav|flac|aiff|aif|oga|ogg|opus)$/i.test(entry.name));
    const hasSyncPoint = xmlChildren(xmlChild(xmlChild(root, 'MasterTrack'), 'Automations'), 'Automation')
      .some(automation => xmlText(xmlChild(automation, 'Type')) === 'SyncPoint');
    const imported = gpifToInterchange(root, selectedTrackId, trackNotations, hasAudioAsset || hasSyncPoint);
    loss = imported.loss;
    return imported.score;
  });
  return !loss ? result : { ...result, loss };
}
