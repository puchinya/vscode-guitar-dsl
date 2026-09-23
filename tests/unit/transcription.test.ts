import * as assert from 'assert';
import { validateTranscribedSong, TranscribedSong } from '../../src/transcription/model';
import { serializeSongToGuitarDsl } from '../../src/transcription/serializer';
import { extractYouTubeVideoId, isValidYouTubeUrl, normalizeYouTubeUrl } from '../../src/transcription/youtube';
import { transcribeWithGemini, GeminiClientLike, DEFAULT_GEMINI_MODEL } from '../../src/transcription/gemini';
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
            status: 'completed',
            output_text: JSON.stringify(validSongIR)
          };
        }
      }
    };

    const song = await transcribeWithGemini({
      apiKey: 'test-key',
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      model: 'gemini-3.8-flash',
      client: mockClient
    });

    assert.strictEqual(song.title, 'Mocked Song');
    assert.strictEqual(song.key, 'C');
    assert.strictEqual(capturedParams.model, 'gemini-3.8-flash');
    assert.strictEqual(capturedParams.input[0].type, 'video');
    assert.strictEqual(capturedParams.input[0].uri, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('uses default model if not specified', async () => {
    let capturedModel: string | undefined;
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async (params: any) => {
          capturedModel = params.model;
          return {
            output_text: JSON.stringify(validSongIR)
          };
        }
      }
    };

    await transcribeWithGemini({
      apiKey: 'test-key',
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
      client: mockClient
    });

    assert.strictEqual(capturedModel, DEFAULT_GEMINI_MODEL);
  });

  it('extracts text from steps fallback if output_text is omitted', async () => {
    const mockClient: GeminiClientLike = {
      interactions: {
        create: async () => ({
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

    const song = await transcribeWithGemini({
      apiKey: 'test-key',
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
      await transcribeWithGemini({
        apiKey: 'secret_key_12345',
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
      await transcribeWithGemini({
        apiKey: 'key',
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
          output_text: 'Sorry, I cannot transcribe this video.'
        })
      }
    };

    await assert.rejects(
      async () => {
        await transcribeWithGemini({
          apiKey: 'key',
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          client: mockClient
        });
      },
      /valid JSON/
    );
  });
});
