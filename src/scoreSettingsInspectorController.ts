import * as vscode from 'vscode';
import { getMessages, getScoreSettingsEditorMessages, type SupportedLocale } from './i18n';
import { PreviewBeginnerController, type PreviewBeginnerSnapshot } from './previewBeginner';
import { PreviewCapoController, type PreviewCapoSnapshot } from './previewCapo';
import {
  applyBeginnerTransformForSettings,
  applyCapoTransformForSettings,
  applyTransposeTransformForSettings,
  BeginnerSection,
  CapoSection,
  TransposeSection,
  type ExpectedDocumentState,
  type ScoreSettingsSection,
  type ScoreSettingsSectionContext
} from './scoreSettingsEditor';
import type {
  GuitarDslInspectorController,
  InspectorSettingsContext,
  InspectorSettingsMessage,
  InspectorSettingsSection
} from './inspector/inspectorController';

interface SettingsPreviewSnapshot {
  readonly capo: PreviewCapoSnapshot;
  readonly beginner: PreviewBeginnerSnapshot;
}

interface SettingsSession {
  readonly doc: vscode.TextDocument;
  readonly uri: string;
  readonly version: number;
  readonly source: string;
  readonly generation: number;
  readonly sections: {
    capo: CapoSection;
    beginner: BeginnerSection;
    transpose: TransposeSection;
  };
  previewSnapshot?: SettingsPreviewSnapshot;
  revision: number;
  section: InspectorSettingsSection;
  applying: boolean;
  dirty: boolean;
}

/** Host-side E2E access to the same validated message path used by Inspector Webview messages. */
export const scoreSettingsInspectorProbe: {
  dispatchMessage?: (command: string, fields?: Record<string, unknown>) => Promise<boolean>;
  hasSession?: () => boolean;
} = {};

/** Owns one transactional settings session displayed by the common Inspector. */
export class ScoreSettingsInspectorController implements vscode.Disposable {
  private session: SettingsSession | undefined;
  private nextGeneration = 0;
  private disposed = false;
  private readonly messages;
  private readonly editorMessages;

  constructor(
    private readonly inspector: GuitarDslInspectorController,
    private readonly previewCapo: PreviewCapoController,
    private readonly previewBeginner: PreviewBeginnerController,
    private readonly locale: SupportedLocale,
    private readonly isPreviewOpenForUri: (uri: string) => boolean
  ) {
    this.messages = getMessages(locale);
    this.editorMessages = getScoreSettingsEditorMessages(locale);
    inspector.setSettingsMessageHandler(message => this.handleMessage(message));
    inspector.setSettingsSessionEndHandler(uri => {
      if (this.session?.uri === uri) this.finish(this.session, true);
    });
    scoreSettingsInspectorProbe.hasSession = () => this.session !== undefined;
    scoreSettingsInspectorProbe.dispatchMessage = (command, fields = {}) => {
      const context = inspector.currentContext;
      if (context.kind !== 'settings') return Promise.resolve(false);
      return inspector.handleWebviewMessage({
        ...fields,
        command,
        generation: inspector.currentGeneration,
        sessionUri: context.uri,
        sessionVersion: context.version,
        sessionGeneration: context.sessionGeneration,
        revision: context.revision,
        section: context.section
      });
    };
  }

  async open(doc: vscode.TextDocument, section: InspectorSettingsSection = 'capo'): Promise<void> {
    if (this.disposed) return;
    const uri = doc.uri.toString();
    const sectionId = isSettingsSection(section) ? section : 'capo';
    if (this.session) this.finish(this.session, true);

    const previewSnapshot = this.isPreviewOpenForUri(uri)
      ? {
          capo: this.previewCapo.captureSettingsSnapshot(uri),
          beginner: this.previewBeginner.captureSettingsSnapshot(uri)
        }
      : undefined;
    const session: SettingsSession = {
      doc,
      uri,
      version: doc.version,
      source: doc.getText(),
      generation: ++this.nextGeneration,
      sections: { capo: new CapoSection(), beginner: new BeginnerSection(), transpose: new TransposeSection() },
      ...(previewSnapshot ? { previewSnapshot } : {}),
      revision: 0,
      section: sectionId,
      applying: false,
      dirty: false
    };
    this.session = session;
    await this.inspector.showSettings(this.context(session));
  }

  /** Ends the session and restores its preview snapshot when the document changes or closes. */
  invalidate(uri: string): void {
    if (this.session?.uri === uri) this.finish(this.session, true);
  }

