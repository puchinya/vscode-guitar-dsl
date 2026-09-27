// Language model tools for VS Code Agent / Chat (spec extension.md §8, design architecture.md §2.18).
// Thin adapters over the existing deterministic GuitarDSL core: the parser, capo inference and the
// apply*Transform helpers. This module owns input checks, JSON results and the per-document mutation
// guard only. It holds no music-domain rules and never calls a language model.

import * as path from 'path';
import * as vscode from 'vscode';
import { BarrePolicy, isBarrePolicy } from '../beginnerMode';
import { inferCapoForDsl, isValidCapo } from '../capo';
import { parseGuitarDsl } from '../compiler';
import { isGuitarDslDocument, resolveGuitarDslDocument } from '../documentResolver';
import { AiToolMessages, SupportedLocale, getAiToolMessages } from '../i18n';
import { applyBeginnerTransform, applyCapoTransform, applyTransposeTransform } from '../scoreSettingsEditor';
import { CapoMode, isValidSemitones } from '../transpose';

export const RESULT_SCHEMA_VERSION = 1;

export const VALIDATE_TOOL = 'guitardsl_validate_dsl';
export const PLAYABILITY_TOOL = 'guitardsl_analyze_playability';
export const APPLY_CAPO_TOOL = 'guitardsl_apply_capo';
export const APPLY_BEGINNER_TOOL = 'guitardsl_apply_beginner_mode';
export const APPLY_TRANSPOSE_TOOL = 'guitardsl_apply_transpose';

export interface DocumentToolInput {
  /** Absolute file path; omitted = the command resolution order (spec extension §3.1). */
  path?: string;
}
export type ValidateInput = DocumentToolInput;
export type PlayabilityInput = DocumentToolInput;
export interface ApplyCapoInput extends DocumentToolInput {
  targetCapo: number;
}
export interface ApplyBeginnerInput extends DocumentToolInput {
  barrePolicy: BarrePolicy;
  /** Omitted = auto (the recommended capo of the current source). */
  targetCapo?: number;
}
export interface ApplyTransposeInput extends DocumentToolInput {
  semitones: number;
  capoMode: 'keep' | 'recommended' | 'explicit';
  /** Required only when capoMode is 'explicit'. */
  capo?: number;
}

/** Fail-fast, in-process guard: at most one AI mutation per document URI; never queues. */
export class MutationGuard {
  private readonly held = new Set<string>();
  tryAcquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }
  release(key: string): void {
    this.held.delete(key);
  }
  isHeld(key: string): boolean {
    return this.held.has(key);
  }
}

/** Dependencies of the tools; tests replace the apply helpers and the guard. */
export interface AiToolDeps {
  locale: SupportedLocale;
  getLastDoc: () => vscode.TextDocument | undefined;
  applyCapo: typeof applyCapoTransform;
  applyBeginner: typeof applyBeginnerTransform;
  applyTranspose: typeof applyTransposeTransform;
  guard: MutationGuard;
}

export interface GuitarDslAiTools {
  [VALIDATE_TOOL]: vscode.LanguageModelTool<ValidateInput>;
  [PLAYABILITY_TOOL]: vscode.LanguageModelTool<PlayabilityInput>;
  [APPLY_CAPO_TOOL]: vscode.LanguageModelTool<ApplyCapoInput>;
  [APPLY_BEGINNER_TOOL]: vscode.LanguageModelTool<ApplyBeginnerInput>;
  [APPLY_TRANSPOSE_TOOL]: vscode.LanguageModelTool<ApplyTransposeInput>;
}

type Payload = Record<string, unknown>;

function toolResult(payload: Payload): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify({ schemaVersion: RESULT_SCHEMA_VERSION, ...payload }))
  ]);
}

function failure(code: string, detail?: string, extra: Payload = {}): vscode.LanguageModelToolResult {
  return toolResult({ ok: false, ...extra, code, ...(detail === undefined ? {} : { detail }) });
}

function documentInfo(doc: vscode.TextDocument): Payload {
  return doc.uri.scheme === 'file' ? { uri: doc.uri.toString(), path: doc.uri.fsPath } : { uri: doc.uri.toString() };
}

function errorCount(text: string): number {
  return parseGuitarDsl(text).diagnostics.filter(d => d.severity === 'error').length;
}

/** Checks the common `path` input; returns a problem description or undefined. */
function pathProblem(input: DocumentToolInput): string | undefined {
  if (input.path === undefined) return undefined;
  if (typeof input.path !== 'string' || !path.isAbsolute(input.path)) return 'path must be an absolute file path';
  return undefined;
}

/** Tool input as sent by VS Code; a missing object is treated as empty and rejected by the input checks. */
const inputOf = <T>(options: { input: T }): T => (options.input ?? {}) as T;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function capoInputProblem(input: ApplyCapoInput): string | undefined {
  return pathProblem(input) ?? (isInt(input.targetCapo) && isValidCapo(input.targetCapo) ? undefined : 'targetCapo must be an integer 0..12');
}

