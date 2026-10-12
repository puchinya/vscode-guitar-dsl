import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

describe('GuitarDSL Inspector package contributions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nls = ['package.nls.json', 'package.nls.ja.json'].map(file =>
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
  );

  it('adds one Secondary Sidebar Webview View while preserving the onboarding Activity Bar view', () => {
    assert.deepStrictEqual(pkg.contributes.viewsContainers.activitybar.map((container: { id: string }) => container.id), [
      'guitardslSidebar'
    ]);
    assert.strictEqual(pkg.contributes.views.guitardslSidebar.length, 1);
    assert.strictEqual(pkg.contributes.views.guitardslSidebar[0].id, 'guitardsl.sidebar');

    const containers = pkg.contributes.viewsContainers.secondarySidebar;
    assert.strictEqual(containers.length, 1);
    assert.strictEqual(containers[0].id, 'guitardslInspector');
    const views = pkg.contributes.views.guitardslInspector;
    assert.strictEqual(views.length, 1);
    assert.strictEqual(views[0].type, 'webview');
    assert.strictEqual(views[0].id, 'guitardsl.inspector');
    assert.ok(pkg.activationEvents.includes('onView:guitardsl.inspector'));
    assert.ok(pkg.activationEvents.includes('onCommand:guitardsl.openInspector'));
  });

  it('localizes the explicit command, container title, and view name in English and Japanese', () => {
    const command = pkg.contributes.commands.find((entry: { command: string }) => entry.command === 'guitardsl.openInspector');
    assert.ok(command);
    assert.strictEqual(command.title, '%command.openInspector.title%');
    assert.strictEqual(nls[0]['command.openInspector.title'], 'GuitarDSL: Open Inspector');
    assert.strictEqual(nls[1]['command.openInspector.title'], 'GuitarDSL: Inspectorを開く');
    assert.strictEqual(nls[0]['viewsContainer.guitardslInspector.title'], 'GuitarDSL Inspector');
    assert.strictEqual(nls[1]['viewsContainer.guitardslInspector.title'], 'GuitarDSL Inspector');
    assert.strictEqual(nls[0]['view.inspector.name'], 'Inspector');
    assert.strictEqual(nls[1]['view.inspector.name'], 'Inspector');
  });
});
