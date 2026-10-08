import type { InterchangeError, InterchangeScore } from './model';

function firstDifference(left: unknown, right: unknown, path = ''): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path || '/';
    if (left.length !== right.length) return `${path}/length`;
    for (let index = 0; index < left.length; index++) {
      const difference = firstDifference(left[index], right[index], `${path}/${index}`);
      if (difference) return difference;
    }
    return undefined;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(key => a[key] !== undefined || b[key] !== undefined)
      .sort();
    for (const key of keys) {
      if (!(key in a) || !(key in b)) return `${path}/${key}`;
      const difference = firstDifference(a[key], b[key], `${path}/${key}`);
      if (difference) return difference;
    }
    return undefined;
  }
  return path || '/';
}

/** Private to the interchange implementation; returns the first semantic JSON Pointer difference. */
export function interchangeSemanticMismatch(expected: InterchangeScore, actual: InterchangeScore): InterchangeError | undefined {
  const path = firstDifference(expected, actual);
  return path === undefined ? undefined : {
    code: 'semanticMismatch',
    path,
    detail: 'Represented interchange fields differ after canonical serialization.'
  };
}