export function beginnerInputProblem(input: ApplyBeginnerInput): string | undefined {
  const problem = pathProblem(input);
  if (problem) return problem;
  if (!isBarrePolicy(input.barrePolicy)) return "barrePolicy must be 'allow' or 'forbid'";
  if (input.targetCapo !== undefined && !(isInt(input.targetCapo) && isValidCapo(input.targetCapo))) {
    return 'targetCapo must be an integer 0..12 or omitted (auto)';
  }
  return undefined;
}

export function transposeInputProblem(input: ApplyTransposeInput): string | undefined {
  const problem = pathProblem(input);
  if (problem) return problem;
  if (!(isInt(input.semitones) && isValidSemitones(input.semitones))) return 'semitones must be an integer -11..11';
  if (input.capoMode === 'explicit') {
    return isInt(input.capo) && isValidCapo(input.capo) ? undefined : "capo must be an integer 0..12 when capoMode is 'explicit'";
  }
  return input.capoMode === 'keep' || input.capoMode === 'recommended' ? undefined : "capoMode must be 'keep', 'recommended' or 'explicit'";
}

function toCapoMode(input: ApplyTransposeInput): CapoMode {
  if (input.capoMode === 'explicit') return { kind: 'explicit', capo: input.capo as number };
  return { kind: input.capoMode };
}

type Resolution = { ok: true; doc: vscode.TextDocument } | { ok: false; detail: string };

async function resolveTarget(input: DocumentToolInput, deps: AiToolDeps): Promise<Resolution> {
  if (input.path !== undefined) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(input.path));
      if (isGuitarDslDocument(doc)) return { ok: true, doc };
    } catch {
      // Reported below.
    }
    return { ok: false, detail: `not a GuitarDSL document: ${input.path}` };
  }
  const doc = await resolveGuitarDslDocument(undefined, deps.getLastDoc());
  return doc ? { ok: true, doc } : { ok: false, detail: 'no open GuitarDSL document; open one or pass an absolute path' };
}

/**
 * Side-effect-free label of the document a call will target, for confirmation text: the `path` file
 * name, or the name of the document the command resolution order currently yields (no document is opened).
 */
async function targetLabel(input: DocumentToolInput, deps: AiToolDeps, msgs: AiToolMessages): Promise<string> {
  if (typeof input.path === 'string' && input.path) return path.basename(input.path);
  const doc = await resolveGuitarDslDocument(undefined, deps.getLastDoc());
  return doc ? path.basename(doc.fileName) : msgs.activeDocument;
}

type ApplyOutcome = { ok: true } & Payload | { ok: false; code: string; detail?: string };

/**
 * Shared mutation flow (spec extension §8.6): input check -> cancellation -> resolution -> guard ->
 * cancellation -> existing apply helper (fresh source, one WorkspaceEdit) -> post-parse. The guard is
 * always released; nothing continues after the call returns.
 */
async function runMutation(
  deps: AiToolDeps,
  operation: string,
  input: DocumentToolInput,
  problem: string | undefined,
  token: vscode.CancellationToken,
  apply: (uri: vscode.Uri) => Thenable<ApplyOutcome> | Promise<ApplyOutcome>
): Promise<vscode.LanguageModelToolResult> {
  if (problem) return failure('invalidInput', problem, { operation });
  if (token.isCancellationRequested) return failure('cancelled', undefined, { operation });
  const target = await resolveTarget(input, deps);
  if (!target.ok) return failure('documentNotFound', target.detail, { operation });
  const uri = target.doc.uri;
  const key = uri.toString();
  const document = documentInfo(target.doc);
  if (!deps.guard.tryAcquire(key)) {
    return failure('documentBusy', 'another GuitarDSL mutation is running on this document; retry after it finishes', { operation, document });
  }
  try {
    if (token.isCancellationRequested) return failure('cancelled', undefined, { operation, document });
    const outcome = await apply(uri);
    if (!outcome.ok) return failure(outcome.code, outcome.detail, { operation, document });
    const { ok: _ok, ...summary } = outcome;
    const postErrorCount = errorCount((await vscode.workspace.openTextDocument(uri)).getText());
    return toolResult({ ok: true, operation, document, ...summary, postValidationPassed: postErrorCount === 0, postErrorCount });
  } finally {
    deps.guard.release(key);
  }
}

