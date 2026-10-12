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
