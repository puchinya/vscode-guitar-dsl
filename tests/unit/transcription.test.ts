import * as assert from 'assert';
import { validateTranscribedSong, validateBaselineSong, repairMelodyTiming, beatsToDurationString, TranscribedSong } from '../../src/transcription/model';
import { serializeSongToGuitarDsl } from '../../src/transcription/serializer';
import { TranscribePanel } from '../../src/transcription/transcribePanel';
import { FAMILY_ORDER, STRUMMING_PATTERN_PRESETS, getPresetById } from '../../src/strummingPatterns';
import { extractYouTubeVideoId, isValidYouTubeUrl, normalizeYouTubeUrl } from '../../src/transcription/youtube';
import { runBaselinePass, GeminiClientLike, DEFAULT_GEMINI_MODEL } from '../../src/transcription/gemini';
import { frac } from '../../src/duration';
import { parseGuitarDsl } from '../../src/compiler';

describe('transcription - model & semantic validation', () => {
  const baseValidSong: TranscribedSong = {
    title: 'Test Song',
    artist: 'Test Artist',
    key: 'C',
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [
      {
        name: 'Intro',
        measures: [
          {
            chords: [
              { name: 'C', duration: '2' },
              { name: 'G', duration: '2' }
            ],
            rhythm: [
              { duration: '4', direction: 'd' },
              { duration: '8', direction: 'd' },
              { duration: '8', direction: 'u', accent: true },
              { duration: '4', direction: 'd' },
              { duration: '4', direction: 'd', ghost: true }
            ]
          }
        ]
      }
    ]
  };

  it('accepts valid 4/4 song without melody', () => {
    const res = validateTranscribedSong(baseValidSong);
    assert.strictEqual(res.valid, true);
    if (res.valid) {
      assert.strictEqual(res.song.title, 'Test Song');
      assert.strictEqual(res.song.sections[0].measures[0].melody, undefined);
    }
  });

  it('accepts valid 4/4 song with melody, ties, and rests', () => {
    const songWithMelody: TranscribedSong = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'Am', duration: '1' }],
              rhythm: [
                { duration: '8', direction: 'd' },
                { duration: '8', direction: 'u' },
                { duration: '8', direction: 'd' },
                { duration: '8', direction: 'u' },
                { duration: '8', direction: 'd' },
                { duration: '8', direction: 'u' },
                { duration: '8', direction: 'd' },
                { duration: '8', direction: 'u' }
              ],
              melody: [
                { pitch: 'e4', duration: '4', tieToNext: true },
                { pitch: 'e4', duration: '8' },
                { pitch: 'r', duration: '8' },
                { pitch: 'c4', duration: '2' }
              ]
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(songWithMelody);
    assert.strictEqual(res.valid, true);
    if (res.valid) {
      assert.strictEqual(res.song.sections[0].measures[0].melody?.length, 4);
      assert.strictEqual(res.song.sections[0].measures[0].melody?.[0].tieToNext, true);
    }
  });

  it('supports 8/16/triplet rhythm and chord durations', () => {
    const complexSong: TranscribedSong = {
      key: 'G',
      bpm: 100,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Section 1',
          measures: [
            {
              chords: [
                { name: 'G', duration: '2.' },
                { name: 'D/F#', duration: '4' }
              ],
              rhythm: [
                { duration: '8t', direction: 'd' },
                { duration: '8t', direction: 'u' },
                { duration: '8t', direction: 'd' },
                { duration: '16', direction: 'd' },
                { duration: '16', direction: 'u' },
                { duration: '16', direction: 'd' },
                { duration: '16', direction: 'u' },
                { duration: '2', direction: 'd' }
              ]
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(complexSong);
    assert.strictEqual(res.valid, true);
  });

  it('normalizes empty section name to Section N', () => {
    const input = {
      ...baseValidSong,
      sections: [{ name: '', measures: baseValidSong.sections[0].measures }]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, true);
    if (res.valid) {
      assert.strictEqual(res.song.sections[0].name, 'Section 1');
    }
  });

  it('rejects non-4/4 time signature', () => {
    const input = {
      ...baseValidSong,
      timeSignature: { numerator: 3, denominator: 4 }
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('only 4/4 is supported'));
    }
  });

  it('rejects out-of-range or non-integer BPM', () => {
    assert.strictEqual(validateTranscribedSong({ ...baseValidSong, bpm: 20 }).valid, false);
    assert.strictEqual(validateTranscribedSong({ ...baseValidSong, bpm: 301 }).valid, false);
    assert.strictEqual(validateTranscribedSong({ ...baseValidSong, bpm: 120.5 }).valid, false);
  });

  it('rejects invalid key', () => {
    const res = validateTranscribedSong({ ...baseValidSong, key: 'H' });
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('Invalid musical key'));
    }
  });

  it('rejects invalid chord names', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'NotAChord!', duration: '1' }],
              rhythm: [{ duration: '1' }]
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('Invalid chord name'));
    }
  });

  it('rejects chord totals that do not equal 4 beats', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '2' }], // 2 beats, not 4
              rhythm: [{ duration: '1' }]
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('total 2 beats (expected 4)'));
    }
  });

  it('rejects rhythm totals that do not equal 4 beats', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '4' }] // 1 beat, not 4
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('total 1 beats (expected 4)'));
    }
  });

  it('rejects melody totals that do not equal 4 beats', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '1' }],
              melody: [{ pitch: 'c4', duration: '2' }] // 2 beats
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('Melody durations'));
    }
  });

  it('baseline validation repairs melody with 3.5 beats by padding with an 8th rest', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse 1',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '1' }],
              // 7 eighth notes = 3.5 beats (missing 0.5 beat rest at end of phrase)
              melody: [
                { pitch: 'g4', duration: '8', lyric: 'き' },
                { pitch: 'g4', duration: '8', lyric: 'み' },
                { pitch: 'a4', duration: '8', lyric: 'を' },
                { pitch: 'g4', duration: '8', lyric: 'わ' },
                { pitch: 'e4', duration: '8', lyric: 'す' },
                { pitch: 'd4', duration: '8', lyric: 'れ' },
                { pitch: 'c4', duration: '8', lyric: 'な' }
              ]
            }
          ]
        }
      ]
    };
    const res = validateBaselineSong(input);
    assert.strictEqual(res.valid, true);
    if (res.valid) {
      const mel = res.song.sections[0].measures[0].melody!;
      assert.strictEqual(mel.length, 8);
      // The 8th note is the padded rest
      assert.strictEqual(mel[7].pitch, 'r');
      assert.strictEqual(mel[7].duration, '8');
    }
  });

  it('never repairs chords or rhythm: short chord/rhythm measures are rejected', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Chorus',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' }
              ]
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('Rhythm durations'));
    }
  });

  it('baseline validation keeps structure/melody and drops chord and rhythm context', () => {
    const input = {
      ...baseValidSong,
      capo: 3,
      sections: [
        {
          name: 'Verse',
          measures: [
            { chords: [{ name: 'C', duration: '2' }], rhythm: [{ duration: '4' }], melody: [{ pitch: 'c4', duration: '1', lyric: 'あ' }], lyrics: 'あ' },
            { melody: [{ pitch: 'r', duration: '1' }] }
          ]
        }
      ]
    };
    const res = validateBaselineSong(input);
    assert.strictEqual(res.valid, true);
    if (res.valid) {
      const [m1, m2] = res.song.sections[0].measures;
      assert.deepStrictEqual(m1.chords, []);
      assert.deepStrictEqual(m1.rhythm, []);
      assert.strictEqual(m1.melody![0].lyric, 'あ');
      assert.strictEqual(m1.lyrics, 'あ');
      assert.strictEqual(m2.melody!.length, 1);
      assert.strictEqual(res.song.capo, undefined);
    }
  });

  it('repairMelodyTiming trims an excess and leaves an exact measure unchanged', () => {
    const trimmed = repairMelodyTiming([{ pitch: 'c4', duration: '2' }, { pitch: 'd4', duration: '2' }, { pitch: 'e4', duration: '4' }]);
    assert.deepStrictEqual(trimmed.map(n => n.duration), ['2', '2']);
    const exact = [{ pitch: 'c4', duration: '1' }];
    assert.deepStrictEqual(repairMelodyTiming(exact), exact);
  });

  it('accepts manual capo 12 in strict validation', () => {
    const res = validateTranscribedSong({ ...baseValidSong, capo: 12 });
    assert.strictEqual(res.valid, true);
    if (res.valid) assert.strictEqual(res.song.capo, 12);
  });

  it('beatsToDurationString produces dot-free additive and triplet values', () => {
    assert.strictEqual(beatsToDurationString(frac(4)), '1');
    assert.strictEqual(beatsToDurationString(frac(2)), '2');
    assert.strictEqual(beatsToDurationString(frac(1)), '4');
    assert.strictEqual(beatsToDurationString(frac(1, 2)), '8');
    assert.strictEqual(beatsToDurationString(frac(1, 4)), '16');
    assert.strictEqual(beatsToDurationString(frac(3, 2)), '4+8');
    assert.strictEqual(beatsToDurationString(frac(5, 2)), '2+8');
    assert.strictEqual(beatsToDurationString(frac(3)), '2+4');
    assert.strictEqual(beatsToDurationString(frac(5, 4)), '4+16');
    assert.strictEqual(beatsToDurationString(frac(1, 3)), '8t');
    assert.strictEqual(beatsToDurationString(frac(2, 3)), '4t');
    assert.strictEqual(beatsToDurationString(frac(5, 3)), '4+4t');
    assert.strictEqual(beatsToDurationString(frac(1, 5)), null);
  });

  it('rejects invalid melody pitch', () => {
    const input = {
      ...baseValidSong,
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '1' }],
              melody: [{ pitch: 'C4', duration: '1' }] // Uppercase C is invalid in GuitarDSL
            }
          ]
        }
      ]
    };
    const res = validateTranscribedSong(input);
    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('Invalid melody pitch'));
    }
  });

  it('rejects empty sections, measures, chords, or rhythm', () => {
    assert.strictEqual(validateTranscribedSong({ ...baseValidSong, sections: [] }).valid, false);
    assert.strictEqual(validateTranscribedSong({ ...baseValidSong, sections: [{ name: 'A', measures: [] }] }).valid, false);
    assert.strictEqual(
      validateTranscribedSong({
        ...baseValidSong,
        sections: [{ name: 'A', measures: [{ chords: [], rhythm: [{ duration: '1' }] }] }]
      }).valid,
      false
    );
    assert.strictEqual(
      validateTranscribedSong({
        ...baseValidSong,
        sections: [{ name: 'A', measures: [{ chords: [{ name: 'C', duration: '1' }], rhythm: [] }] }]
      }).valid,
      false
    );
  });
});

