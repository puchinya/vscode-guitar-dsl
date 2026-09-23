import * as assert from 'assert';
import { GeminiClientLike } from '../../src/transcription/gemini';
import { runTranscriptionPipeline, TranscriptionPipelineOptions } from '../../src/transcription/pipeline';
import { MUSIC_IR_JSON_SCHEMA } from '../../src/transcription/model';
import { HARMONY_REFINEMENT_JSON_SCHEMA, HARMONY_VERIFICATION_JSON_SCHEMA } from '../../src/transcription/harmonyRefinement';
import { GROOVE_REFINEMENT_JSON_SCHEMA } from '../../src/transcription/grooveOptimizer';
import { serializeSongToGuitarDsl } from '../../src/transcription/serializer';
import { parseGuitarDsl } from '../../src/compiler';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const verseMelody1 = [
  { pitch: 'd4', duration: '4', lyric: 'き' },
  { pitch: 'f4', duration: '4', lyric: 'み' },
  { pitch: 'g4', duration: '2', lyric: 'と' }
];
const verseMelody2 = [
  { pitch: 'f4', duration: '2', lyric: 'う' },
  { pitch: 'r', duration: '2' }
];

const baselineJson = {
  title: 'Pipeline Song',
  artist: 'Mock',
  key: 'Bb',
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  sections: [
    {
      name: 'Verse',
      measures: [
        { chords: [{ name: 'Bb', duration: '1' }], rhythm: [{ duration: '4' }], melody: verseMelody1 },
        { chords: [{ name: 'Eb', duration: '3' }], melody: verseMelody2 }
      ]
    },
    { name: 'Chorus', measures: [{ lyrics: 'ら' }] }
  ]
};

const c = (name: string, confidence: number) => ({ name, confidence });

function harmonyJson(ambiguous: boolean) {
  return {
    sections: [
      {
        sectionIndex: 0,
        measures: [
          { measureIndex: 0, changes: [{ tick16: 0, candidates: [c('Bb', 0.95)] }, { tick16: 14, candidates: [c('Eb', 0.9)] }] },
          { measureIndex: 1, changes: [{ tick16: 0, candidates: ambiguous ? [c('F', 0.6), c('Dm', 0.55)] : [c('F', 0.9)] }] }
        ]
      },
      { sectionIndex: 1, measures: [{ measureIndex: 0, changes: [{ tick16: 0, candidates: [c('Gm', 0.9)] }] }] }
    ]
  };
}

function grooveJson(grid: 8 | 12 | 16 = 8) {
  const all = Array.from({ length: grid }, (_, i) => i);
  return {
    sections: [
      {
        sectionIndex: 0,
        measures: [
          { measureIndex: 0, grid, style: 'strum', attacks: grid === 12 ? [0, 5] : [0, 2, 3, 4, 5, 6], confidence: 0.9 },
          { measureIndex: 1, grid, style: 'strum', attacks: grid === 12 ? [0, 5] : [0, 2, 3, 4, 5, 6], confidence: 0.9 }
        ]
      },
      { sectionIndex: 1, measures: [{ measureIndex: 0, grid, style: 'strum', attacks: all, confidence: 0.9 }] }
    ]
  };
}

type Responder = (params: any, index: number) => unknown;

function mockClient(responders: Responder[]): { client: GeminiClientLike; calls: any[] } {
  const calls: any[] = [];
  const client: GeminiClientLike = {
    interactions: {
      create: async (params: any) => {
        const index = calls.length;
        calls.push(params);
        const responder = responders[index];
        if (!responder) throw new Error(`unexpected call ${index}`);
        const json = responder(params, index);
        return { id: `int-${index}`, status: 'completed', output_text: JSON.stringify(json) };
      }
    }
  };
  return { client, calls };
}

function run(client: GeminiClientLike, extra: Partial<TranscriptionPipelineOptions> = {}) {
  return runTranscriptionPipeline({ apiKey: 'k', youtubeUrl: URL, model: 'gemini-3.8-flash', client, ...extra });
}

