// CodeLens, command and QuickPick for applying accompaniment patterns (spec extension.md §3.10), plus the
// VS Code edit step shared with the AI accompaniment tool. Every change goes through the deterministic
// accompaniment engine (src/accompaniment.ts); this module only drives the UI and applies one edit.
import * as vscode from 'vscode';
import {
  AccompanimentOptions,
  AccompanimentPlanResult,
  AccompanimentRequest,
  AccompanimentSection,
  accompanimentSections,
  availableFamilies,
  currentPatternShortcuts,
  effectiveFeels,
  planAccompanimentTransform,
  presetsForFamily,
  uniformMeter
} from './accompaniment';
import { MeasureData, classifySourceLine, continuesMelodyContext, measureCellsOf, parseGuitarDsl } from './compiler';
import { scanArrangementBlockLines } from './arrangement';
import { AccompanimentUiMessages, SupportedLocale, getAccompanimentUiMessages } from './i18n';
import { TimeSignature, formatTimeSignature, sameTimeSignature } from './scoreEvents';
import { AccompanimentFamily, ScoreFeel, StrummingPatternPreset, USAGE_GROUP_ORDER } from './strummingPatterns';

export const APPLY_STRUMMING_PATTERN_COMMAND = 'guitardsl.applyStrummingPattern';

/** Identity of the section a CodeLens was created for; all three must still match when the command runs. */
export interface StrummingCodeLensTarget {
  sectionIndex: number;
  sectionName: string;
  labelLine: number;
}

const isCodeLensTarget = (v: unknown): v is StrummingCodeLensTarget =>
  !!v && typeof v === 'object' && typeof (v as StrummingCodeLensTarget).sectionIndex === 'number' && typeof (v as StrummingCodeLensTarget).labelLine === 'number';

export class StrummingCodeLensProvider implements vscode.CodeLensProvider {
  private readonly msgs: AccompanimentUiMessages;

  constructor(locale: SupportedLocale) {
    this.msgs = getAccompanimentUiMessages(locale);
  }

  /**
   * One lens per section label, from a line scan (no full parse, so typing stays cheap). Lines are classified
   * with the parser's own `classifySourceLine`, so the index matches `accompanimentSections`: measures before
   * the first label form section 0 and a label only counts when a measure follows it. The lens passes the
   * section's identity (index, name, label line); the command re-parses and refuses a stale identity.
   */
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const arrangementMask = scanArrangementBlockLines(document.getText().split(/\r?\n/)).maskedLines;
    let count = 0;
    let pending: { line: number; name: string } | undefined;
    let afterMelody = false;
    for (let i = 0; i < document.lineCount; i++) {
      const raw = document.lineAt(i).text;
      const kind = classifySourceLine(raw, afterMelody, arrangementMask[i]);
      afterMelody = continuesMelodyContext(kind);
      if (kind === 'section') {
        pending = { line: i, name: raw.trim().slice(1, -1) };
        continue;
      }
      if (kind !== 'measure' || measureCellsOf(raw).length === 0) continue;
      if (pending) {
        const target: StrummingCodeLensTarget = { sectionIndex: count, sectionName: pending.name, labelLine: pending.line };
        lenses.push(
          new vscode.CodeLens(new vscode.Range(pending.line, 0, pending.line, document.lineAt(pending.line).text.length), {
            title: this.msgs.lensTitle(pending.name),
            command: APPLY_STRUMMING_PATTERN_COMMAND,
            arguments: [document.uri, target]
          })
        );
        count++;
        pending = undefined;
      } else if (count === 0) {
        count = 1; // unnamed leading section
      }
    }
    return lenses;
  }
}

/** Replaces only the changed middle of the document, as one undoable WorkspaceEdit. */
async function replaceDocumentText(doc: vscode.TextDocument, text: string, next: string): Promise<boolean> {
  let start = 0;
  while (start < text.length && start < next.length && text[start] === next[start]) start++;
  let endOld = text.length;
  let endNew = next.length;
  while (endOld > start && endNew > start && text[endOld - 1] === next[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(endOld)), next.slice(start, endNew));
  return vscode.workspace.applyEdit(edit);
}