  invalidateIfDifferent(uri: string | undefined): void {
    if (this.session && this.session.uri !== uri) this.finish(this.session, true);
  }

  /** Preview actions initiated outside this settings session supersede its temporary state. */
  externalPreviewChanged(uri: string): void {
    if (this.session?.uri === uri) this.finish(this.session, false);
  }

  /** Projects the current settings draft only after the user explicitly opens its Preview. */
  previewOpened(doc: vscode.TextDocument): void {
    const session = this.session;
    if (!session || session.applying || session.uri !== doc.uri.toString() || !this.isFresh(session)) return;
    this.capturePreviewSnapshot(session);
    this.previewSelectedSettings(session);
  }

  hasPendingDraft(uri: string, version: number): boolean {
    return this.session?.uri === uri && this.session.version === version && this.session.dirty;
  }

  cancelForTabSwitch(uri: string, version: number): boolean {
    const session = this.session;
    if (!session || session.uri !== uri || session.version !== version || !this.isFresh(session)) return !session;
    this.finish(session, true);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.session) this.finish(this.session, true);
    this.inspector.setSettingsMessageHandler(undefined);
    this.inspector.setSettingsSessionEndHandler(undefined);
    scoreSettingsInspectorProbe.dispatchMessage = undefined;
    scoreSettingsInspectorProbe.hasSession = undefined;
  }

  private async handleMessage(message: InspectorSettingsMessage): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (!this.matchesMessage(session, message) || !this.isFresh(session)) {
      if (this.session === session && !this.isFresh(session)) this.finish(session, true);
      return;
    }

    if (message.command === 'settingsCancel') {
      this.inspector.beginExplicitIntent();
      this.finish(session, true);
      return;
    }
    if (session.applying && !isSettingsMutation(message.command)) return;
    if (message.command === 'settingsSelectSection') {
      const section = message.nextSection;
      if (!isSettingsSection(section) || section === session.section) return;
      this.restorePreview(session);
      session.section = section;
      session.applying = false;
      session.revision++;
      this.publish(session);
      return;
    }

    const section = session.sections[session.section];
    let changed = false;
    switch (message.command) {
      case 'settingsSelectCapo':
        if (session.section === 'capo' && typeof message.capo === 'number') {
          const model = section instanceof CapoSection
            ? section.buildModel(this.sectionContext(session)) as { candidates: { capo: number; supported: boolean }[] }
            : undefined;
          changed = !!model?.candidates.some(item => item.capo === message.capo && item.supported)
            && section instanceof CapoSection && section.selectCapo(message.capo);
          if (changed) this.previewSelectedSettings(session);
        }
        break;
      case 'settingsSetBarrePolicy':
        if (session.section === 'beginner' && (message.policy === 'allow' || message.policy === 'forbid')) {
          changed = section instanceof BeginnerSection && section.setBarrePolicy(message.policy);
          if (changed) this.previewSelectedSettings(session);
        }
        break;
      case 'settingsSelectBeginnerCapo':
        if (session.section === 'beginner') {
          const capo = message.capo === 'auto' ? undefined : typeof message.capo === 'number' ? message.capo : NaN;
          const model = section instanceof BeginnerSection
            ? section.buildModel(this.sectionContext(session)) as { candidates: { capo: number; supported: boolean }[] }
            : undefined;
          changed = (capo === undefined || !!model?.candidates.some(item => item.capo === capo && item.supported))
            && section instanceof BeginnerSection && section.selectCapo(capo);
          if (changed) this.previewSelectedSettings(session);
        }
        break;
      case 'settingsSetSemitones':
        if (session.section === 'transpose' && typeof message.semitones === 'number') {
          changed = section instanceof TransposeSection && section.setSemitones(message.semitones);
        }
        break;
      case 'settingsSetTransposeCapoMode':
        if (session.section === 'transpose'
          && (message.mode === 'keep' || message.mode === 'recommended' || message.mode === 'explicit')) {
          changed = section instanceof TransposeSection
            && section.setCapoMode(message.mode, typeof message.capo === 'number' ? message.capo : undefined);
        }
        break;
      case 'settingsApply':
        await this.apply(session);
        return;
      default:
        return;
    }
    if (!changed) return;
    session.applying = false;
    session.dirty = true;
    session.revision++;
    this.publish(session);
  }

  private async apply(session: SettingsSession): Promise<void> {
    const revision = session.revision;
    const sectionId = session.section;
    const model = this.currentModel(session) as { canApply?: unknown };
    if (model.canApply !== true) return;
    session.applying = true;
    const confirmed = await vscode.window.showWarningMessage(
      `${this.sectionTitle(sectionId)} — ${this.editorMessages.confirmApply}`,
      { modal: true },
      this.editorMessages.apply
    );
    const isCurrent = () => this.session === session && session.applying
      && session.revision === revision && session.section === sectionId && this.isFresh(session);
    if (confirmed !== this.editorMessages.apply) {
      if (this.session === session && session.revision === revision && session.applying) {
        session.applying = false;
        if (!this.isFresh(session)) this.finish(session, true);
      }
      return;
    }
    if (!isCurrent()) {
      if (this.session === session && !this.isFresh(session)) {
        this.finish(session, true);
        void vscode.window.showWarningMessage(this.editorMessages.staleDocument);
      }
      return;
    }

    const expected: ExpectedDocumentState = { version: session.version, source: session.source };
    if (sectionId === 'capo') {
      const capo = (session.sections.capo.buildModel(this.sectionContext(session)) as { selectedCapo: number }).selectedCapo;
      const result = await applyCapoTransformForSettings(session.doc.uri, capo, expected, isCurrent);
      if (!result.ok) {
        this.handleApplyFailure(session, sectionId, result);
        return;
      }
      if (this.session === session) this.finish(session, true);
      if (result.changed) {
        void vscode.window.showInformationMessage(this.messages.msgCapoApplied(result.targetCapo));
        if (result.unusedDefinitions.length) void vscode.window.showWarningMessage(this.messages.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
      }
      return;
    }

    if (sectionId === 'beginner') {
      const result = await applyBeginnerTransformForSettings(session.doc.uri, session.sections.beginner.getOptions(), expected, isCurrent);
      if (!result.ok) {
        this.handleApplyFailure(session, sectionId, result);
        return;
      }
      if (this.session === session) this.finish(session, true);
      if (!result.changed) return;
      void vscode.window.showInformationMessage(this.messages.msgBeginnerApplied(result.targetCapo, result.substitutions));
      if (result.unusedDefinitions.length) void vscode.window.showWarningMessage(this.messages.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
    } else {
      const currentModel = this.currentModel(session);
      const sourceCapo = typeof currentModel.sourceCapo === 'number' ? currentModel.sourceCapo : null;
      const shift = session.sections.transpose.request(sourceCapo).semitones;
      const result = await applyTransposeTransformForSettings(session.doc.uri, session.sections.transpose.request(sourceCapo), expected, isCurrent);
      if (!result.ok) {
        this.handleApplyFailure(session, sectionId, result);
        return;
      }
      if (this.session === session) this.finish(session, true);
      if (!result.changed) return;
      void vscode.window.showInformationMessage(this.messages.msgTransposeApplied(shift, result.targetKey));
      if (result.unusedDefinitions.length) void vscode.window.showWarningMessage(this.messages.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
    }
  }

  private handleApplyFailure(session: SettingsSession, section: InspectorSettingsSection, result: { code: string; detail?: string }): void {
    session.applying = false;
    if (result.code === 'staleDocument') {
      if (this.session === session) this.finish(session, true);
      void vscode.window.showWarningMessage(this.editorMessages.staleDocument);
    } else {
      void vscode.window.showWarningMessage(this.applyFailure(section, result));
      if (this.session === session) this.publish(session);
    }
  }

  private applyFailure(section: InspectorSettingsSection, result: { code: string; detail?: string }): string {
    if (result.code === 'editRejected') return this.messages.msgCapoEditRejected;
    if (section === 'capo') {
      const reason = result.code in this.messages.capoFailures
        ? this.messages.capoFailures[result.code as keyof typeof this.messages.capoFailures]
        : result.code;
      return this.messages.msgCapoApplyFailed(reason);
    }
    if (section === 'beginner') return this.messages.msgBeginnerApplyFailed(this.messages.beginnerFailure(result.code as never, result.detail));
    return this.messages.msgTransposeApplyFailed(this.messages.transposeFailure(result.code as never, result.detail));
  }

  private previewSelectedSettings(session: SettingsSession): void {
    if (!this.isPreviewOpenForUri(session.uri)) return;
    this.capturePreviewSnapshot(session);
    if (session.section === 'capo') {
      const model = session.sections.capo.buildModel(this.sectionContext(session)) as { selectedCapo: number };
      this.previewBeginner.disable(session.doc, false);
      this.previewCapo.setTarget(session.doc, model.selectedCapo, false);
      this.previewCapo.onDidChange?.(session.doc);
    } else if (session.section === 'beginner') {
      const options = session.sections.beginner.getOptions();
      this.previewCapo.clear();
      this.previewBeginner.enable(session.doc, false);
      this.previewBeginner.setBarrePolicy(session.doc, options.barrePolicy, false);
      if (options.targetCapo !== undefined) this.previewBeginner.setTargetCapo(session.doc, options.targetCapo, false);
      this.previewBeginner.onDidChange?.(session.doc);
    }
  }

  private restorePreview(session: SettingsSession): void {
    const snapshot = session.previewSnapshot;
    if (!snapshot) return;
    this.previewBeginner.restoreSettingsSnapshot(session.doc, snapshot.beginner, false);
    this.previewCapo.restoreSettingsSnapshot(session.doc, snapshot.capo, false);
    this.previewCapo.onDidChange?.(session.doc);
  }

  private capturePreviewSnapshot(session: SettingsSession): void {
    if (session.previewSnapshot) return;
    session.previewSnapshot = {
      capo: this.previewCapo.captureSettingsSnapshot(session.uri),
      beginner: this.previewBeginner.captureSettingsSnapshot(session.uri)
    };
  }

  private finish(session: SettingsSession, restorePreview: boolean): void {
    if (this.session !== session) return;
    if (restorePreview) this.restorePreview(session);
    this.session = undefined;
    this.inspector.restoreDocumentAfterSettings(session.uri);
  }

  private matchesMessage(session: SettingsSession, message: InspectorSettingsMessage): boolean {
    return message.sessionUri === session.uri && message.sessionVersion === session.version
      && message.sessionGeneration === session.generation && message.revision === session.revision
      && message.section === session.section;
  }

  private isFresh(session: SettingsSession): boolean {
    return session.doc.uri.toString() === session.uri && session.doc.version === session.version
      && session.doc.getText() === session.source;
  }

  private publish(session: SettingsSession): void {
    if (this.session === session) this.inspector.updateSettings(this.context(session));
  }

  private context(session: SettingsSession): InspectorSettingsContext {
    const section = this.sections(session).find(item => item.id === session.section) as { id: InspectorSettingsSection; title: string };
    return {
      kind: 'settings',
      uri: session.uri,
      version: session.version,
      sessionGeneration: session.generation,
      revision: session.revision,
      section: session.section,
      sections: this.sections(session),
      model: this.currentModel(session),
      status: section.title,
      description: this.description(session.section)
    };
  }

  private sections(_session: SettingsSession): { id: InspectorSettingsSection; title: string }[] {
    return [
      { id: 'capo', title: this.editorMessages.sectionCapo },
      { id: 'beginner', title: this.editorMessages.sectionBeginner },
      { id: 'transpose', title: this.editorMessages.sectionTranspose }
    ];
  }

  private sectionTitle(section: InspectorSettingsSection): string {
    return this.sections(this.session as SettingsSession).find(item => item.id === section)?.title ?? this.editorMessages.panelTitle;
  }

  private description(section: InspectorSettingsSection): string {
    if (section === 'beginner') return this.editorMessages.beginnerNote;
    if (section === 'transpose') return this.editorMessages.transposeNote;
    return this.editorMessages.panelTitle;
  }

  private sectionContext(session: SettingsSession): ScoreSettingsSectionContext {
    return {
      doc: session.doc,
      messages: this.messages,
      editorMessages: this.editorMessages,
      refresh: () => this.publish(session),
      status: () => {}
    };
  }

  private currentModel(session: SettingsSession): Record<string, unknown> {
    const section: ScoreSettingsSection = session.sections[session.section];
    return section.buildModel(this.sectionContext(session)) as Record<string, unknown>;
  }
}

function isSettingsSection(value: unknown): value is InspectorSettingsSection {
  return value === 'capo' || value === 'beginner' || value === 'transpose';
}

function isSettingsMutation(command: string): boolean {
  return command === 'settingsSelectSection' || command === 'settingsSelectCapo'
    || command === 'settingsSetBarrePolicy' || command === 'settingsSelectBeginnerCapo'
    || command === 'settingsSetSemitones' || command === 'settingsSetTransposeCapoMode';
}
