import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getMessages } from '../../src/i18n';

const ROOT = path.resolve(__dirname, '../..');

describe('GuitarDslSidebarProvider', () => {
  const mock: any = require('vscode');
  let activeDoc: any;
  const registered: [string, unknown][] = [];

  // Imports snapshot the mock's keys (not their values): create them before loading sidebar.ts.
  mock.EventEmitter = class {
    listeners: ((e: unknown) => void)[] = [];
    event = (l: (e: unknown) => void) => { this.listeners.push(l); return { dispose() {} }; };
    fire(e?: unknown) { this.listeners.forEach(l => l(e)); }
    dispose() { this.listeners = []; }
  };
  mock.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  mock.TreeItem = class { constructor(public label: string, public collapsibleState: number) {} };
  mock.ThemeIcon = class { constructor(public id: string) {} };
  mock.window ??= {};
  const sidebar: typeof import('../../src/sidebar') = require('../../src/sidebar');

  before(() => {
    mock.window.registerTreeDataProvider = (id: string, p: unknown) => { registered.push([id, p]); return { dispose() {} }; };
  });

  beforeEach(() => { activeDoc = undefined; });

  const provider = (locale: 'en' | 'ja' = 'en') => new sidebar.GuitarDslSidebarProvider(getMessages(locale), () => activeDoc);
  const section = (p: InstanceType<typeof sidebar.GuitarDslSidebarProvider>, id: string) =>
    p.getChildren(p.getChildren().find(s => s.kind === 'section' && s.section === id));
  const commandsOf = (items: ReturnType<typeof section>) => items.map(i => (i.kind === 'command' ? i.command : `<${i.kind}>`));

  it('no active GuitarDSL file: three sections in order, Current File shows only a hint', () => {
    const p = provider();
    const m = getMessages('en');
    const roots = p.getChildren();
    assert.deepStrictEqual(roots.map(r => r.label), [m.sidebarGetStarted, m.sidebarCurrentFile, m.sidebarTools]);
    assert.deepStrictEqual(roots.map(r => p.getTreeItem(r).collapsibleState), [2, 2, 1], 'Get Started / Current File expanded, Tools collapsed');

    assert.deepStrictEqual(commandsOf(section(p, 'getStarted')), [
      'guitardsl.newDocumentFromTemplate', 'guitardsl.openSample', 'guitardsl.showPreview', 'guitardsl.openHelp'
    ]);
    const current = section(p, 'currentFile');
    assert.strictEqual(current.length, 1);
    assert.strictEqual(current[0].kind, 'hint');
    assert.strictEqual(current[0].label, m.sidebarNoActiveFile);
    const hintItem = p.getTreeItem(current[0]);
    assert.strictEqual(hintItem.command, undefined, 'the hint runs no command');
    assert.strictEqual(hintItem.collapsibleState, 0);
    assert.deepStrictEqual(commandsOf(section(p, 'tools')), ['guitardsl.transcribeYouTube', 'guitardsl.transcribeAudio']);
  });

  it('active GuitarDSL file: Current File exposes six actions targeting the active URI', () => {
    const uri = { toString: () => 'file:///song.guitardsl' };
    activeDoc = { uri };
    const p = provider();
    const current = section(p, 'currentFile');
    assert.deepStrictEqual(commandsOf(current), [
      'guitardsl.showPreview', 'guitardsl.editChordDiagram', 'guitardsl.editScoreSettings',
      'guitardsl.editCapo', 'guitardsl.applyStrummingPattern', 'guitardsl.exportPdf'
    ]);
    for (const item of current) {
      const treeItem = p.getTreeItem(item);
      assert.deepStrictEqual(treeItem.command?.arguments, [uri]);
      assert.strictEqual(treeItem.command?.arguments?.[0], uri);
    }
    assert.ok(!current.some(i => i.kind === 'hint'));
  });

  it('Get Started and Tools pass no document argument and never duplicate Help', () => {
    activeDoc = { uri: {} };
    const p = provider();
    for (const id of ['getStarted', 'tools']) {
      for (const item of section(p, id)) {
        assert.deepStrictEqual(p.getTreeItem(item).command?.arguments, []);
      }
    }
    assert.ok(!commandsOf(section(p, 'tools')).includes('guitardsl.openHelp'));
  });

  it('tree item ids are unique across sections and labels are localized', () => {
    activeDoc = { uri: {} };
    for (const locale of ['en', 'ja'] as const) {
      const p = provider(locale);
      const all = p.getChildren().flatMap(s => [s, ...p.getChildren(s)]);
      const ids = all.map(i => p.getTreeItem(i).id);
      assert.strictEqual(new Set(ids).size, ids.length);
      assert.ok(all.every(i => typeof i.label === 'string' && i.label.trim() !== ''));
    }
    assert.notStrictEqual(getMessages('ja').sidebarGetStarted, getMessages('en').sidebarGetStarted);
  });

  it('refresh() fires onDidChangeTreeData so Current File can follow the active editor', () => {
    const p = provider();
    let fired = 0;
    p.onDidChangeTreeData(() => { fired++; });
    assert.strictEqual(section(p, 'currentFile')[0].kind, 'hint');
    activeDoc = { uri: {} };
    p.refresh();
    assert.strictEqual(fired, 1);
    assert.strictEqual(section(p, 'currentFile').length, 6);
  });

  it('registerGuitarDslSidebar registers the provider for the guitardsl.sidebar view', () => {
    registered.length = 0;
    const { provider: p, disposables } = sidebar.registerGuitarDslSidebar(getMessages('en'), () => undefined);
    assert.deepStrictEqual(registered, [['guitardsl.sidebar', p]]);
    assert.strictEqual(disposables.length, 2);
    assert.ok(disposables.includes(p));
  });
});

describe('Sidebar package contributions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nls = ['package.nls.json', 'package.nls.ja.json'].map(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  it('contributes the activation event, commands, a single Tree View and the Activity Bar container', () => {
    assert.ok(pkg.activationEvents.includes('onView:guitardsl.sidebar'));
    assert.ok(pkg.activationEvents.includes('onLanguage:guitardsl'));
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    assert.ok(commands.includes('guitardsl.newDocumentFromTemplate'));
    assert.ok(commands.includes('guitardsl.openSample'));

    const containers = pkg.contributes.viewsContainers.activitybar;
    const container = containers.find((c: { id: string }) => c.id === 'guitardslSidebar');
    assert.ok(container);
    assert.strictEqual(container.icon, 'media/icons/guitardsl-sidebar.svg');
    const views = pkg.contributes.views.guitardslSidebar;
    assert.strictEqual(views.length, 1, 'exactly one view in the container');
    assert.strictEqual(views[0].id, 'guitardsl.sidebar');
    assert.strictEqual(views[0].type ?? 'tree', 'tree', 'a Tree View, not a WebviewView');

    for (const ref of [container.title, views[0].name]) {
      const key = /^%(.+)%$/.exec(ref)?.[1];
      assert.ok(key, `${ref} is an NLS reference`);
      for (const table of nls) assert.ok(typeof table[key] === 'string' && table[key] !== '');
    }
  });

  it('the Activity Bar icon is a monochrome vector SVG without raster images or text', () => {
    const svg = fs.readFileSync(path.join(ROOT, 'media/icons/guitardsl-sidebar.svg'), 'utf8');
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!/<image|data:|<text|xlink:href|https?:\/\/(?!www\.w3\.org)/.test(svg));
    const colors = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map(m => m[1]));
    for (const c of colors) assert.ok(['currentColor', '#fff', '#000'].includes(c), `fill ${c}`);
  });
});
