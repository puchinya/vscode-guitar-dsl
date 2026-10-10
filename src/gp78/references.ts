import { Gp78AdapterError } from './model';
import { xmlAttr, xmlList, xmlText } from './xml';

export function parseGpifId(value: unknown, path: string): number {
  const raw = typeof value === 'string' ? value : xmlAttr(value, 'id');
  if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Gp78AdapterError('invalidGpif', path, 'GPIF ID must be a non-negative decimal integer.');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Gp78AdapterError('invalidGpif', path, 'GPIF ID exceeds the safe integer range.');
  return parsed;
}

export function indexGpifIds<T>(values: unknown, path: string): ReadonlyMap<number, T> {
  const result = new Map<number, T>();
  for (const value of xmlList(values)) {
    const id = parseGpifId(value, `${path}.id`);
    if (result.has(id)) throw new Gp78AdapterError('invalidGpif', `${path}[id=${id}]`, 'Duplicate GPIF ID.');
    result.set(id, value as T);
  }
  return result;
}

export function resolveGpifRef<T>(
  reference: unknown,
  index: ReadonlyMap<number, T>,
  path: string,
  attribute = 'ref',
): T {
  const raw = xmlAttr(reference, attribute) ?? xmlText(reference);
  const id = parseGpifId(raw, path);
  const value = index.get(id);
  if (value === undefined) throw new Gp78AdapterError('invalidGpif', path, `GPIF reference ${id} is unresolved.`);
  return value;
}

export function parseGpifIdList(value: unknown, path: string, allowMissing = false): readonly (number | null)[] {
  const raw = xmlText(value);
  if (!raw) {
    if (allowMissing) return [];
    throw new Gp78AdapterError('invalidGpif', path, 'Expected a whitespace-separated GPIF ID list.');
  }
  return raw.split(/\s+/).map((token, index) => {
    if (allowMissing && token === '-1') return null;
    if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Gp78AdapterError('invalidGpif', `${path}[${index}]`, 'GPIF ID list contains an invalid reference.');
    const id = Number(token);
    if (!Number.isSafeInteger(id)) throw new Gp78AdapterError('invalidGpif', `${path}[${index}]`, 'GPIF reference exceeds the safe integer range.');
    return id;
  });
}