function assertCompiles(dsl: string) {
  const errors = parseGuitarDsl(dsl).diagnostics.filter(d => d.severity === 'error');
  assert.deepStrictEqual(errors, []);
}

describe('transcription - pipeline (mocked Gemini)', () => {
  it('chains every follow-up through previous_interaction_id and re-specifies the schema', async () => {
    const { client, calls } = mockClient([
      () => baselineJson,
      () => harmonyJson(true),
      () => ({ decisions: [{ sectionIndex: 0, measureIndex: 1, tick16: 0, selectedName: 'Dm' }] }),
      () => grooveJson()
    ]);
    const stages: string[] = [];
    await run(client, { onStage: s => stages.push(s) });

    assert.strictEqual(calls.length, 4);
    assert.deepStrictEqual(calls.map(p => p.previous_interaction_id), [undefined, 'int-0', 'int-1', 'int-2']);
    assert.deepStrictEqual(calls.map(p => p.response_format.schema), [
      MUSIC_IR_JSON_SCHEMA, HARMONY_REFINEMENT_JSON_SCHEMA, HARMONY_VERIFICATION_JSON_SCHEMA, GROOVE_REFINEMENT_JSON_SCHEMA
    ]);
    assert.ok(calls.every(p => p.store === true && p.model === 'gemini-3.8-flash'));
    assert.deepStrictEqual(stages, ['baseline', 'harmony', 'verification', 'groove', 'finalizing']);
  });

  it('embeds the baseline skeleton in follow-up prompts', async () => {
    const { client, calls } = mockClient([() => baselineJson, () => harmonyJson(false), () => grooveJson()]);
    await run(client);
    const harmonyPrompt: string = calls[1].input[0].text;
    assert.ok(harmonyPrompt.includes('"name":"Verse","measureCount":2'));
    assert.ok(harmonyPrompt.includes('"name":"Chorus","measureCount":1'));
    assert.ok(harmonyPrompt.includes('"lyricHints":["きみと","う"]'));
    assert.ok(calls[2].input[0].text.includes('"measureCount":2'));
  });

  it('replaces chords/rhythm only, keeps melody and lyrics, and applies the auto capo', async () => {
    const { client } = mockClient([() => baselineJson, () => harmonyJson(false), () => grooveJson()]);
    const song = await run(client);

    assert.strictEqual(song.key, 'Bb');
    assert.strictEqual(song.capo, 3);
    const [m1, m2] = song.sections[0].measures;
    assert.deepStrictEqual(m1.chords, [{ name: 'G', duration: '2+4+8' }, { name: 'C', duration: '8' }]);
    assert.deepStrictEqual(m2.chords, [{ name: 'D', duration: '1' }]);
    assert.deepStrictEqual(m1.melody!.map(n => [n.pitch, n.duration, n.lyric]), verseMelody1.map(n => [n.pitch, n.duration, n.lyric]));
    assert.deepStrictEqual(m2.melody!.map(n => n.pitch), ['f4', 'r']);
    assert.strictEqual(song.sections[1].measures[0].lyrics, 'ら');
    assert.deepStrictEqual(m1.rhythm.map(r => `${r.duration}.${r.direction}`), ['4.d', '8.d', '8.u', '8.d', '8.u', '4.d']);

    assertCompiles(serializeSongToGuitarDsl(song));
  });

  it('skips verification when nothing is ambiguous', async () => {
    const { client, calls } = mockClient([() => baselineJson, () => harmonyJson(false), () => grooveJson()]);
    await run(client);
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2].previous_interaction_id, 'int-1');
    assert.strictEqual(calls[2].response_format.schema, GROOVE_REFINEMENT_JSON_SCHEMA);
  });

  it('applies a verified decision among the candidates', async () => {
    const { client } = mockClient([
      () => baselineJson, () => harmonyJson(true),
      () => ({ decisions: [{ sectionIndex: 0, measureIndex: 1, tick16: 0, selectedName: 'Dm' }] }),
      () => grooveJson()
    ]);
    const song = await run(client, { capo: 0 });
    assert.strictEqual(song.sections[0].measures[1].chords[0].name, 'Dm');
  });

  it('falls back to the top candidate when verification fails and chains groove from harmony', async () => {
    const { client, calls } = mockClient([
      () => baselineJson, () => harmonyJson(true),
      () => { throw new Error('network down'); },
      () => grooveJson()
    ]);
    const song = await run(client, { capo: 0 });
    assert.strictEqual(song.sections[0].measures[1].chords[0].name, 'F');
    assert.strictEqual(calls[3].previous_interaction_id, 'int-1');
  });

  it('skips the groove call entirely for an explicit preset', async () => {
    const { client, calls } = mockClient([() => baselineJson, () => harmonyJson(false)]);
    const song = await run(client, { strummingPresetId: 'arpeggiato_whole' });
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(song.sections[0].measures[0].rhythm, [{ duration: '1', arpeggio: true }]);
    const dsl = serializeSongToGuitarDsl(song, { strummingPresetId: 'arpeggiato_whole' });
    assert.ok(dsl.includes('1.arp'));
    assertCompiles(dsl);
  });

  it('retries a structurally invalid harmony answer once and succeeds', async () => {
    const { client, calls } = mockClient([
      () => baselineJson,
      () => ({ sections: [] }),
      () => harmonyJson(false),
      () => grooveJson()
    ]);
    await run(client);
    assert.strictEqual(calls[2].previous_interaction_id, 'int-1');
    assert.ok(calls[2].input[0].text.includes('structurally invalid'));
    assert.strictEqual(calls[2].response_format.schema, HARMONY_REFINEMENT_JSON_SCHEMA);
    assert.strictEqual(calls[3].previous_interaction_id, 'int-2');
  });

  it('fails when the harmony answer is invalid twice (no silent use of baseline chords)', async () => {
    const { client, calls } = mockClient([() => baselineJson, () => ({ sections: [] }), () => ({ sections: [] })]);
    await assert.rejects(() => run(client), /Invalid harmony refinement/);
    assert.strictEqual(calls.length, 3);
  });

  it('fails when the groove answer is invalid twice in auto mode', async () => {
    const { client } = mockClient([
      () => baselineJson, () => harmonyJson(false),
      () => grooveJson(16), () => grooveJson(16)
    ]);
    await assert.rejects(() => run(client, { beatType: '8beat' }), /Invalid groove refinement/);
  });

  it('keeps manual BPM and manual capo 12 authoritative', async () => {
    const { client } = mockClient([() => baselineJson, () => harmonyJson(false), () => grooveJson()]);
    const song = await run(client, { bpm: 185, capo: 12 });
    assert.strictEqual(song.bpm, 185);
    assert.strictEqual(song.capo, 12);
    assert.strictEqual(song.key, 'Bb');
    assert.strictEqual(song.sections[0].measures[0].chords[0].name, 'Bb');
    assertCompiles(serializeSongToGuitarDsl(song));
  });

  it('produces compilable DSL for long triplet durations', async () => {
    const { client } = mockClient([() => baselineJson, () => harmonyJson(false), () => grooveJson(12)]);
    const song = await run(client);
    assert.deepStrictEqual(song.sections[0].measures[0].rhythm.map(r => r.duration), ['4+4t', '2+8t']);
    assertCompiles(serializeSongToGuitarDsl(song));
  });

  it('produces compilable DSL for a tie across the barline', async () => {
    const groove = grooveJson();
    groove.sections[0].measures[0] = { measureIndex: 0, grid: 8, style: 'strum', attacks: [0, 2, 4, 6, 7], confidence: 1 };
    groove.sections[0].measures[1] = { measureIndex: 1, grid: 8, style: 'strum', attacks: [2, 4, 6], confidence: 1, sustainFromPrevious: true } as any;
    const { client } = mockClient([() => baselineJson, () => harmonyJson(false), () => groove]);
    const song = await run(client);
    const dsl = serializeSongToGuitarDsl(song);
    assert.ok(dsl.includes('8.u.t'));
    assertCompiles(dsl);
  });
});
