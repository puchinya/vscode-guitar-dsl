import type { InterchangeLoss, InterchangeLossReport } from './model';

const CATEGORIES = new Set(['unsupported', 'approximated', 'droppedByPolicy', 'inferred']);

export function emptyLossReport(): InterchangeLossReport {
  return { schemaVersion: 1, entries: [] };
}

function validateEntry(entry: InterchangeLoss): void {
  if (!entry || !CATEGORIES.has(entry.category)) {
    throw new TypeError('loss category must be unsupported, approximated, droppedByPolicy, or inferred');
  }
  if (Object.keys(entry).some(key => !['category', 'code', 'path', 'detail', 'policyId'].includes(key))) {
    throw new TypeError('loss entry contains a field outside schema version 1');
  }
  if (typeof entry.code !== 'string' || !entry.code.trim()) {
    throw new TypeError('loss code is required');
  }
  if (typeof entry.path !== 'string' || !entry.path.trim()) {
    throw new TypeError('loss path is required');
  }
  if (typeof entry.detail !== 'string' || !entry.detail.trim()) {
    throw new TypeError('loss detail is required');
  }
  if (entry.category !== 'unsupported' && (typeof entry.policyId !== 'string' || !entry.policyId.trim())) {
    throw new TypeError(`loss category ${entry.category} requires a policyId`);
  }
  if (entry.policyId !== undefined && (typeof entry.policyId !== 'string' || !entry.policyId.trim())) {
    throw new TypeError('loss policyId must be a nonempty string when supplied');
  }
}

function validateReport(report: InterchangeLossReport): void {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.entries)) {
    throw new TypeError('loss report must use schemaVersion 1 and contain an entries array');
  }
  if (Object.keys(report).some(key => !['schemaVersion', 'entries'].includes(key))) {
    throw new TypeError('loss report contains a field outside schema version 1');
  }
}

function identity(entry: InterchangeLoss): string {
  return JSON.stringify([entry.category, entry.code, entry.path, entry.policyId ?? null]);
}

function copyEntry(entry: InterchangeLoss): InterchangeLoss {
  validateEntry(entry);
  return {
    category: entry.category,
    code: entry.code,
    path: entry.path,
    detail: entry.detail,
    ...(entry.policyId !== undefined ? { policyId: entry.policyId } : {})
  };
}

export function appendLoss(report: InterchangeLossReport, entry: InterchangeLoss): InterchangeLossReport {
  validateReport(report);
  const clonedEntries = report.entries.map(copyEntry);
  const clonedEntry = copyEntry(entry);
  if (clonedEntries.some(existing => identity(existing) === identity(clonedEntry))) {
    return { schemaVersion: 1, entries: clonedEntries };
  }
  return { schemaVersion: 1, entries: [...clonedEntries, clonedEntry] };
}

export function mergeLossReports(...reports: readonly InterchangeLossReport[]): InterchangeLossReport {
  let merged = emptyLossReport();
  for (const report of reports) {
    validateReport(report);
    for (const entry of report.entries) merged = appendLoss(merged, entry);
  }
  return merged;
}

export function hasBlockingLoss(report: InterchangeLossReport): boolean {
  validateReport(report);
  let blocking = false;
  for (const entry of report.entries) {
    validateEntry(entry);
    if (entry.category === 'unsupported') blocking = true;
  }
  return blocking;
}
