import * as assert from 'assert';
import {
  GuitarDslInspectorController,
  type InspectorActiveDocument,
  type InspectorContext,
  type InspectorPresentation
} from '../../src/inspector/inspectorController';

class FakePresentation implements InspectorPresentation {
  readonly shown: boolean[] = [];
  contextChanges = 0;
  disposeCalls = 0;
  resolved = false;

  contextChanged(): void {
    this.contextChanges++;
  }

  show(preserveFocus: boolean): boolean {
    this.shown.push(preserveFocus);
    return this.resolved;
  }

  async postMessage(): Promise<boolean> {
    return true;
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

describe('GuitarDslInspectorController', () => {
  it('opens an inert empty state when the active editor has no GuitarDSL document', async () => {
    const presentation = new FakePresentation();
    let focusCalls = 0;
    const controller = new GuitarDslInspectorController(presentation, () => undefined, () => {
      focusCalls++;
      return Promise.resolve();
    });

    await controller.openForActiveEditor();

    assert.deepStrictEqual(controller.currentContext, { kind: 'empty' });
    assert.deepStrictEqual(presentation.shown, [false]);
    assert.strictEqual(focusCalls, 1, 'an unresolved view is activated through its focus command');
  });

  it('binds explicit open to only the active URI and version', async () => {
    const presentation = new FakePresentation();
    presentation.resolved = true;
    const activeDocument: InspectorActiveDocument = { uri: 'file:///active.guitardsl', version: 3 };
    const controller = new GuitarDslInspectorController(presentation, () => activeDocument, () => Promise.resolve());

    await controller.openForActiveEditor(true);

    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document',
      uri: activeDocument.uri,
      version: activeDocument.version
    });
    assert.deepStrictEqual(presentation.shown, [true], 'resolved views can preserve editor focus on explicit reveal');
  });

  it('updates versions without revealing and ignores stale invalidation', () => {
    const presentation = new FakePresentation();
    const controller = new GuitarDslInspectorController(presentation, () => undefined, () => Promise.resolve());
    controller.showDocument('file:///A.guitardsl', 1);
    const initialChanges = presentation.contextChanges;

    controller.showDocument('file:///A.guitardsl', 2);
    controller.invalidate('file:///B.guitardsl');

    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document',
      uri: 'file:///A.guitardsl',
      version: 2
    });
    assert.strictEqual(presentation.shown.length, 0, 'background context changes never reveal the view');
    assert.strictEqual(presentation.contextChanges, initialChanges + 1);

    controller.invalidate('file:///A.guitardsl');
    assert.deepStrictEqual(controller.currentContext, { kind: 'empty' });
  });

  it('reuses one presentation for repeated opens and shows only the newest context', async () => {
    const presentation = new FakePresentation();
    presentation.resolved = true;
    let activeDocument: InspectorActiveDocument = { uri: 'file:///A.guitardsl', version: 1 };
    const controller = new GuitarDslInspectorController(presentation, () => activeDocument, () => Promise.resolve());

    await controller.openForActiveEditor();
    activeDocument = { uri: 'file:///B.guitardsl', version: 4 };
    controller.showDocument(activeDocument.uri, activeDocument.version);
    await controller.openForActiveEditor();

    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document',
      uri: 'file:///B.guitardsl',
      version: 4
    });
    assert.deepStrictEqual(presentation.shown, [false, false]);
    assert.strictEqual(presentation.disposeCalls, 0);
  });

  it('keeps the newest context when a second open arrives before view activation resolves', async () => {
    const presentation = new FakePresentation();
    let finishFocus!: () => void;
    const focusPending = new Promise<void>(resolve => { finishFocus = resolve; });
    let activeDocument: InspectorActiveDocument = { uri: 'file:///A.guitardsl', version: 1 };
    const controller = new GuitarDslInspectorController(presentation, () => activeDocument, () => focusPending);

    const openingA = controller.openForActiveEditor();
    activeDocument = { uri: 'file:///B.guitardsl', version: 2 };
    const openingB = controller.openForActiveEditor();

    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document',
      uri: 'file:///B.guitardsl',
      version: 2
    });
    finishFocus();
    await Promise.all([openingA, openingB]);
    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document',
      uri: 'file:///B.guitardsl',
      version: 2
    });
  });

  it('reveals progression state and routes only messages for the current view and session identity', async () => {
    const presentation = new FakePresentation();
    presentation.resolved = true;
    const controller = new GuitarDslInspectorController(presentation, () => undefined, () => Promise.resolve());
    const context: InspectorContext = {
      kind: 'progression',
      uri: 'file:///song.guitardsl',
      version: 7,
      sessionGeneration: 3,
      target: { bars: 4, operation: 'replace', startMeasure: 0 },
      availableBars: [4, 8],
      availableOperations: ['replace', 'append'],
      candidates: [],
      selectedCandidateId: '',
      side: 'B',
      auditionMode: 'melody',
      auditionSpeed: 100,
      loading: false
    };
    let routed = 0;
    controller.setProgressionMessageHandler(() => { routed++; });

    await controller.showProgression(context);
    const generation = controller.currentGeneration;
    const message = {
      command: 'progressionSelectCandidate',
      generation,
      sessionUri: context.uri,
      sessionVersion: context.version,
      sessionGeneration: context.sessionGeneration
    };

    assert.strictEqual(controller.currentContext, context);
    assert.deepStrictEqual(presentation.shown, [false]);
    await controller.handleWebviewMessage(message);
    await controller.handleWebviewMessage({ ...message, sessionVersion: context.version - 1 });
    await controller.handleWebviewMessage({ ...message, generation: generation - 1 });
    assert.strictEqual(routed, 1, 'stale URI/version/session/view messages never reach the feature handler');
  });

  it('routes only the current settings revision and cancels settings when the view is disposed', async () => {
    const presentation = new FakePresentation();
    presentation.resolved = true;
    const controller = new GuitarDslInspectorController(presentation, () => undefined, () => Promise.resolve());
    const context: InspectorContext = {
      kind: 'settings',
      uri: 'file:///song.guitardsl',
      version: 7,
      sessionGeneration: 4,
      revision: 2,
      section: 'beginner',
      sections: [
        { id: 'capo', title: 'Capo' },
        { id: 'beginner', title: 'Beginner' },
        { id: 'transpose', title: 'Transpose' }
      ],
      model: { canApply: false },
      status: 'Beginner',
      description: 'Temporary preview'
    };
    const routed: string[] = [];
    controller.setSettingsMessageHandler(message => { routed.push(message.command); });
    await controller.showSettings(context);
    const message = {
      command: 'settingsSelectBeginnerCapo',
      generation: controller.currentGeneration,
      sessionUri: context.uri,
      sessionVersion: context.version,
      sessionGeneration: context.sessionGeneration,
      revision: context.revision,
      section: context.section,
      capo: 2
    };

    await controller.handleWebviewMessage(message);
    await controller.handleWebviewMessage({ ...message, revision: 1 });
    await controller.handleWebviewMessage({ ...message, section: 'capo' });
    assert.deepStrictEqual(routed, ['settingsSelectBeginnerCapo']);

    controller.handleViewDisposed();
    assert.deepStrictEqual(routed, ['settingsSelectBeginnerCapo', 'settingsCancel']);
  });

  it('ends Settings synchronously before replacing its context with the active document', async () => {
    const presentation = new FakePresentation();
    const activeDocument: InspectorActiveDocument = { uri: 'file:///song.guitardsl', version: 9 };
    const controller = new GuitarDslInspectorController(presentation, () => activeDocument, () => Promise.resolve());
    const settings: InspectorContext = {
      kind: 'settings',
      uri: 'file:///song.guitardsl',
      version: 8,
      sessionGeneration: 4,
      revision: 0,
      section: 'capo',
      sections: [
        { id: 'capo', title: 'Capo' },
        { id: 'beginner', title: 'Beginner' },
        { id: 'transpose', title: 'Transpose' }
      ],
      model: { canApply: false },
      status: 'Capo',
      description: 'Temporary preview'
    };
    await controller.showSettings(settings);
    let endedBeforeReplacement = false;
    controller.setSettingsSessionEndHandler(uri => {
      endedBeforeReplacement = uri === settings.uri && controller.currentContext.kind === 'settings';
      controller.restoreDocumentAfterSettings(uri);
    });

    await controller.openForActiveEditor();

    assert.strictEqual(endedBeforeReplacement, true, 'the session-end callback runs while Settings is still current');
    assert.deepStrictEqual(controller.currentContext, {
      kind: 'document', uri: activeDocument.uri, version: activeDocument.version
    });
    assert.strictEqual(presentation.contextChanges, 2, 'Settings is replaced by the requested document in one context update');
  });

  it('dismisses the active progression session when its Webview is disposed', async () => {
    const controller = new GuitarDslInspectorController(new FakePresentation(), () => undefined, () => Promise.resolve());
    const context: InspectorContext = {
      kind: 'progression',
      uri: 'file:///song.guitardsl',
      version: 7,
      sessionGeneration: 3,
      target: { bars: 4, operation: 'replace', startMeasure: 0 },
      availableBars: [4],
      availableOperations: ['replace'],
      candidates: [],
      selectedCandidateId: '',
      side: 'B',
      auditionMode: 'melody',
      auditionSpeed: 100,
      loading: false
    };
    const messages: string[] = [];
    controller.setProgressionMessageHandler(message => { messages.push(message.command); });
    await controller.showProgression(context);

    controller.handleViewDisposed();

    assert.deepStrictEqual(messages, ['progressionDismiss']);
  });

  it('disposes its presentation once and ignores later context changes', () => {
    const presentation = new FakePresentation();
    const controller = new GuitarDslInspectorController(presentation, () => undefined, () => Promise.resolve());
    const initialChanges = presentation.contextChanges;

    controller.dispose();
    controller.dispose();
    controller.showDocument('file:///closed.guitardsl', 2);

    assert.strictEqual(presentation.disposeCalls, 1);
    assert.strictEqual(presentation.contextChanges, initialChanges);
    assert.deepStrictEqual(controller.currentContext, { kind: 'empty' });
  });
});
