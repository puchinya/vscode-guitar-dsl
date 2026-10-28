import { parseGuitarDsl, type ParsedScore, type ScoreDiagnostic } from '../compiler';

function errorKey(diagnostic: ScoreDiagnostic): string {
  const args = diagnostic.args
    ? Object.keys(diagnostic.args).sort().map(key => `${key}=${String(diagnostic.args?.[key])}`).join('&')
    : '';
  return `${diagnostic.code}:${diagnostic.line}:${args}`;
}

/** Rejects a proposed source when parsing introduces a new error category at a source line. */
export function hasNoNewErrors(before: ParsedScore, after: ParsedScore): boolean {
  const counts = (score: ParsedScore) => {
    const result = new Map<string, number>();
    for (const diagnostic of score.diagnostics) {
      if (diagnostic.severity !== 'error') continue;
      const key = errorKey(diagnostic);
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const oldErrors = counts(before);
  const newErrors = counts(after);
  for (const [key, count] of newErrors) {
    if (count > (oldErrors.get(key) ?? 0)) return false;
  }
  return true;
}

export function validateCandidateSource(source: string, candidate: string, before = parseGuitarDsl(source)):
  { readonly ok: true; readonly score: ParsedScore } | { readonly ok: false; readonly code: 'diagnosticRegression' } {
  const score = parseGuitarDsl(candidate);
  return hasNoNewErrors(before, score) ? { ok: true, score } : { ok: false, code: 'diagnosticRegression' };
}
