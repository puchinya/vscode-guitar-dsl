<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# 言語とスコア処理設計 (Language and Score Processing)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related specification: [GuitarDSL syntax specification](../specs/guitardsl-syntax.md), [Extension specification](../specs/extension.md)
- System context: [Architecture](architecture.md)

## Context and goals

GuitarDSL のテキストを、編集・表示・再生・変換機能が共有できるスコア表現と診断へ変換する領域を説明する。構文規則は[言語構文仕様](../specs/guitardsl-syntax.md)が所有し、本書は `compiler.ts` を中心とする内部処理境界を記録する。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 構文、文書構造、ヘッダー、セクション、小節、コード、リズム | 言語構文仕様 §1–§8 |
| 歌詞、改ページ、音符・音節歌詞、表示設定 | 言語構文仕様 §9–§14 |
| スコアイベント、再利用フラグメント、同時複数音 | 言語構文仕様 §16–§18 |
| 位置優先 TAB と TAB 歌詞、奏法、タイ、声部 | 言語構文仕様 §19 / [TAB notation](tab-notation.md) |
| 解析結果を使う拡張機能の診断境界 | 拡張機能仕様 §5A |

## Architecture

- `src/compiler.ts` の `parseGuitarDsl()` は GuitarDSL テキストを `ParsedScore` と診断へ変換する。Compiler は描画モジュールに依存しない。
- `src/playOrder.ts` の `resolvePlayOrder()` は書かれた小節の構造から演奏小節の出現列を解決する純粋な同期 API である。Compiler が結果を `ParsedScore.playOrder` に格納する。描画側は書かれた順序を保ち、演奏順を読む機能が解決済み列を参照する。
- `src/arrangement.ts` は編曲ブロックの走査と仮想演奏順への lowering を担い、元の小節・メロディ値を書き換えずに出現情報を付与する。
- `src/scoreEvents.ts` はスコアイベントと小節コンテキストを処理する。`src/duration.ts` / `src/melody.ts` は音価、連符、奏法、メロディと音節歌詞の処理を支える。
- `let` フラグメントの定義・参照は解析時に解決され、参照位置の診断と、使用ごとのイベント展開を作る。ノートグループは複数音を一つのリズムイベントとして扱う構文機能であり、別の文書や保存先を導入しない。
- `src/harmonicAnalysis.ts` は入力スコアから決定論的に調性・ハーモニー情報を分析する。解析機能は明示されたコードを暗黙に別のコードへ置換しない。

### スコアモデルと保持する順序

- `ParsedScore` は曲のメタデータ、使用コード、ページ、スタイル、書面小節、診断、および必要に応じた演奏順をまとめる。`pagebreak` は `ScorePage` を分ける。Renderer は解決済みの `MeasureData.context` / `eventsBefore` を使い、イベント行を読み直さない。
- 冒頭ヘッダー由来の `originalKey`、`bpm`、`keySignature` と、本文で変化する解決済み小節コンテキストは別の役割を持つ。`tuning` は score-level 値であり、本文イベントではない。
- `MeasureData.measureIndex` は記譜順の識別子である。`PlayOrderOccurrence` はその index を参照して出現を表し、`ParsedScore.measures` やページ内小節を並べ替えない。反復解決は不正・曖昧な展開で部分列を返さず、展開数には hard cap がある。
- `ParsedScore` / `MeasureData` は、ソースを保つ変換に必要なメタデータを保持する。例として `MeasureData.rhythmSource`、`ParsedScore.chordTokens`、`ParsedScore.headerLines`、`ParsedScore.pitchTokens` がある。Renderer は同じスコアモデルを消費しても、これらのソース位置を描画上の意味づけには使わない。トークン単位の変換はこれらの範囲を使い、無関係な空白・コメント・改行コード・歌詞・その他のテキストを保持する。

### イベント、断片、音符の処理境界

- スコアイベントは小節前後の有効コンテキストへ解決され、描画・再生が使う値を提供する。調号など冒頭メタデータと途中変更を混同しない。
- `let` の定義・参照は Compiler 内で解決する。入れ子参照は記述順に展開し、各参照は独立したイベント列を持つ。未知名、重複、循環、文脈に合わない fragment はソース上の位置で診断する。定義内 `%` の扱いなど、許容構文の最終規則は言語仕様 §17 を参照する。
- Note group は1つの発音位置・音価・歌詞対応を保ったまま複数 pitch を持つ。休符・スラッシュは pitch を持たず、単音と複数音を区別する。音高を読む利用側は単一 `.pitch` を仮定せず `eventPitches()` を通して扱う。
- `src/melody.ts` は音符と音節歌詞を処理する。音節グループ・複数番・melisma の解釈は言語仕様 §13 と Compiler の位置付き診断に従い、serialization 側のかな正規化とも同じ規則を共有する。

