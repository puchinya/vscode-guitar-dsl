import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { showAndFocusDocument } from './workbenchFocus';
import { capturePreviewWebviewScreenshot, evaluatePreviewWebview, waitForPreviewDocument, waitForPreviewIdentity } from './screenshotCapture';
import { withWorkbenchSnapshotRestored } from './workbenchState';

type EvidenceRole = 'vocal-rhythm' | 'guitar-brace' | 'nested';
type DisplayMode = 'single' | 'web';

const captureIssue160Evidence = process.env.GUITARDSL_E2E_CAPTURE_ISSUE160 === '1';

async function setDisplayMode(mode: DisplayMode): Promise<void> {
  await evaluatePreviewWebview<void>(`(() => {
    const toggle = document.getElementById('view-export-toggle');
    const panel = document.getElementById('view-export-panel');
    if (panel.hidden) toggle.click();
    const button = document.querySelector('button[data-mode="${mode}"]');
    if (button.getAttribute('aria-pressed') !== 'true') button.click();
    if (!panel.hidden) toggle.click();
  })()`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await evaluatePreviewWebview<string>('document.body.dataset.displayMode');
    if (current === mode) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Preview did not enter ${mode} display mode`);
}

async function assertVisibleRoleMatrix(role: EvidenceRole, source: string): Promise<void> {
  const parseGuitarDsl = (require('../../compiler') as {
    parseGuitarDsl: (text: string) => {
      diagnostics: Array<{ severity: string }>;
      measures: Array<{
        melody?: unknown;
        tabVoices?: unknown[];
        rhythmSource?: { kind: string };
      }>;
    };
  }).parseGuitarDsl;
  const score = parseGuitarDsl(source);
  assert.strictEqual(score.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false,
    `${role} fixture parses without errors`);
  const hasVocal = score.measures.some(measure => measure.melody !== undefined);
  const hasTab = score.measures.some(measure => (measure.tabVoices?.length ?? 0) > 0);
  const explicitRhythmMeasures = score.measures.filter(measure => measure.rhythmSource?.kind === 'explicit').length;
  const expectedStaffCount = Number(hasVocal) + Number(hasTab) + Number(explicitRhythmMeasures > 0);
  assert.strictEqual(hasVocal, role !== 'guitar-brace', `${role} fixture assigns the vocal staff role correctly`);
  assert.strictEqual(hasTab, role !== 'vocal-rhythm', `${role} fixture assigns the guitar TAB role correctly`);
  assert.strictEqual(explicitRhythmMeasures, score.measures.length,
    `${role} fixture has explicit rhythm in every measure so the guitar rhythm staff is rendered`);

  const json = await evaluatePreviewWebview<string>(`JSON.stringify((() => {
    const visible = element => element.getClientRects().length > 0;
    const root = document.body.dataset.displayMode === 'web'
      ? document.querySelector('.web-score-container')
      : document.querySelector('.sheet-pages-wrapper');
    if (!root) throw new Error('The active Preview display mode has no score container');
    const connectors = [...root.querySelectorAll('.staff-group-connector')].filter(visible);
    const visibleElements = selector => [...root.querySelectorAll(selector)].filter(visible);
    const standardStaffLines = visibleElements('line').filter(line => line.getAttribute('x1') === '25'
      && line.getAttribute('stroke-width') === '1' && line.getAttribute('y1') === line.getAttribute('y2'));
    return {
      connectors: connectors.length,
      standardStaffLines: standardStaffLines.length,
      tabStringLines: visibleElements('.tab-string-line').length,
      brackets: visibleElements('.staff-bracket').length,
      braces: visibleElements('.staff-brace').length,
      gapConnectors: visibleElements('.staff-group-barline-connector').length,
      leftConnectors: visibleElements('.staff-group-left-connector').length
    };
  })())`);
  const rendered = JSON.parse(json) as {
    connectors: number; standardStaffLines: number; tabStringLines: number;
    brackets: number; braces: number; gapConnectors: number; leftConnectors: number;
  };
  assert.strictEqual(rendered.connectors, 1, `${role} has one visible staff group`);
  assert.strictEqual(rendered.standardStaffLines, (expectedStaffCount - Number(hasTab)) * 5,
    `${role} renders five lines for every standard-notation staff`);
  assert.strictEqual(rendered.tabStringLines, hasTab ? 6 : 0,
    `${role} renders six guitar TAB strings when the guitar TAB role is present`);
  assert.strictEqual(rendered.brackets, role === 'vocal-rhythm' || role === 'nested' ? 1 : 0,
    `${role} has the expected outer bracket count`);
  assert.strictEqual(rendered.braces, role === 'guitar-brace' || role === 'nested' ? 1 : 0,
    `${role} has the expected guitar brace count`);
  assert.strictEqual(rendered.leftConnectors, 1, `${role} has one group left connector`);
  assert.ok(rendered.gapConnectors >= (role === 'nested' ? 2 : 1),
    `${role} contains the expected visible inter-staff gap connectors`);
}

if (captureIssue160Evidence) {
  suite('Issue #160 v2-C visual evidence', () => {
    test('captures real Preview roles and display modes at 1x/2x in Light/Dark themes', async function () {
      this.timeout(300000);
      await withWorkbenchSnapshotRestored(async () => {
        const root = path.resolve(__dirname, '../../..');
        const samplesDirectory = path.join(root, 'docs/status/evidence/issue-160/v2-c-samples');
        const outputDirectory = process.env.GUITARDSL_E2E_ISSUE160_OUTPUT_DIR ?? 'v2-c-preview-captures';
        const samples: Array<{ role: EvidenceRole; file: string }> = [
          { role: 'vocal-rhythm', file: 'vocal-rhythm.guitardsl' },
          { role: 'guitar-brace', file: 'guitar-brace.guitardsl' },
          { role: 'nested', file: 'nested.guitardsl' }
        ];
        const themes = [
          { name: 'light', workbenchTheme: 'Light 2026' },
          { name: 'dark', workbenchTheme: 'Dark 2026' }
        ];

        for (const theme of themes) {
          await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme.workbenchTheme,
            vscode.ConfigurationTarget.Global);
          for (let attempt = 0; attempt < 100; attempt++) {
            if (vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') === theme.workbenchTheme) break;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          assert.strictEqual(vscode.workspace.getConfiguration('workbench').get<string>('colorTheme'), theme.workbenchTheme);

          for (const sample of samples) {
            const source = await fs.readFile(path.join(samplesDirectory, sample.file), 'utf8');
            const document = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: source });
            await showAndFocusDocument(document);
            await vscode.commands.executeCommand('guitardsl.showPreview', document.uri);
            await waitForPreviewDocument();
            const probe = require('../../previewCapo').previewLifecycleProbe as {
              currentDocumentUri?: string;
              generation: number;
            };
            assert.strictEqual(probe.currentDocumentUri, document.uri.toString(), `${sample.role} Preview owns its fixture`);
            await waitForPreviewIdentity({
              documentUri: document.uri.toString(),
              documentVersion: document.version,
              previewGeneration: probe.generation
            });
            await assertVisibleRoleMatrix(sample.role, source);

            for (const displayMode of ['single', 'web'] as const) {
              await setDisplayMode(displayMode);
              for (const scale of [1, 2] as const) {
                const filename = path.join(outputDirectory,
                  `${sample.role}-${displayMode === 'single' ? 'page' : 'web'}-${theme.name}-${scale}x.png`);
                await capturePreviewWebviewScreenshot(filename, 160, 500, scale);
              }
            }
          }
        }
      });
    });
  });
}