export function createGuitarDslAiTools(deps: AiToolDeps): GuitarDslAiTools {
  const msgs = getAiToolMessages(deps.locale);
  const capoLabel = (input: ApplyTransposeInput) =>
    input.capoMode === 'explicit' ? msgs.capoExplicit(input.capo as number) : input.capoMode === 'recommended' ? msgs.capoRecommended : msgs.capoKeep;

  return {
    [VALIDATE_TOOL]: {
      async prepareInvocation(options) {
        return { invocationMessage: msgs.validating(await targetLabel(inputOf(options), deps, msgs)) };
      },
      async invoke(options, token) {
        const input = inputOf(options);
        const problem = pathProblem(input);
        if (problem) return failure('invalidInput', problem);
        if (token.isCancellationRequested) return failure('cancelled');
        const target = await resolveTarget(input, deps);
        if (!target.ok) return failure('documentNotFound', target.detail);
        const diagnostics = parseGuitarDsl(target.doc.getText()).diagnostics.map(d => ({
          severity: d.severity,
          code: d.code,
          ...(d.args ? { args: d.args } : {}),
          line: d.line + 1,
          startColumn: d.startCol + 1,
          endColumn: d.endCol + 1
        }));
        const errors = diagnostics.filter(d => d.severity === 'error').length;
        return toolResult({
          ok: true,
          document: documentInfo(target.doc),
          valid: errors === 0,
          errorCount: errors,
          warningCount: diagnostics.length - errors,
          diagnostics
        });
      }
    },

    [PLAYABILITY_TOOL]: {
      async prepareInvocation(options) {
        return { invocationMessage: msgs.analyzing(await targetLabel(inputOf(options), deps, msgs)) };
      },
      async invoke(options, token) {
        const input = inputOf(options);
        const problem = pathProblem(input);
        if (problem) return failure('invalidInput', problem);
        if (token.isCancellationRequested) return failure('cancelled');
        const target = await resolveTarget(input, deps);
        if (!target.ok) return failure('documentNotFound', target.detail);
        const document = documentInfo(target.doc);
        const inference = inferCapoForDsl(target.doc.getText());
        if (!inference) return failure('invalidSourceCapo', 'the capo: header is not an integer 0..12', { document });
        const current = inference.candidates.find(c => c.capo === inference.sourceCapo)?.playability;
        return toolResult({
          ok: true,
          document,
          sourceCapo: inference.sourceCapo,
          currentPlayability: current ? { score: current.score, level: current.level, unresolvedChords: current.unresolvedChords } : null,
          recommendedCapo: inference.recommendedCapo ?? null,
          candidates: inference.candidates.map(c => ({
            capo: c.capo,
            supported: c.supported,
            score: c.playability?.score ?? null,
            level: c.playability?.level ?? null,
            reason: c.reason ?? null
          }))
        });
      }
    },

    [APPLY_CAPO_TOOL]: {
      async prepareInvocation(options) {
        const input = inputOf(options);
        const doc = await targetLabel(input, deps, msgs);
        // Invalid input fails in invoke without editing, so there is nothing to confirm.
        if (capoInputProblem(input)) return { invocationMessage: msgs.capoProgress(doc) };
        return {
          invocationMessage: msgs.capoProgress(doc),
          confirmationMessages: { title: msgs.capoTitle, message: msgs.capoConfirm(doc, input.targetCapo) }
        };
      },
      invoke(options, token) {
        const input = inputOf(options);
        return runMutation(deps, 'applyCapo', input, capoInputProblem(input), token, uri => deps.applyCapo(uri, input.targetCapo));
      }
    },

    [APPLY_BEGINNER_TOOL]: {
      async prepareInvocation(options) {
        const input = inputOf(options);
        const doc = await targetLabel(input, deps, msgs);
        if (beginnerInputProblem(input)) return { invocationMessage: msgs.beginnerProgress(doc) };
        return {
          invocationMessage: msgs.beginnerProgress(doc),
          confirmationMessages: { title: msgs.beginnerTitle, message: msgs.beginnerConfirm(doc, input.barrePolicy, input.targetCapo) }
        };
      },
      invoke(options, token) {
        const input = inputOf(options);
        return runMutation(deps, 'applyBeginnerMode', input, beginnerInputProblem(input), token, uri =>
          deps.applyBeginner(uri, { barrePolicy: input.barrePolicy, targetCapo: input.targetCapo })
        );
      }
    },

    [APPLY_TRANSPOSE_TOOL]: {
      async prepareInvocation(options) {
        const input = inputOf(options);
        const doc = await targetLabel(input, deps, msgs);
        if (transposeInputProblem(input)) return { invocationMessage: msgs.transposeProgress(doc) };
        return {
          invocationMessage: msgs.transposeProgress(doc),
          confirmationMessages: { title: msgs.transposeTitle, message: msgs.transposeConfirm(doc, input.semitones, capoLabel(input)) }
        };
      },
      invoke(options, token) {
        const input = inputOf(options);
        return runMutation(deps, 'applyTranspose', input, transposeInputProblem(input), token, uri =>
          deps.applyTranspose(uri, { semitones: input.semitones, capoMode: toCapoMode(input) })
        );
      }
    }
  };
}

/** The guard shared by the registered tools. */
export const aiMutationGuard = new MutationGuard();

/**
 * Registers the five tools (spec extension §8.3). Every Disposable goes to `context.subscriptions`;
 * registration itself never selects or calls a language model.
 */
export function registerGuitarDslAiTools(
  context: vscode.ExtensionContext,
  locale: SupportedLocale,
  getLastDoc: () => vscode.TextDocument | undefined
): void {
  const tools = createGuitarDslAiTools({
    locale,
    getLastDoc,
    applyCapo: applyCapoTransform,
    applyBeginner: applyBeginnerTransform,
    applyTranspose: applyTransposeTransform,
    guard: aiMutationGuard
  });
  for (const [name, tool] of Object.entries(tools) as [string, vscode.LanguageModelTool<unknown>][]) {
    context.subscriptions.push(vscode.lm.registerTool(name, tool));
  }
}