### 決定論的ハーモニー分析

`src/harmonicAnalysis.ts` は純粋・同期の分析 API で、VS Code、描画、AI、ネットワークに依存しない。入力は `ParsedScore.measures` の記譜順であり、`playOrder` を再解決しない。コード記号解析は `src/chordDetect.ts` の `parseChordName()` / quality 定義を再利用し、機能分類は分析モジュールが所有する。カポはルート・ベースの実音 pitch class に反映しつつ記号表記を保持する。未知または曖昧なコードは構造化結果として示し、他の小節を中断しない。カデンツ評価範囲は曲末とセクション境界に限定される。

### TAB domain processing (Issue #89)

`tab:` is an independent, position-first score source. `tab:` and `tab[1]:` populate voice 1; the durable `TabVoiceNumber` and `TabVoiceMeasure` reserve voices 1–4, while voices 2–4 produce `unsupportedTabVoice` and are not partially compiled or rendered. A TAB-specific cursor assigns each bar cell to the earliest measure without that voice, independently of the melody cursor.

`src/tab.ts` owns pure TAB types and structural note/effect token helpers. `MeasureData.tabVoices` contains `TabVoiceMeasure[]`, each with `TabBeat[]`, each with `TabNote[]`. `TabBeat.duration` is the existing `NoteValue`; no parallel TAB rhythm model is allowed. Compiler builds one final-header `InstrumentModel`, resolves every normal position with `pitchAt(string, relativeFret)`, and retains explicit string/fret even when another string can sound the same pitch. Dead notes have no pitch.

Effect structure is parsed generically, then semantic validation enforces the #89 names, scopes, and argument schemas. Note `{...}` and beat `!{...}` scope are fixed by syntax. Per-note ties require the immediately following sounding same-string/same-fret beat. Hammer, pull, slide and gliss resolve same-string targets in the same voice; invalid/dangling connections warn, ties fail. `let` inheritance and open links stop at fragment boundaries; `%` copies a preceding complete TAB measure only. Lyrics attach by source group and use one slot per attacked TAB beat.

`scoreHasTab(ParsedScore)` is the shared semantic predicate for transforms. A non-identity capo or transpose, and all beginner chord substitution on TAB, return `tabTransformUnsupported` before edits. Compiler and semantic helpers remain independent of rendering.

## Data flow and ownership

1. VS Code が保持する文書テキストを Compiler が行単位で分類・解析し、スコア構造と位置付き診断を返す。
2. Compiler は小節、スコアイベント、セクション文脈を構築し、必要なフラグメント解決・編曲 lowering を行う。
3. `resolvePlayOrder()` の結果は `ParsedScore.playOrder` に属する。各出現は元の小節 index を参照し、`MeasureData` を複製・並べ替えしない。
4. Renderer は書かれたスコア構造を消費する。Preview playback など演奏順が必要な機能は `playOrder` を消費する。

元テキストの正本は TextDocument が所有し、Compiler の出力は導出データである。既存の `ParsedScore` / `MeasureData` の公開ソースメタデータは保持され、ソースを保つ変換で使われる。一方、演奏順診断をソース位置へ対応付ける `MeasureSourceLocation` など、診断マッピングだけに使う位置情報は parser 内部に留める。resolver の診断だけを理由に、その内部位置情報を公開モデルへ追加しない。

## Failure handling

不正な構文、未知の参照、重複定義、曖昧または不正な演奏順は Compiler / resolver の診断または型付き失敗として返す。演奏順 resolver は不正時に部分出現列を公開しない。エラー位置や回復規則の外部契約は各仕様節を優先する。

## Alternatives considered

既存設計は VS Code 非依存の resolver と Compiler が構成する同期処理を示すが、別の parser framework や AST 表現との比較記録はない。本書はその代替選択理由を補わない。

## Verification strategy

構文適合は `tests/unit/compiler.test.ts`、演奏順・編曲・フラグメント・音符処理は対応する compiler / play-order / melody ユニット検証、ハーモニー分析は `src/harmonicAnalysis.ts` の既存検証を参照する。文書構造の検証は workflow の Schema 2 validator で行う。
