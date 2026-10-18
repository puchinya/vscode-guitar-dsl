import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { getMessages } from '../../src/i18n';

const ROOT = path.resolve(__dirname, '../..');
const mock: any = require('vscode');

// Sidebar imports capture these VS Code constructors at module load.
mock.EventEmitter = class {
  listeners: ((e: unknown) => void)[] = [];
  event = (l: (e: unknown) => void) => { this.listeners.push(l); return { dispose() {} }; };
  fire(e?: unknown) { this.listeners.forEach(l => l(e)); }
  dispose() { this.listeners = []; }
};
mock.TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
mock.TreeItem = class { command: any; iconPath: any; id?: string; tooltip?: string; constructor(public label: string, public collapsibleState: number) {} };
mock.ThemeIcon = class { constructor(public id: string) {} };
const sidebar: typeof import('../../src/sidebar') = require('../../src/sidebar');
const navigation: typeof import('../../src/sidebarNavigation') = require('../../src/sidebarNavigation');

let activeDoc: any;
const registered: [string, unknown][] = [];
const provider = (locale: 'en' | 'ja' = 'en') => new sidebar.GuitarDslSidebarProvider(getMessages(locale), () => activeDoc);
const roots = (p: InstanceType<typeof sidebar.GuitarDslSidebarProvider>) => p.getChildren();
const section = (p: InstanceType<typeof sidebar.GuitarDslSidebarProvider>, id: string) =>
  p.getChildren(roots(p).find(s => s.kind === 'section' && s.section === id));
const commandsOf = (items: ReturnType<typeof section>) => items.map(i => (i.kind === 'command' ? i.command : `<${i.kind}>`));

describe('GuitarDslSidebarProvider', () => {
  beforeEach(() => {
    activeDoc = undefined;
    mock.window ??= {};
    mock.window.registerTreeDataProvider = (id: string, p: unknown) => { registered.push([id, p]); return { dispose() {} }; };
  });

  it('shows the informational target and five sections in the required order without an active file', () => {
    const p = provider();
    const m = getMessages('en');
    const rootItems = roots(p);
    assert.deepStrictEqual(rootItems.map(r => r.label), [
      `${m.sidebarTargetPrefix} ${m.sidebarNoActiveTarget}`,
      m.sidebarCreate, m.sidebarOpenImport, m.sidebarEditAssist, m.sidebarExport, m.sidebarHelp
    ]);
    assert.deepStrictEqual(rootItems.map(r => p.getTreeItem(r).collapsibleState), [0, 2, 2, 1, 1, 1]);
    assert.strictEqual(p.getTreeItem(rootItems[0]).command, undefined, 'the target row has no command');
    assert.deepStrictEqual(commandsOf(section(p, 'create')), [
      'guitardsl.newDocumentFromTemplate', 'guitardsl.openSample'
    ]);
    assert.deepStrictEqual(commandsOf(section(p, 'openImport')), [
      navigation.SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND, 'guitardsl.importGuitarPro',
      navigation.SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND
    ]);
    assert.strictEqual((p.getTreeItem(section(p, 'openImport')[1]) as any).iconPath.id, 'music', 'Import Guitar Pro uses a supported Codicon');
    assert.deepStrictEqual(commandsOf(section(p, 'editAssist')), [
      navigation.SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND, 'guitardsl.openInspector'
    ]);
    assert.deepStrictEqual(commandsOf(section(p, 'export')), [
      navigation.SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND, navigation.SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND
    ]);
    assert.strictEqual((p.getTreeItem(section(p, 'export')[1]) as any).iconPath.id, 'music', 'Export Guitar Pro uses a supported Codicon');
    assert.deepStrictEqual(commandsOf(section(p, 'help')), ['guitardsl.openHelp']);
  });

  it('uses the active GuitarDSL filename only on the informational target row', () => {
    activeDoc = { languageId: 'guitardsl', fileName: '/work/song.guitardsl', uri: { path: '/work/song.guitardsl' } };
    const p = provider();
    assert.strictEqual(roots(p)[0].label, 'Target: song.guitardsl');
    assert.strictEqual(p.getTreeItem(roots(p)[0]).iconPath, undefined, 'the target row stays informational');
    for (const group of roots(p).filter(item => item.kind === 'section')) {
      for (const item of p.getChildren(group)) {
        const treeItem = p.getTreeItem(item);
        assert.deepStrictEqual(treeItem.command?.arguments, [], 'no TreeItem retains a document URI');
      }
    }
  });

  it('localizes the name of an untitled GuitarDSL document', () => {
    activeDoc = { languageId: 'guitardsl', fileName: 'Untitled-1', uri: { scheme: 'untitled', path: 'Untitled-1' } };
    for (const locale of ['en', 'ja'] as const) {
      assert.strictEqual(roots(provider(locale))[0].label, `${getMessages(locale).sidebarTargetPrefix} ${getMessages(locale).sidebarUntitledTarget}`);
    }
  });

  it('keeps tree item IDs unique and all labels localized in Japanese and English', () => {
    for (const locale of ['en', 'ja'] as const) {
      const p = provider(locale);
      const all = roots(p).flatMap(item => [item, ...p.getChildren(item)]);
      const ids = all.map(item => p.getTreeItem(item).id);
      assert.strictEqual(new Set(ids).size, ids.length);
      assert.ok(all.every(item => typeof item.label === 'string' && item.label.trim() !== ''));
    }
    assert.notStrictEqual(getMessages('ja').sidebarCreate, getMessages('en').sidebarCreate);
  });

  it('refresh() fires onDidChangeTreeData when the active target changes', () => {
    const p = provider();
    let fired = 0;
    p.onDidChangeTreeData(() => { fired++; });
    assert.ok(roots(p)[0].label.endsWith(getMessages('en').sidebarNoActiveTarget));
    activeDoc = { languageId: 'guitardsl', fileName: '/work/next.guitardsl', uri: { path: '/work/next.guitardsl' } };
    p.refresh();
    assert.strictEqual(fired, 1);
    assert.strictEqual(roots(p)[0].label, 'Target: next.guitardsl');
  });

  it('registers the single Tree View provider for guitardsl.sidebar', () => {
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

  it('uses the exact Experimental command titles and Gemini model descriptions in both locales', () => {
    assert.strictEqual(nls[0]['command.transcribeYouTube.title'], 'GuitarDSL: Transcribe from YouTube (Experimental)');
    assert.strictEqual(nls[1]['command.transcribeYouTube.title'], 'GuitarDSL: YouTubeから採譜（実験的）');
    assert.strictEqual(nls[0]['config.geminiModel.description'], 'Gemini model to use for experimental YouTube audio transcription.');
    assert.strictEqual(nls[1]['config.geminiModel.description'], 'YouTube 音源の実験的な自動採譜に使用する Gemini モデル。');
  });

  it('contributes the activation event, commands, a single Tree View and the Activity Bar container', () => {
    assert.ok(pkg.activationEvents.includes('onView:guitardsl.sidebar'));
    assert.ok(pkg.activationEvents.includes('onLanguage:guitardsl'));
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    assert.ok(commands.includes('guitardsl.newDocumentFromTemplate'));
    assert.ok(commands.includes('guitardsl.openSample'));
    assert.ok(!commands.some((command: string) => command.startsWith('guitardsl.navigation.')));

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
    assert.ok(!/<image|data:|<text|xlink:href/.test(svg));
    assert.ok(!svg.includes('https://') || svg.includes('http://www.w3.org/'));
    const colors = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map(m => m[1]));
    for (const c of colors) assert.ok(['currentColor', '#fff', '#000'].includes(c), `fill ${c}`);
  });
});
