<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# AI 連携設計 (AI Integration)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related specification: [Extension specification](../specs/extension.md)
- System context: [Architecture](architecture.md)

## Context and goals

VS Code 標準 Agent / Chat から利用される GuitarDSL Skill、指示、言語モデルツールと、拡張機能の決定論的ドメイン処理の境界を記録する。AI 連携は任意で、拡張機能自身がモデル選択・会話・計画を所有しない。規範動作は拡張機能仕様 §8 が所有する。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 連携原則、Skills / 指示、7つの tool | 拡張機能仕様 §8.1–§8.3 |
| 対象文書解決、結果形式、変更 tool | 拡張機能仕様 §8.4–§8.6 |
| 伴奏分析・計画・適用 | 拡張機能仕様 §8.7 |
| Tool / Skill の生成資産検査 | 拡張機能仕様 §7、および `npm run check:ai` |

## Architecture

- `ai/` に VS Code Agent が読む Skill と指示を置き、構文の参照コピーは canonical `docs/specs/guitardsl-syntax.md` から生成する。参照コピーを手編集しない。
- `src/ai/tools.ts` は既存 domain API への薄いアダプターである。パース、カポ、初心者モード、移調、伴奏などの変換ロジックはそれぞれの domain module が所有する。
- VS Code が Agent / Chat、モデル選択、会話、tool invocation を提供する。拡張機能は独自モデル呼び出し、chat participant、custom agent、AI Webview、MCP server を追加しない。
- 公開 tool は仕様で定義された7つに限る。YouTube / Audio MIR 採譜は AI tool surface に含めない。
- 伴奏 preset の唯一のカタログは `src/strummingPatterns.ts`、伴奏ロジックは `src/accompaniment.ts` に置く。

| tool | 主な責務 | 文書変更 |
|---|---|---|
| `guitardsl_validate_dsl` | Compiler 診断を返す | なし |
| `guitardsl_analyze_playability` | カポ候補・弾きやすさを返す | なし |
| `guitardsl_apply_capo` | 既存カポ変換を適用 | あり |
| `guitardsl_apply_beginner_mode` | 既存初心者モード変換を適用 | あり |
| `guitardsl_apply_transpose` | 実音移調を適用 | あり |
| `guitardsl_analyze_accompaniment` | 伴奏エンジンの分析結果を返す | なし |
| `guitardsl_apply_accompaniment` | 検証済み伴奏計画を適用 | あり |

## Data flow and ownership

1. VS Code Agent が Skill / instruction を読み、選択した TextDocument を tool adapter に渡す。
2. 読み取り専用 tool は明示 `path` があればその絶対パスだけを開き、省略時はアクティブ → 表示中 → 最後にアクティブ → 開いている GuitarDSL 文書の順に解決する。変更 tool は `uri` と `path` のどちらか一つを必須とし、その入力だけで対象を固定する。
3. `prepareInvocation` の処理は tool 種別で異なる。読み取り専用 tool は明示 `path` がない場合、`targetLabel()` が現在の editor / document state を参照して進捗表示用ラベルを作ることがあるが、ラベル作成のために文書を開いたり変更したりしない。実際の読み取り対象は `invoke` が文書解決規則に従ってあらためて解決する。変更 tool は `prepareMutation()` が明示された `uri` または絶対 `path` と操作入力だけから確認対象・操作を構成する。この処理は副作用がなく、エディター状態を参照しない。VS Code が確認操作を許可した後、変更 tool の `invoke` はその明示対象だけを解決して編集し、deterministic domain API に処理を委譲する。
4. 読み取り結果または構造化された計画・診断を JSON テキストとして返す。失敗も `ok: false` と tool 固有 code で表す。
5. 変更 tool は実行時点の最新ソースから変換を計算し、成功時は一つの取り消し可能な編集を適用して再検証する。変換後 DSL 全文は返さず、任意のモデル生成テキストを置換として受け取らない。
6. 伴奏適用の唯一の入力例外は、エンジンが検証する一小節分の rhythm DSL plan である。適用は `MeasureData.rhythmSource` のソース範囲に限り、コード、歌詞、`%` の展開結果を変更しない。

新曲作成の指示は、新しく確立した文書へ対象を固定し、validate → analyze → apply → validate の順に tool を使わせる。既存文書を編集する際にのみ、読み取り tool の暗黙解決を使用できる。

読み取り専用 tool の `prepareInvocation` は、`path` 省略時に進捗ラベルのためだけにエディター状態を参照でき、実際の読み取り対象は `invoke` で再解決する。変更 tool の `prepareInvocation` は明示入力だけから副作用なしに確認文を構成し、`invoke` は同じ `uri` / `path` が指定する対象だけを編集する。モデル処理の所有者は VS Code、文書テキストの所有者は VS Code TextDocument、音楽・構文変換の所有者は deterministic domain module である。

## Failure handling

対象文書が一意に決まらない、入力 DSL / 対象範囲が不正、変換計画がドメイン制約を満たさない場合は、tool ごとの構造化エラーまたは警告を返し、黙って別文書や別プリセットへフォールバックしない。Tool の詳細コード、引数、戻り値の規範は §8.3–§8.7 を優先する。

変更 tool は同じ文書に対して同時に一つだけ実行する。編集中の競合は `documentBusy`、入力の不備は `invalidInput`、対象文書の不在は `documentNotFound` として返し、失敗・キャンセル時は文書を変更しない。編集を始めた後に補正用の二度目の編集を行わない。

## Alternatives considered

現在の設計は VS Code の標準 Agent / Chat と既存 domain API を利用する。独自 chat participant、agent runtime、MCP server、モデル API 呼び出しを設ける代替は本仕様の境界外であり、その比較を本書で新たに決定しない。

## Verification strategy

`tests/unit/aiTools.test.ts` と AI asset 検査を参照する。`npm run check:ai` は tool 宣言と生成参照資産を含む契約を検証する。構造・所有リンクは `validate-docs` で確認する。