describe('transcription - serializer', () => {
  const sampleSong: TranscribedSong = {
    title: 'Acoustic Sunrise',
    artist: 'Jane Doe',
    key: 'G',
    bpm: 96,
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [
      {
        name: 'Intro',
        measures: [
          {
            chords: [
              { name: 'G', duration: '2' },
              { name: 'D/F#', duration: '2' }
            ],
            rhythm: [
              { duration: '4', direction: 'd' },
              { duration: '8', direction: 'd' },
              { duration: '8', direction: 'u', accent: true },
              { duration: '4', direction: 'd' },
              { duration: '4', direction: 'u', ghost: true }
            ],
            melody: [
              { pitch: 'g4', duration: '2', tieToNext: true },
              { pitch: 'g4', duration: '4' },
              { pitch: 'f#4', duration: '4' }
            ]
          },
          {
            chords: [{ name: 'Em7', duration: '1' }],
            rhythm: [
              { duration: '2', direction: 'd' },
              { duration: '2', direction: 'd' }
            ]
          }
        ]
      }
    ]
  };

  it('S002 a selected accompaniment preset must exist and match the song meter; no silent fallback (Issue #101 D1)', () => {
    const dsl = serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'rock_4_4_eighth_full' });
    assert.ok(dsl.includes('| G/2 D/F#/2 | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |'), dsl);
    assert.throws(() => serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'missing_preset' }), /Unknown accompaniment preset: missing_preset/);
    assert.throws(() => serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'waltz_3_4_eighth_flow' }), /is 3\/4; the transcription is 4\/4/);
    assert.throws(() => serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'compound_6_8_full' }), /is 6\/8/);
  });

  it('S002 a preset that needs a non-straight feel is rejected; any-feel 4/4 presets still work (PR #102 review)', () => {
    assert.throws(
      () => serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'swing_4_4_sixteenth_halftime' }),
      /Accompaniment preset swing_4_4_sixteenth_halftime requires swing feel; transcription output is straight/
    );
    assert.ok(serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'swing_4_4_comping' }).includes('4t.d 8t.u'));
    assert.ok(!serializeSongToGuitarDsl(sampleSong, { strummingPresetId: 'rock_4_4_eighth_full' }).includes('feel:'));
  });

  it('S003 without a preset the automatic rhythm path is unchanged', () => {
    assert.strictEqual(serializeSongToGuitarDsl(sampleSong, { strummingPresetId: undefined }), serializeSongToGuitarDsl(sampleSong));
  });

  it('identifies YouTube transcription as Experimental and warns that output is a draft', () => {
    const expected = {
      ja: {
        title: 'YouTubeから自動採譜（実験的）',
        heading: 'YouTube 音源から自動採譜（実験的）',
        warning: 'この機能は実験的です。生成結果には誤ったコード、リズム、メロディ、歌詞、BPM などが含まれる可能性があります。結果を下書きとして扱い、必ず確認・修正してください。'
      },
      en: {
        title: 'Transcribe from YouTube (Experimental)',
        heading: 'Transcribe from YouTube (Experimental)',
        warning: 'This feature is experimental. The generated score may contain incorrect chords, rhythm, melody, lyrics, BPM, or other musical details. Treat the result as a draft and review/correct it before use.'
      }
    } as const;

    for (const locale of ['ja', 'en'] as const) {
      const html: string = (TranscribePanel.prototype as any).getHtmlContent.call({}, { hasApiKey: true, model: 'm', compressRepeats: false, locale });
      assert.ok(html.includes(`<title>${expected[locale].title}</title>`));
      assert.ok(html.includes(`<h2>${expected[locale].heading}</h2>`));
      assert.ok(html.includes(expected[locale].warning));
      assert.match(html, /<div class="desc">[^]*?<\/div>\s*<div class="experimental-warning" role="note">/);
      assert.ok(html.includes('id="youtubeUrl"'), 'the URL control remains available');
      assert.ok(html.includes('id="btnStart"'), 'the start control remains available');
      assert.ok(html.includes('var(--vscode-inputValidation-warningBackground'), 'the warning uses VS Code theme variables');
    }
  });

  it('G137 keeps key management and advanced options collapsed, ordered, and key-safe', () => {
    for (const locale of ['ja', 'en'] as const) {
      const html: string = (TranscribePanel.prototype as any).getHtmlContent.call({}, { hasApiKey: false, model: 'gemini-3.8-flash', compressRepeats: false, locale });
      const positions = [
        html.indexOf('<h2>'),
        html.indexOf('class="experimental-warning"'),
        html.indexOf('id="youtubeUrl"'),
        html.indexOf('id="apiKeyStatus"'),
        html.indexOf('<details id="keyManagement">'),
        html.indexOf('<details id="advancedOptions">'),
        html.indexOf('id="btnStart"'),
        html.indexOf('id="statusBox"'),
        html.indexOf('id="resultPanel"')
      ];
      assert.ok(positions.every(position => position >= 0));
      assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), 'panel controls retain their specified order');
      assert.match(html, /<details id="keyManagement">\s*<summary>/);
      assert.match(html, /<details id="advancedOptions">\s*<summary>/);
      assert.ok(!/<details id="(?:keyManagement|advancedOptions)"[^>]*\sopen(?:\s|>)/.test(html), 'both disclosures start closed');
      assert.match(html, /id="apiKeyStatus"[^>]*>[^<]*(?:未設定|Not configured)/);
      assert.ok(!html.includes('AIzaSy...'), 'the page does not show an API key-shaped placeholder');
      assert.ok(html.includes("apiKey.value = ''"), 'save and clear acknowledgements clear the key input');
      assert.ok(html.includes('hasSavedApiKey || apiKey.value.trim() !=='), 'Start checks saved or entered key state');
      assert.ok(html.includes('youtubeUrl.value.trim() !=='), 'Start requires a nonempty URL');
      assert.ok(html.includes('if (isTranscribing || btnStart.disabled) return;'), 'Start suppresses repeated clicks');
      assert.match(html, /<textarea class="result-dsl" id="resultDsl" readonly/);
      assert.ok(html.includes('id="btnCopyResult"'), 'the result has a copy action');
      assert.ok(html.indexOf("window.addEventListener('message', event => {") < html.indexOf("vscode.postMessage({ command: 'requestTranscriptionState' })"), 'the renderer registers its listener before requesting current Host state');
      assert.ok(html.includes('Number.isSafeInteger(msg.revision)'), 'the renderer ignores stale revisioned job messages');
      for (const property of ['youtubeUrl', 'apiKey', 'bpmMode', 'bpmValue', 'capoMode', 'capoValue', 'beatType', 'strummingPresetId', 'compressRepeats', 'model']) {
        assert.ok(html.includes(property), `existing ${property} option remains in the message`);
      }
    }
  });

  it('G137 A-9 keeps the panel renderable with an unknown key state when initial SecretStorage read fails', async () => {
    const vscodeApi = require('vscode') as any;
    const originalWorkspace = vscodeApi.workspace;
    vscodeApi.workspace = {
      getConfiguration: () => ({ get: () => undefined })
    };

    const host: any = Object.create(TranscribePanel.prototype);
    host.secretStorage = {
      get: async () => { throw new Error('secret-storage-read-marker stack-marker'); }
    };
    host.disposed = false;
    host.locale = 'ja';
    host.panel = { webview: { html: '' } };

    try {
      await host.initHtml();
    } finally {
      if (originalWorkspace === undefined) delete vscodeApi.workspace;
      else vscodeApi.workspace = originalWorkspace;
    }

    const html = host.panel.webview.html as string;
    const status = html.match(/id="apiKeyStatus"[^>]*>([^<]*)<\/span>/)?.[1];
    assert.strictEqual(status, 'キー状態を確認できません');
    assert.ok(html.includes('id="btnSaveKey"'), 'key re-entry and save remain available');
    assert.match(html, /id="btnClearKey" disabled/, 'unknown state does not claim a key can be cleared');
    assert.ok(!html.includes('secret-storage-read-marker') && !html.includes('stack-marker'), 'storage errors and stacks are not rendered');
  });

  it('G137 A-9 reports localized Start read failures, skips the pipeline, and releases the retry lock', async () => {
    const enteredKey = 'user-entered-secret-marker';
    const readError = 'secret-storage-read-marker stack-marker';
    let readFails = true;
    let storedKey: string | undefined;
    let storeCalls = 0;
    let pipelineCalls = 0;
    const secretStorage = {
      get: async () => {
        if (readFails) throw new Error(readError);
        return storedKey;
      },
      store: async (_name: string, value: string) => {
        storeCalls++;
        storedKey = value;
      },
      delete: async () => { storedKey = undefined; }
    };

    const previousPanel = TranscribePanel.currentPanel;
    try {
    for (const [locale, expectedMessage] of [
      ['ja', 'API キーを読み取れませんでした。キーを保存し直してから再試行してください。'],
      ['en', 'The API key could not be read. Save it again, then retry.']
    ] as const) {
      const messages: any[] = [];
      const host: any = Object.create(TranscribePanel.prototype);
      host.panel = { webview: { postMessage: async (message: unknown) => { messages.push(message); } } };
      host.secretStorage = secretStorage;
      host.locale = locale;
      host.executePipeline = async () => { pipelineCalls++; return {}; };
      TranscribePanel.currentPanel = host;
      const options = {
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        apiKey: enteredKey,
        bpmMode: 'auto',
        capoMode: 'auto'
      };

      await host.handleMessage({ command: 'startTranscription', options });
      const errors = messages.filter(message => message.type === 'error');
      assert.deepStrictEqual(errors.map(({ type, message }: any) => ({ type, message })), [{ type: 'error', message: expectedMessage }]);
      const jobStates = messages.filter(message => message.type === 'transcriptionJobState');
      assert.strictEqual(jobStates.length, 2, 'the host publishes the active and released states');
      assert.strictEqual(jobStates[0].active, true);
      assert.strictEqual(jobStates[1].active, false);
      assert.strictEqual(jobStates[0].jobId, jobStates[1].jobId);
      assert.ok(jobStates[1].revision > jobStates[0].revision, 'the released snapshot has a newer revision');
      assert.strictEqual(typeof errors[0].jobId, 'number', 'job errors carry their owner identity');
      assert.strictEqual(typeof errors[0].revision, 'number', 'job errors carry a monotonic revision');
      assert.strictEqual(storeCalls, 0, 'a failed read stops before storing or using the submitted key');
      assert.strictEqual(pipelineCalls, 0, 'a failed read stops before Gemini and document generation');
      assert.strictEqual(host.transcriptionJobActive, false, 'Start is retryable after the read error');
      assert.ok(!JSON.stringify(messages).includes(enteredKey), 'the entered API key is not echoed');
      assert.ok(!JSON.stringify(messages).includes(readError), 'exception text and stack are not echoed');
    }

    readFails = false;
    const retryMessages: any[] = [];
    const retryHost: any = Object.create(TranscribePanel.prototype);
    retryHost.panel = { webview: { postMessage: async (message: unknown) => { retryMessages.push(message); } } };
    retryHost.secretStorage = secretStorage;
    retryHost.locale = 'en';
    retryHost.executePipeline = async () => { pipelineCalls++; return {}; };
    TranscribePanel.currentPanel = retryHost;
    await retryHost.handleMessage({
      command: 'startTranscription',
      options: {
        youtubeUrl: 'https://example.invalid/not-youtube',
        apiKey: enteredKey,
        bpmMode: 'auto',
        capoMode: 'auto'
      }
    });
    assert.deepStrictEqual(retryMessages.filter(message => ['apiKeySaved', 'error'].includes(message.type)).map(message => message.type), ['apiKeySaved', 'error']);
    assert.strictEqual(pipelineCalls, 0, 'a retry can save the key before URL validation without invoking Gemini');
    assert.strictEqual(retryHost.transcriptionJobActive, false, 'the retry releases the Host lock as well');
    } finally {
      TranscribePanel.currentPanel = previousPanel;
    }
  });

  it('G137 keeps successful DSL in the panel and copies the Host-owned result without creating a document', async () => {
    const vscodeApi = require('vscode') as any;
    const originalClipboardWriteText = vscodeApi.env.clipboard.writeText;
    const originalWorkspace = vscodeApi.workspace;
    const originalWindow = vscodeApi.window;
    const messages: any[] = [];
    const copied: string[] = [];
    let openDocumentCalls = 0;
    let showDocumentCalls = 0;
    vscodeApi.env.clipboard.writeText = async (text: string) => { copied.push(text); };
    vscodeApi.workspace = {
      textDocuments: [],
      openTextDocument: async () => { openDocumentCalls++; return {}; }
    };
    vscodeApi.window = { showTextDocument: async () => { showDocumentCalls++; } };

    const host: any = Object.create(TranscribePanel.prototype);
    host.panel = { webview: { postMessage: async (message: unknown) => { messages.push(message); } } };
    host.secretStorage = { get: async () => 'stored-test-key' };
    host.locale = 'en';
    host.disposed = false;
    host.executePipeline = async () => sampleSong;
    const previousPanel = TranscribePanel.currentPanel;
    TranscribePanel.currentPanel = host;

    try {
      await host.handleMessage({
        command: 'startTranscription',
        options: {
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          bpmMode: 'auto',
          capoMode: 'auto',
          compressRepeats: false,
          model: 'gemini-3.8-flash'
        }
      });

      const success = messages.find(message => message.type === 'success');
      assert.ok(success, 'a structurally valid result is sent to the owner panel');
      assert.strictEqual(success.dslText, serializeSongToGuitarDsl(sampleSong));
      assert.strictEqual(typeof success.jobId, 'number');
      assert.strictEqual(typeof success.revision, 'number');
      assert.strictEqual(openDocumentCalls, 0, 'the successful path never calls openTextDocument');
      assert.strictEqual(showDocumentCalls, 0, 'the successful path never calls showTextDocument');
      assert.deepStrictEqual(vscodeApi.workspace.textDocuments, [], 'no workspace document is created');

      const release = messages.find(message => message.type === 'transcriptionJobState' && message.active === false);
      assert.ok(release, 'the released job publishes a state snapshot');
      messages.length = 0; // model the success notification being lost before the renderer receives it
      await host.handleMessage({ command: 'requestTranscriptionState' });
      assert.strictEqual(messages.length, 1);
      assert.deepStrictEqual(messages[0].result, { jobId: success.jobId, dslText: success.dslText }, 'the snapshot replays only the result owned by this job');
      assert.strictEqual(messages[0].revision, release.revision, 'the result travels in the newer released-state revision');

      await host.handleMessage({ command: 'copyTranscriptionResult', jobId: success.jobId });
      assert.deepStrictEqual(copied, [success.dslText], 'copy uses the result owned by the Host panel');
      assert.ok(messages.some(message => message.type === 'transcriptionResultCopied' && message.jobId === success.jobId));
      await host.handleMessage({ command: 'copyTranscriptionResult', jobId: success.jobId - 1 });
      assert.strictEqual(copied.length, 1, 'a stale result identity cannot copy a different result');

      vscodeApi.env.clipboard.writeText = async () => { throw new Error('clipboard unavailable'); };
      await host.handleMessage({ command: 'copyTranscriptionResult', jobId: success.jobId });
      const copyFailure = messages.find(message => message.type === 'transcriptionResultCopyFailed');
      assert.strictEqual(copyFailure.message, 'The transcription result could not be copied.');
      assert.strictEqual(host.transcriptionResult, success.dslText, 'clipboard failure does not mutate the result');

      messages.length = 0;
      await host.handleMessage({
        command: 'startTranscription',
        options: {
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          bpmMode: 'auto',
          capoMode: 'auto',
          compressRepeats: false,
          model: 'gemini-3.8-flash'
        }
      });
      const nextStartState = messages.find(message => message.type === 'transcriptionJobState' && message.active === true);
      const nextSuccess = messages.find(message => message.type === 'success');
      assert.ok(nextStartState && nextSuccess);
      assert.strictEqual(nextStartState.result, undefined, 'a new job does not inherit the previous result snapshot');
      assert.notStrictEqual(nextSuccess.jobId, success.jobId, 'each run receives its own result identity');
      await host.handleMessage({ command: 'copyTranscriptionResult', jobId: success.jobId });
      assert.strictEqual(copied.length, 1, 'a previous job ID cannot copy the new job result');
    } finally {
      vscodeApi.env.clipboard.writeText = originalClipboardWriteText;
      if (originalWorkspace === undefined) delete vscodeApi.workspace;
      else vscodeApi.workspace = originalWorkspace;
      if (originalWindow === undefined) delete vscodeApi.window;
      else vscodeApi.window = originalWindow;
      TranscribePanel.currentPanel = previousPanel;
    }
  });

  it('G137 returns an authoritative released-job snapshot after Webview readiness', async () => {
    const ownerMessages: any[] = [];
    const reopenedMessages: any[] = [];
    const owner: any = Object.create(TranscribePanel.prototype);
    owner.panel = { webview: { postMessage: async (message: unknown) => { ownerMessages.push(message); } } };
    owner.secretStorage = { get: async () => 'stored-test-key' };
    owner.locale = 'en';
    owner.disposed = false;
    owner.executePipeline = async () => sampleSong;

    const reopened: any = Object.create(TranscribePanel.prototype);
    reopened.panel = { webview: { postMessage: async (message: unknown) => { reopenedMessages.push(message); } } };
    reopened.disposed = false;
    TranscribePanel.currentPanel = reopened;

    try {
      await owner.handleMessage({
        command: 'startTranscription',
        options: { youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', bpmMode: 'auto', capoMode: 'auto' }
      });
      const releaseMessage = reopenedMessages.find(message => message.type === 'transcriptionJobState' && message.active === false);
      assert.ok(releaseMessage, 'the current panel receives the release update when possible');

      reopenedMessages.length = 0; // model the release update being lost before listener readiness
      await reopened.handleMessage({ command: 'requestTranscriptionState' });
      assert.deepStrictEqual(reopenedMessages, [releaseMessage], 'ready requests re-read the authoritative Host state');
      assert.strictEqual(reopenedMessages[0].active, false);
      assert.strictEqual(typeof reopenedMessages[0].jobId, 'number');
      assert.strictEqual(reopenedMessages[0].revision, releaseMessage.revision);
      assert.strictEqual(reopenedMessages[0].result, undefined, 'a different panel cannot receive the old owner result');
      assert.ok(ownerMessages.some(message => message.type === 'success'));
    } finally {
      TranscribePanel.currentPanel = undefined;
    }
  });

  it('G137 synchronizes implicit key saves and reports SecretStorage failures without success acknowledgements', async () => {
    const key = 'unit-test-secret-value';
    const messages: any[] = [];
    let storedKey: string | undefined;
    const secretStorage = {
      get: async () => storedKey,
      store: async (_name: string, value: string) => { storedKey = value; },
      delete: async () => { storedKey = undefined; }
    };
    const host: any = Object.create(TranscribePanel.prototype);
    host.panel = { webview: { postMessage: async (message: unknown) => { messages.push(message); } } };
    host.secretStorage = secretStorage;
    host.locale = 'en';

    await host.handleMessage({
      command: 'startTranscription',
      options: {
        youtubeUrl: 'https://example.invalid/watch?v=not-youtube',
        apiKey: `  ${key}  `,
        bpmMode: 'auto',
        capoMode: 'auto'
      }
    });
    assert.strictEqual(storedKey, key, 'Start stores the trimmed key in SecretStorage before URL validation');
    assert.deepStrictEqual(messages.filter(message => ['apiKeySaved', 'error'].includes(message.type)).map(message => message.type), ['apiKeySaved', 'error']);
    assert.strictEqual(messages.find(message => message.type === 'apiKeySaved').success, true);
    assert.ok(!JSON.stringify(messages).includes(key), 'host responses never echo the API key');

    messages.length = 0;
    secretStorage.store = async () => { throw new Error('simulated secure storage failure'); };
    await host.handleMessage({
      command: 'startTranscription',
      options: {
        youtubeUrl: 'https://example.invalid/watch?v=not-youtube',
        apiKey: key,
        bpmMode: 'auto',
        capoMode: 'auto'
      }
    });
    const startSaveFailure = messages.find(message => message.type === 'apiKeySaveFailed');
    assert.ok(startSaveFailure);
    assert.strictEqual(startSaveFailure.duringStart, true, 'implicit save failure identifies the rejected start request');
    assert.ok(!JSON.stringify(messages).includes(key), 'save failures do not echo the API key');

    messages.length = 0;
    await host.handleMessage({ command: 'saveApiKey', apiKey: key });
    assert.deepStrictEqual(messages.map(message => message.type), ['apiKeySaveFailed']);
    assert.notStrictEqual(messages[0].duringStart, true, 'independent key-save failure is separate from transcription state');

    messages.length = 0;
    secretStorage.delete = async () => { throw new Error('simulated secure storage failure'); };
    await host.handleMessage({ command: 'clearApiKey' });
    assert.deepStrictEqual(messages.map(message => message.type), ['apiKeyClearFailed']);
  });

  it('G137 keeps Host job ownership through key failures, rejects concurrent starts, and releases after failure', async () => {
    const messages: any[] = [];
    let pipelineCalls = 0;
    let failStore = true;
    let failDelete = true;
    let rejectPipeline!: (error: Error) => void;
    const pendingPipeline = new Promise<never>((_, reject) => {
      rejectPipeline = reject;
    });
    let signalPipelineStarted!: () => void;
    const pipelineStarted = new Promise<void>(resolve => { signalPipelineStarted = resolve; });
    const secretStorage = {
      get: async () => 'stored-test-key',
      store: async () => { if (failStore) throw new Error('simulated store failure'); },
      delete: async () => { if (failDelete) throw new Error('simulated delete failure'); }
    };
    const host: any = Object.create(TranscribePanel.prototype);
    host.panel = { webview: { postMessage: async (message: unknown) => { messages.push(message); } } };
    host.secretStorage = secretStorage;
    host.locale = 'en';
    host.executePipeline = async () => {
      pipelineCalls++;
      signalPipelineStarted();
      return pendingPipeline;
    };
    const startMessage = {
      command: 'startTranscription',
      options: {
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        bpmMode: 'manual',
        bpmValue: 120,
        capoMode: 'manual',
        capoValue: 3,
        beatType: '16beat',
        strummingPresetId: 'strum_4_4_quarter_basic',
        compressRepeats: true,
        model: 'gemini-2.5-pro'
      }
    };

    const firstStart = host.handleMessage(startMessage);
    await pipelineStarted;
    assert.strictEqual(pipelineCalls, 1, 'the first Start owns the pending pipeline');
    assert.strictEqual(host.transcriptionJobActive, true, 'Host marks the job active while the pipeline is pending');

    await host.handleMessage(startMessage);
    await host.handleMessage({ command: 'clearApiKey' });
    await host.handleMessage({ command: 'saveApiKey', apiKey: 'unsaved-test-key' });
    assert.strictEqual(pipelineCalls, 1, 'duplicate Start is rejected while the owner pipeline is pending');
    assert.strictEqual(host.transcriptionJobActive, true, 'key-management failures do not release the Host job');
    assert.ok(messages.some(message => message.type === 'apiKeyClearFailed'));
    assert.ok(messages.some(message => message.type === 'apiKeySaveFailed' && message.duringStart !== true));
    assert.ok(!messages.some(message => message.type === 'success'), 'key failures cannot complete the transcription');

    rejectPipeline(new Error('simulated pending pipeline failure'));
    await firstStart;
    assert.strictEqual(host.transcriptionJobActive, false, 'the owning Start releases the Host job in finally after failure');
    assert.strictEqual(messages.filter(message => message.type === 'error').length, 1, 'pipeline failure reaches the owning job');

    failStore = false;
    failDelete = false;
    host.executePipeline = async () => {
      pipelineCalls++;
      throw new Error('simulated retry failure');
    };
    await host.handleMessage(startMessage);
    assert.strictEqual(pipelineCalls, 2, 'a new Start reaches the pipeline after the failed owner job has ended');
    assert.strictEqual(host.transcriptionJobActive, false, 'retry failure also releases the Host job');
  });

  it('S001 the transcription panel offers Auto plus 4/4 presets by family, never a flat or non-4/4 list', () => {
    for (const locale of ['ja', 'en'] as const) {
      const html: string = (TranscribePanel.prototype as any).getHtmlContent.call({}, { hasApiKey: true, model: 'm', compressRepeats: false, locale });
      const familySelect = html.slice(html.indexOf('<select id="strummingFamily">'), html.indexOf('</select>', html.indexOf('<select id="strummingFamily">')));
      assert.ok(familySelect.includes('<option value="auto">'), 'Auto stays');
      const families = [...familySelect.matchAll(/<option value="([a-z]+)">/g)].map(m => m[1]).filter(v => v !== 'auto');
      const fourFour = STRUMMING_PATTERN_PRESETS.filter(p => p.meter === '4/4' && (p.feelCompatibility === 'any' || p.feelCompatibility.includes('straight')));
      assert.ok(!html.includes('swing_4_4_sixteenth_halftime'), 'a swing-only preset is not offered');
      assert.deepStrictEqual(families, FAMILY_ORDER.filter(f => fourFour.some(p => p.family === f)));
      const presetIds = [...html.matchAll(/<option value="([a-z0-9_]+_[0-9]+_[0-9]+_[a-z0-9_]+)">/g)].map(m => m[1]);
      assert.deepStrictEqual([...presetIds].sort(), fourFour.map(p => p.id).sort());
      for (const f of families) {
        const start = html.indexOf(`<select id="strummingPreset-${f}"`);
        assert.ok(start >= 0, f);
        const block = html.slice(start, html.indexOf('</select>', start));
        const ids = [...block.matchAll(/<option value="([^"]+)">/g)].map(m => m[1]);
        assert.ok(ids.length > 0 && ids.every(id => getPresetById(id)?.family === f && getPresetById(id)?.meter === '4/4'), f);
      }
    }
  });

  it('produces exact deterministic DSL snapshot for valid 4/4 IR', () => {
    const dsl = serializeSongToGuitarDsl(sampleSong);
    const expected = [
      'title: Acoustic Sunrise',
      'artist: Jane Doe',
      'key: G',
      'bpm: 96',
      '',
      '[Intro]',
      '| G/2 D/F#/2 | 4.d 8.d 8.u.a 4.d 4.u.g |',
      'mel: | g4/2~ g4/4 f#4/4 |',
      '| Em7/1 | 2.d 2.d |',
      ''
    ].join('\n');

    assert.strictEqual(dsl, expected);
  });

  it('is byte-identical when serialized multiple times with the same IR', () => {
    const dsl1 = serializeSongToGuitarDsl(sampleSong);
    const dsl2 = serializeSongToGuitarDsl(sampleSong);
    assert.strictEqual(dsl1, dsl2);
  });

  it('has zero parseGuitarDsl error diagnostics on output', () => {
    const dsl = serializeSongToGuitarDsl(sampleSong);
    const parsed = parseGuitarDsl(dsl);
    const errors = parsed.diagnostics.filter(d => d.severity === 'error');
    assert.strictEqual(errors.length, 0);
  });

  it('correctly handles modifiers order (direction, accent, ghost)', () => {
    const song: TranscribedSong = {
      key: 'C',
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Test',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [
                { duration: '4', direction: 'd', accent: true, ghost: true },
                { duration: '4', direction: 'u', ghost: true },
                { duration: '4', accent: true },
                { duration: '4' }
              ]
            }
          ]
        }
      ]
    };
    const dsl = serializeSongToGuitarDsl(song);
    assert.ok(dsl.includes('4.d.a.g 4.u.g 4.a 4'));
  });

  it('serializes capo, measure repeat %, melody repeat %, and syllable lyrics', () => {
    const song: TranscribedSong = {
      title: 'Players Song',
      artist: 'YOASOBI',
      capo: 3,
      key: 'Eb',
      bpm: 130,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '2' }, { name: 'G', duration: '2' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' }
              ],
              melody: [
                { pitch: 'c4', duration: '4', lyric: 'きょ' },
                { pitch: 'd4', duration: '4', lyric: 'う' },
                { pitch: 'e4', duration: '4', lyric: 'も' },
                { pitch: 'g4', duration: '4', lyric: 'は' }
              ]
            },
            {
              // Exact same chords and rhythm -> | % |
              // Exact same melody -> mel: | % |
              chords: [{ name: 'C', duration: '2' }, { name: 'G', duration: '2' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' }
              ],
              melody: [
                { pitch: 'c4', duration: '4', lyric: 'あ' },
                { pitch: 'd4', duration: '4', lyric: 'し' },
                { pitch: 'e4', duration: '4', lyric: 'た' },
                { pitch: 'g4', duration: '4', lyric: 'も' }
              ]
            },
            {
              // Different chords, same rhythm -> | F/2 G/2 | % |
              chords: [{ name: 'F', duration: '2' }, { name: 'G', duration: '2' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' }
              ],
              melody: [
                { pitch: 'a4', duration: '2', lyric: 'ゆ' },
                { pitch: 'g4', duration: '2', lyric: 'め' }
              ]
            },
            {
              // Instrumental with measure lyrics, different rhythm
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '1', direction: 'd' }],
              lyrics: 'インスト終了'
            }
          ]
        }
      ]
    };

    const dsl = serializeSongToGuitarDsl(song);
    assert.ok(dsl.includes('capo: 3'));
    assert.ok(dsl.includes('mel: | c4/4 d4/4 e4/4 g4/4 |'));
    assert.ok(dsl.includes('lyr: きょ う も は'));
    assert.ok(dsl.includes('| % |'));
    assert.ok(dsl.includes('mel: | % |'));
    assert.ok(dsl.includes('lyr: あ し た も'));
    assert.ok(dsl.includes('| F/2 G/2 | % |'));
    assert.ok(dsl.includes('| C/1 | 1.d l:"インスト終了" |'));

    const parsed = parseGuitarDsl(dsl);
    const errors = parsed.diagnostics.filter(d => d.severity === 'error');
    assert.strictEqual(errors.length, 0);
  });

  it('normalizes only joining small kana and reparses the emitted syllables without alignment warnings', () => {
    const lyrics = ['き', 'ょ', 'っ', 'ー', 'ヶ'];
    const durations = ['8', '8', '8', '8', '2'];
    const song: TranscribedSong = {
      key: 'C',
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: durations.map(duration => ({ duration })),
              melody: lyrics.map((lyric, index) => ({
                pitch: ['c4', 'd4', 'e4', 'f4', 'g4'][index],
                duration: durations[index],
                lyric
              }))
            }
          ]
        }
      ]
    };

    const dsl = serializeSongToGuitarDsl(song);
    assert.ok(dsl.includes('lyr: きょ っ ー ヶ _'));

    const parsed = parseGuitarDsl(dsl);
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.deepStrictEqual(
      parsed.measures[0].melody!.map(note => note.syllables[0]?.extend ? '_' : note.syllables[0]?.text),
      ['きょ', 'っ', 'ー', 'ヶ', '_']
    );
  });

  it('groups multi-character semantic lyrics as one DSL syllable without double-wrapping valid groups', () => {
    const songWithLyric = (lyric: string): TranscribedSong => ({
      key: 'C',
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Verse',
          measures: [
            {
              chords: [{ name: 'C', duration: '1' }],
              rhythm: [{ duration: '1' }],
              melody: [{ pitch: 'c4', duration: '1', lyric }]
            }
          ]
        }
      ]
    });

    const dsl = serializeSongToGuitarDsl(songWithLyric('きょう'));
    assert.ok(dsl.includes('lyr: (きょう)'));
    const parsed = parseGuitarDsl(dsl);
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.strictEqual(parsed.measures[0].melody![0].syllables[0]?.text, 'きょう');

    const alreadyGroupedDsl = serializeSongToGuitarDsl(songWithLyric('(きょう)'));
    assert.ok(alreadyGroupedDsl.includes('lyr: (きょう)'));
    assert.ok(!alreadyGroupedDsl.includes('lyr: ((きょう))'));
  });

  it('compresses identical repeated sections with repeat barlines and multiple lyr lines when compressRepeats is true', () => {
    const song: TranscribedSong = {
      key: 'C',
      bpm: 185,
      timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        {
          name: 'Verse 1',
          measures: [
            {
              chords: [{ name: 'C', duration: '2' }, { name: 'G', duration: '2' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' }
              ],
              melody: [
                { pitch: 'c4', duration: '4', lyric: 'き' },
                { pitch: 'd4', duration: '4', lyric: 'ょ' },
                { pitch: 'e4', duration: '4', lyric: 'う' }
              ]
            }
          ]
        },
        {
          name: 'Verse 2',
          measures: [
            {
              chords: [{ name: 'C', duration: '2' }, { name: 'G', duration: '2' }],
              rhythm: [
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' },
                { duration: '4', direction: 'd' },
                { duration: '4', direction: 'u' }
              ],
              melody: [
                { pitch: 'c4', duration: '4', lyric: 'あ' },
                { pitch: 'd4', duration: '4', lyric: 'す' },
                { pitch: 'e4', duration: '4', lyric: 'も' }
              ]
            }
          ]
        }
      ]
    };

    const dsl = serializeSongToGuitarDsl(song, { compressRepeats: true });
    assert.ok(dsl.includes('|: C/2 G/2 |'));
    assert.ok(dsl.includes(':|'));
    // Small kana 'ょ' must merge with 'き' -> 'きょ'
    assert.ok(dsl.includes('lyr: きょ う _'));
    assert.ok(dsl.includes('lyr: あ す も'));

    const parsed = parseGuitarDsl(dsl);
    const errors = parsed.diagnostics.filter(d => d.severity === 'error');
    assert.strictEqual(errors.length, 0);
  });
});

