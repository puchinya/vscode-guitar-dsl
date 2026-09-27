// Onboarding commands: a new untitled GuitarDSL document from a starter template, or from a curated sample.
// Both always create an untitled, editable document; no existing file is opened, changed or saved.
import * as vscode from 'vscode';
import { CuratedSampleId, getMessages, StarterTemplateId, SupportedLocale } from './i18n';

export const NEW_FROM_TEMPLATE_COMMAND = 'guitardsl.newDocumentFromTemplate';
export const OPEN_SAMPLE_COMMAND = 'guitardsl.openSample';

/** Quick Pick order of the starter templates. */
export const STARTER_TEMPLATE_IDS: readonly StarterTemplateId[] = ['basicChordSong', 'melodyExample', 'leadSheetExample'];

/**
 * Short starter bodies, each trimmed from a valid repository sample (`source`, relative to the extension root).
 * The content stays in code so a template can never be missing from the packaged extension.
 */
export const STARTER_TEMPLATES: Record<StarterTemplateId, { source: string; content: string }> = {
  basicChordSong: {
    source: 'samples/sample.guitardsl',
    content: `title: New Song
key: C
bpm: 104

[Intro]
|: C   G   | 4.d 4.d 4.d 4.d |
|  Am  Em  | % |
|  F   C   | 4.d 4.d 4.d 4.d |
|  Dm7 G7  | % :|

[Aメロ]
| C   G   | 8.d 16.d 16.u 8.d 8.u 8.d 16.d 16.u 8.d 8.u l:"あさのひかりを あびながら" |
| Am  Em  | % l:"あたらしいドアを ひらく" |
| F   C   | 8.d 16.d 16.u 8.d 8.u 8.d 16.d 16.u 8.d 8.u l:"ちいさなコンパス てににぎり" |
| Dm7 G7  | % l:"まだみぬまちへ あるきだす" |
`
  },
  melodyExample: {
    source: 'samples/sample_melody.guitardsl',
    content: `title: New Melody
key: C
bpm: 96

[Aメロ]
| C  | 8.d 8.u 4.d 8.d 8.u 4.d |
| G  | % |
| Am | % |
| Em | 4.d 4.d 2.d |
mel: | r/8 e4/8 e g a g e d | d4/8 d e d c/4 r/4 | c4/8 c d e a/4 g | g4/2~ g/4 r/4 |
lyr: | あ さ の ひ か り を | あ び な が ら    | ち い さ な ゆ め | を            |

[サビ]
| F  | 4.d 8.d 8.u.a 8.u 8.d 4.d |
mel: | a4/4. g/8 f/4 e |
lyr: | い ま こ そ |
| G  | % |
mel: | d4/8 e f g/4 a r/8 |
lyr: | あ の そ ら へ |
`
  },
  leadSheetExample: {
    source: 'samples/sample_leadsheet.guitardsl',
    content: `title: New Lead Sheet
key: D
bpm: 88
show_rhythm: false
measures_per_row: 2

[Verse]
| D  | % |
mel: | d4/4 f# a/2 |
lyr: | はれた |
| G  | % |
mel: | b4/8t a g f#/4 e/2 |
lyr: | あおいそら |
| A7 | % |
mel: | e4/4 g/8 f# e/4 c# |
lyr: | どこまでも |
| D  | % |
mel: | d4/1 |
lyr: | (いこう) |
`
  }
};

/** Curated samples in Quick Pick order. Each ships in the VSIX (re-included in `.vscodeignore`). */
export const CURATED_SAMPLES: readonly CuratedSampleId[] = [
  'sample.guitardsl',
  'sample_melody.guitardsl',
  'sample_leadsheet.guitardsl',
  'sample_voicings.guitardsl',
  'sample_notes.guitardsl'
];

/** Packaged sample file (relative to the extension root). */
export function sampleFilePath(id: CuratedSampleId): string[] {
  return ['samples', id];
}

async function openUntitledGuitarDsl(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
  await vscode.window.showTextDocument(doc);
}

/** `guitardsl.newDocumentFromTemplate`. Cancelling the Quick Pick is a silent no-op. */
export async function newDocumentFromTemplate(locale: SupportedLocale): Promise<void> {
  const msgs = getMessages(locale);
  const picked = await vscode.window.showQuickPick(
    STARTER_TEMPLATE_IDS.map(id => ({ ...msgs.templates[id], id })),
    { placeHolder: msgs.templatePickPlaceholder }
  );
  if (!picked) {
    return;
  }
  try {
    await openUntitledGuitarDsl(STARTER_TEMPLATES[picked.id].content);
  } catch {
    void vscode.window.showErrorMessage(msgs.msgTemplateOpenFailed);
  }
}

/**
 * `guitardsl.openSample`. The sample is read before any document is created, so a read failure
 * shows one localized error and leaves nothing open. Cancelling the Quick Pick is a silent no-op.
 */
export async function openSample(extensionUri: vscode.Uri, locale: SupportedLocale): Promise<void> {
  const msgs = getMessages(locale);
  const picked = await vscode.window.showQuickPick(
    CURATED_SAMPLES.map(id => ({ label: id, description: msgs.samples[id], id })),
    { placeHolder: msgs.samplePickPlaceholder }
  );
  if (!picked) {
    return;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, ...sampleFilePath(picked.id)));
    await openUntitledGuitarDsl(new TextDecoder('utf-8').decode(bytes));
  } catch {
    void vscode.window.showErrorMessage(msgs.msgSampleOpenFailed);
  }
}