export type AccompanimentApplyResult =
  | Omit<Extract<AccompanimentPlanResult, { ok: true }>, 'text'>
  | { ok: false; code: string; detail?: string };

/**
 * Applies an accompaniment request to the document at `uri`: re-reads the current source, plans every
 * change with the engine (never from cached or caller-provided text) and applies one undoable edit.
 */
export async function applyAccompanimentTransform(
  uri: vscode.Uri,
  request: AccompanimentRequest,
  options?: AccompanimentOptions
): Promise<AccompanimentApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const plan = planAccompanimentTransform(text, request, options);
  if (!plan.ok) return plan;
  const { text: next, ...summary } = plan;
  if (next === text) return summary;
  return (await replaceDocumentText(doc, text, next)) ? summary : { ok: false, code: 'editRejected' };
}

interface ScopeItem extends vscode.QuickPickItem {
  section?: AccompanimentSection;
}

interface CategoryItem extends vscode.QuickPickItem {
  presets?: StrummingPatternPreset[];
  groupBy?: 'usageGroup' | 'family';
}

interface PatternItem extends vscode.QuickPickItem {
  preset?: StrummingPatternPreset;
}

const meterText = (ts: TimeSignature) => formatTimeSignature(ts);
const separator = (label: string): vscode.QuickPickItem => ({ label, kind: vscode.QuickPickItemKind.Separator });

/** Step 1 (spec §3.10): meter / family categories for the target meter; 4/4 splits by family. */
function categoryItems(ts: TimeSignature, feels: ScoreFeel[], shortcuts: StrummingPatternPreset[], msgs: AccompanimentUiMessages): CategoryItem[] {
  const items: CategoryItem[] = [];
  if (shortcuts.length > 0) items.push({ label: msgs.currentShortcut, detail: msgs.currentShortcutDetail, presets: shortcuts, groupBy: 'usageGroup' });
  const meter = meterText(ts);
  const families = availableFamilies(ts, feels);
  if (meter === '4/4') {
    for (const f of families) items.push({ label: `${meter} — ${msgs.familyLabels[f]}`, presets: presetsForFamily(f, ts, feels), groupBy: 'usageGroup' });
  } else if (families.length > 0) {
    items.push({ label: msgs.meterCategory(meter), presets: families.flatMap(f => presetsForFamily(f, ts, feels)), groupBy: 'family' });
  }
  return items;
}

function levels(p: StrummingPatternPreset, msgs: AccompanimentUiMessages): string {
  const l = msgs.levelLabels;
  const parts = [
    msgs.usageGroupLabels[p.usageGroup],
    ...(p.feelCompatibility === 'any' ? [] : [msgs.requiresFeel(p.feelCompatibility.join('/'))]),
    `${l[p.energy]} / ${l[p.density]}`,
    `sync: ${l[p.syncopation]}${p.syncopationKinds.length ? ` (${p.syncopationKinds.join('+')})` : ''}`,
    `emphasis: ${l[p.emphasis]}`,
    l[p.difficulty],
    p.tags.join(', ')
  ];
  return parts.join(' · ');
}

/** Step 2: the category's presets with usage-group (4/4) or family (other meters) separators. */
function patternItems(category: CategoryItem, isJa: boolean, msgs: AccompanimentUiMessages): PatternItem[] {
  const presets = category.presets ?? [];
  const items: PatternItem[] = [];
  const keys = category.groupBy === 'family' ? [...new Set(presets.map(p => p.family))] : USAGE_GROUP_ORDER.filter(g => presets.some(p => p.usageGroup === g));
  for (const key of keys) {
    const group = presets.filter(p => (category.groupBy === 'family' ? p.family === key : p.usageGroup === key));
    items.push(separator(category.groupBy === 'family' ? msgs.familyLabels[key as AccompanimentFamily] : msgs.usageGroupLabels[key]));
    for (const preset of group) {
      items.push({
        label: `$(music) ${isJa ? preset.nameJa : preset.nameEn}`,
        description: `[${preset.pattern}]`,
        detail: `${isJa ? preset.descriptionJa : preset.descriptionEn} — ${levels(preset, msgs)}`,
        preset
      });
    }
  }
  return items;
}

