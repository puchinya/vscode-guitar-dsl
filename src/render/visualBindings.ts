import type { ParsedScore, VisualSourceBinding } from '../compiler';
import { escapeXml } from './notation';

export function visualBindingForEvent(
  score: ParsedScore,
  kinds: readonly VisualSourceBinding['kind'][],
  measureIndex: number,
  collection: NonNullable<VisualSourceBinding['eventRange']>['collection'],
  eventIndex: number,
  visualVerse?: number
): string | undefined {
  const matches = (score.visualSourceBindings ?? []).filter(binding => {
    const range = binding.eventRange;
    return kinds.includes(binding.kind)
      && binding.measureIndex === measureIndex
      && range?.collection === collection
      && range.start <= eventIndex && eventIndex < range.end
      && (visualVerse === undefined || binding.visualVerse === visualVerse);
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

export function visualBindingForOrdinal(
  score: ParsedScore,
  kind: VisualSourceBinding['kind'],
  measureIndex: number,
  ordinal: number
): string | undefined {
  const matches = (score.visualSourceBindings ?? [])
    .filter(binding => binding.kind === kind && binding.measureIndex === measureIndex)
    .sort((a, b) => a.startCol - b.startCol);
  return matches.length > ordinal ? matches[ordinal].id : undefined;
}

export function visualBindingAttribute(id: string | undefined): string {
  return id ? ` data-visual-binding="${escapeXml(id)}"` : '';
}