describe('transcription - YouTube URL validation', () => {
  it('accepts expected HTTPS YouTube URL forms', () => {
    const validUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/v/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ'
    ];

    for (const url of validUrls) {
      assert.strictEqual(isValidYouTubeUrl(url), true, `Expected valid: ${url}`);
      assert.strictEqual(extractYouTubeVideoId(url), 'dQw4w9WgXcQ');
      assert.strictEqual(normalizeYouTubeUrl(url), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  });

  it('rejects malformed, non-HTTPS, or non-YouTube URLs', () => {
    const invalidUrls = [
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // http
      'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com/12345678',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/', // no video ID
      'https://www.youtube.com/watch', // no v param
      'https://www.youtube.com/watch?v=short', // too short
      'https://youtu.be/',
      'not a url',
      ''
    ];

    for (const url of invalidUrls) {
      assert.strictEqual(isValidYouTubeUrl(url), false, `Expected invalid: ${url}`);
      assert.strictEqual(extractYouTubeVideoId(url), null);
      assert.throws(() => normalizeYouTubeUrl(url));
    }
  });
});

describe('transcription - Gemini adapter (mocked)', () => {
  const validSongIR: TranscribedSong = {
    title: 'Mocked Song',
    key: 'C',
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [
      {
        name: 'Verse',
        measures: [
          {
            chords: [{ name: 'C', duration: '1' }],
            rhythm: [
              { duration: '4', direction: 'd' },
              { duration: '4', direction: 'u' },
              { duration: '4', direction: 'd' },
              { duration: '4', direction: 'u' }
            ]
          }
        ]
      }
    ]
  };

  it('successfully parses and validates mocked Gemini response', async () => {
    let capturedParams: any = null;
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            id: 'int-1',
            status: 'completed',
            output_text: JSON.stringify(validSongIR)
          };
        }
      }
    };

    const { song, interactionId } = await runBaselinePass({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      model: 'gemini-3.8-flash',
      client: mockClient
    });

    assert.strictEqual(song.title, 'Mocked Song');
    assert.strictEqual(song.key, 'C');
    assert.strictEqual(interactionId, 'int-1');
    assert.strictEqual(capturedParams.model, 'gemini-3.8-flash');
    assert.strictEqual(capturedParams.store, true);
    assert.strictEqual(capturedParams.input[0].type, 'video');
    assert.strictEqual(capturedParams.input[0].uri, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(capturedParams.input[0].processing, 'agentic');
    assert.strictEqual(capturedParams.previous_interaction_id, undefined);
  });

  it('omits agentic processing for models not known to support it', async () => {
    let capturedModel: string | undefined;
    let capturedProcessing: unknown = 'unset';
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async (params: any) => {
          capturedModel = params.model;
          capturedProcessing = params.input[0].processing;
          return {
            id: 'int-1',
            output_text: JSON.stringify(validSongIR)
          };
        }
      }
    };

    await runBaselinePass({
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
      model: 'gemini-2.5-pro',
      client: mockClient
    });

    assert.strictEqual(capturedModel, 'gemini-2.5-pro');
    assert.strictEqual(capturedProcessing, undefined);
    assert.ok(DEFAULT_GEMINI_MODEL);
  });

  it('extracts text from steps fallback if output_text is omitted', async () => {
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async () => ({
          id: 'int-1',
          status: 'completed',
          steps: [
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(validSongIR)
                }
              ]
            }
          ]
        })
      }
    };

    const { song } = await runBaselinePass({
      model: DEFAULT_GEMINI_MODEL,
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      client: mockClient
    });

    assert.strictEqual(song.title, 'Mocked Song');
  });

  it('classifies auth error cleanly without leaking key', async () => {
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async () => {
          throw new Error('API_KEY_INVALID: Provided key secret_key_12345 is not valid');
        }
      }
    };

    try {
      await runBaselinePass({
        model: DEFAULT_GEMINI_MODEL,
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        client: mockClient
      });
      assert.fail('Expected exception');
    } catch (err: any) {
      assert.ok(err.message.includes('authentication failed'));
      assert.ok(!err.message.includes('secret_key_12345'));
    }
  });

  it('classifies quota error cleanly', async () => {
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async () => {
          throw new Error('RESOURCE_EXHAUSTED: quota exceeded');
        }
      }
    };

    try {
      await runBaselinePass({
        model: DEFAULT_GEMINI_MODEL,
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        client: mockClient
      });
      assert.fail('Expected exception');
    } catch (err: any) {
      assert.ok(err.message.includes('quota exceeded'));
    }
  });

  it('fails cleanly on non-JSON response', async () => {
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async () => ({
          id: 'int-1',
          output_text: 'Sorry, I cannot transcribe this video.'
        })
      }
    };

    await assert.rejects(
      async () => {
        await runBaselinePass({
          model: DEFAULT_GEMINI_MODEL,
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          client: mockClient
        });
      },
      /valid JSON/
    );
  });
});