/**
 * Command flow: scope (entire score or one section) -> category -> pattern. Cancelling the pattern list
 * returns to the category list; cancelling the category or scope list changes nothing.
 */
export async function promptAndApplyStrummingPattern(
  document: vscode.TextDocument,
  section?: string | number | StrummingCodeLensTarget,
  locale?: SupportedLocale
): Promise<void> {
  const isJa = locale === 'ja';
  const msgs = getAccompanimentUiMessages(locale ?? 'en');
  const text = document.getText();
  const score = parseGuitarDsl(text);
  const sections = accompanimentSections(score, text);
  if (sections.length === 0) {
    vscode.window.showInformationMessage(msgs.noMeasures);
    return;
  }
  const sectionLabel = (s: AccompanimentSection) => `[${s.name ?? msgs.unnamedSection}]`;

  let target: AccompanimentSection | undefined;
  if (isCodeLensTarget(section)) {
    // Never guess another (e.g. same-name) section: a changed identity means the CodeLens is stale.
    const candidate = sections[section.sectionIndex];
    if (!candidate || candidate.name !== section.sectionName || candidate.labelLine !== section.labelLine) {
      vscode.window.showWarningMessage(msgs.staleSection);
      return;
    }
    target = candidate;
  } else if (typeof section === 'number') {
    target = sections[section];
  }
  else if (typeof section === 'string') target = sections.find(s => s.name === section);
  if (section !== undefined && !target) {
    vscode.window.showInformationMessage(msgs.noMeasures);
    return;
  }
  if (!target) {
    const scopeItems: ScopeItem[] = [
      { label: msgs.scopeEntireScore, description: msgs.scopeEntireScoreDetail },
      ...sections.map(s => ({ label: `$(symbol-class) ${sectionLabel(s)}`, description: msgs.scopeSection, section: s }))
    ];
    const chosen = await vscode.window.showQuickPick(scopeItems, { placeHolder: msgs.scopePlaceholder });
    if (!chosen) return;
    target = chosen.section;
  }

  const measures: MeasureData[] = target ? target.measures : score.measures;
  const ts = uniformMeter(measures);
  if (!ts) {
    const mixed = measures.some(m => !sameTimeSignature(m.context.timeSignature, measures[0].context.timeSignature));
    vscode.window.showInformationMessage(mixed ? msgs.mixedMeter : msgs.noMeasures);
    return;
  }
  const feels = effectiveFeels(measures);
  const shortcuts = target ? currentPatternShortcuts(target, score.measures) : [];
  const categories = categoryItems(ts, feels, shortcuts, msgs);
  if (categories.length === 0) {
    vscode.window.showInformationMessage(msgs.noPresets(meterText(ts)));
    return;
  }
  const targetLabel = target ? sectionLabel(target) : msgs.entireScore;

  let preset: StrummingPatternPreset | undefined;
  while (!preset) {
    const category = await vscode.window.showQuickPick(categories, { placeHolder: msgs.categoryPlaceholder(targetLabel) });
    if (!category) return;
    const pick = await vscode.window.showQuickPick(patternItems(category, isJa, msgs), {
      placeHolder: msgs.patternPlaceholder(targetLabel, category.label),
      matchOnDescription: true,
      matchOnDetail: true
    });
    preset = pick?.preset;
  }

  const plans = (target ? [target] : sections).map(s => ({ sectionIndex: s.sectionIndex, mode: 'preset' as const, presetId: (preset as StrummingPatternPreset).id }));
  // The manual choice is applied exactly: no automatic phrase-end variation.
  const result = await applyAccompanimentTransform(document.uri, { plans }, { phraseVariation: false });
  if (!result.ok) {
    vscode.window.showWarningMessage(msgs.failed(result.detail ?? result.code));
    return;
  }
  if (!result.changed) {
    vscode.window.showInformationMessage(msgs.noChange);
    return;
  }
  vscode.window.showInformationMessage(msgs.applied(targetLabel, isJa ? preset.nameJa : preset.nameEn));
}
