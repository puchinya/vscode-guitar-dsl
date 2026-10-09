import { Gp78AdapterError } from './model';

export type Gp78Family = 'gp7' | 'gp8';

export function parseGp78Version(value: unknown): { readonly family: Gp78Family; readonly version: string } {
  if (typeof value !== 'string') throw new Gp78AdapterError('invalidGpif', 'GPIF/GPVersion', 'GPVersion is missing.');
  const version = value.trim();
  const match = /^(7|8)\.(\d+)(?:\.(\d+))?(?:[-+][A-Za-z0-9.-]+)?$/.exec(version);
  if (!match) {
    if (/^(?:[0-9]+)(?:\.|$)/.test(version)) {
      throw new Gp78AdapterError('unsupportedVersion', 'GPIF/GPVersion', `GPIF version ${version || '(empty)'} is outside the supported GP7/GP8 range.`);
    }
    throw new Gp78AdapterError('invalidGpif', 'GPIF/GPVersion', 'GPVersion is malformed.');
  }
  return { family: match[1] === '7' ? 'gp7' : 'gp8', version };
}
