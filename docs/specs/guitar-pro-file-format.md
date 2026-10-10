<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# Guitar Pro GPIF ファイル形式仕様

- Status: Current
- Owning Issue: [Issue #97](https://github.com/puchinya/vscode-guitar-dsl/issues/97)
- Related specification: [拡張機能仕様 §3.15](extension.md#315-guitardslimportguitarpro), [GuitarDSL TAB 歌詞仕様](guitardsl-syntax.md#19-ギター-tab-guitar-tablature)
- Related design: [Guitar Pro 7/8 interchange](../design/gp78-interchange.md)

## Purpose

この文書は、Guitar Pro 7/8 の `.gp` インポートで扱う GPIF の構造と意味の対応を定める。コマンドの起動方法、トラック選択、loss の確認、キャンセル時の動作は [拡張機能仕様 §3.15](extension.md#315-guitardslimportguitarpro) が定める。

## Scope

ここに記録する具体的な要素配置と件数は、分析済みの GP8.1.5 ファイルで観測した wire format である。件数や任意要素の有無を、すべての GP8 ファイルに共通する固定値とはみなさない。未対応バージョンや意味を安全に変換できない選択トラックは、推測で読み替えない。

## Security and privacy

ZIP entry はファイルシステムへ展開せず、入力サイズ・参照・XML構造の境界を検証する。アーカイブ由来のパスを保存先として使用しない。

### Container and version

- `.gp` は ZIP コンテナとして読み、譜面データは `Content/score.gpif` から取得する。存在する場合は `Content/PartConfiguration` も読み、譜表の表示種別を決める。読み込み時に ZIP entry をファイルシステムへ展開しない。
- 対応する GP 世代は `Content/score.gpif` 内の `GPIF/GPVersion` で判定する。ZIP 内の `VERSION` entry は GPIF の世代判定の根拠にしない。
- `Content/PartConfiguration` の `standard`、`tablature` などの設定は、譜面ノートの読み方に適用する。GPIF の note に TAB 位置プロパティが存在するだけでTAB表示と判断しない。
- GP7/GP8 はインポート対象とする。GP3–6、`.gpx`、GP9 以降、または世代を確定できない入力は拒否する。
- ZIP の境界、XML の安全な解析、サイズ上限の規範は [拡張機能仕様 §3.15](extension.md#315-guitardslimportguitarpro) と [内部設計](../design/gp78-interchange.md) に従う。

## Normative requirements

### GPIF reference structure

GPIF の譜面要素は、親配列の位置だけで結び付けず、ID の宣言と参照を解決して読む。小節・声部・音符の時間順序は、以下の参照リストに現れる順で保つ。

| 参照元 | 解決先 | 意味 |
|---|---|---|
| `MasterBars/MasterBar/Bars` | `Bars/Bar` | そのマスターバーに属する譜表ごとの小節 |
| `Bars/Bar/Voices` | `Voices/Voice` | 小節内の声部 |
| `Voices/Voice/Beats` | `Beats/Beat` | 声部内の時間順の拍イベント |
| `Beats/Beat/Notes` | `Notes/Note` | 拍イベントに属する音符 |
| `Beats/Beat/Rhythm` | `Rhythms/Rhythm` | 拍イベントの音価 |

`MasterBars`、`Bars`、`Voices`、`Beats`、`Notes`、`Rhythms` は要素定義を保持し、上表の子要素は ID 参照として解決する。ID が重複する、参照先がない、または参照順を保てない場合は読み込みエラーとし、配列位置や既定値で補わない。

`MasterBar/DoubleBar` は `InterchangeMeasure.barline.doubleEnd` に対応させる。`MasterBar/Section/Text` は `InterchangeMeasure.sectionStart` に対応させ、異なる `Section/Letter` は表示用の別フィールドがないため `gp78.omit-section-letter.v1` policy の non-blocking loss として報告する。`FreeTime` は固定拍子の IR で表せず、非空の `Fermatas` は IR v1 の対応先がないため、いずれも該当する MasterBar の GPIF path を示してインポートを失敗させる。

`Content/PartConfiguration` に複数の score view がある場合、選択トラックの `standard` / `tablature` / `slash` / `numbered` flags が複数の view に定義され、その値が異なれば、インポーターは末尾の active-view 値を使って譜表を選ばず、未対応意味論として失敗させる。選択トラックの設定が存在しない view や非選択トラックの差異は、選択トラックの解釈に影響しない。選択トラックの設定がある view 間で flags が同じ場合は、音符解釈が同じなので読み込みを続ける。

TAB ノート位置数を P とする。既存の GPIF XML element 上限（100万）が P を制限し、TAB の同一弦・次拍リンク解決は O(P) 時間・O(P) 補助メモリで行う。各ノートから全ノート位置を再走査しない。20,000位置のストレス回帰で同一弦リンクを検証する。

1つの `Beat/Notes` に複数の Note ID がある場合、その Notes は同時に鳴るpitch groupとして扱う。ID ごとに別々の時間イベントや lyric slot として連続配置しない。標準譜表では1 Beat のpitch groupを1つの五線音符イベントへ対応させる。

GPIF `Notes/Note/Tie` の `origin` と `destination` は Boolean 属性で tie の開始側・継続側を示す。1つのpitch groupを構成するNote間でtie状態が異なる場合や、次のpitch groupに同じpitch集合の対応先がない場合は、tieを推測せず読み込みエラーにする。成立するtieは GuitarDSL のgroup全体に対するtieとして保ち、構成音の記述順によらずpitch集合を対応付ける。

有効な `Rhythm` 参照があり、`Notes`、`Rest`、`Chord` を持たない `Beat` は、音価を持つ無音イベントとして扱う。選択譜表に応じた GuitarDSL の休符へ変換し、音符attackや歌詞slotは作らない。Rhythm参照の欠落・未解決や、未対応の追加要素がある場合は休符と推測せず読み込みエラーにする。

標準譜表の `ConcertPitch/Pitch/Accidental` が `x` の場合、これはdouble sharpを表す。GuitarDSLは単一の `#` / `b` のみを表せるため、異名同音の単一臨時記号へ正規化し、実音高を保つ。音名の綴りが変わる場合は `gp78.normalize-double-accidental.v1` policy のnonblocking `droppedByPolicy` lossを選択トラックにつき1件報告する。`TransposedPitch` も同じ正規化を適用してから、concert pitchより1オクターブ高いことを検証する。対応できない臨時記号や音域は読み込みエラーとする。

## Observable behavior

### GP8.1.5 observed structure

分析した GP8.1.5 ファイルでは、`Content/PartConfiguration` は `standard=true`、`tablature=false`、`slash=true`、`numbered=false` を示していた。歌詞データは独立した全曲歌詞表ではなく、対象イベントの `Beats/Beat` の子要素として次の形で保持されていた。

同ファイルの `Content/PartConfiguration` は score view が2つあり、両 view のトラック表示 flags は同じで、末尾の32-bit値は `1` だった。この観測だけでは選択トラックの flags が異なる score view に対する active-view 値の選択規則を確定できないため、該当する選択トラックの差異は推測せず拒否する。

```xml
<Beats>
  <Beat id="...">
    <Lyrics>
      <Line>...</Line>
      <Line>...</Line>
    </Lyrics>
  </Beat>
</Beats>
```

`Voice/Beats` が参照する Beat のイベント位置が歌詞の時間位置を決め、`Lyrics/Line` の順序が verse の順序を決める。XML の空白表現や要素の省略を、歌詞本文として追加してはならない。

分析対象の GP8.1.5 ファイルでは、37 個の master bar、61 個の `Beat`、91 個の `Note` 定義があり、59 個の Beat が複数の Note ID を参照していた。56 個の Note に `Tie` があり、28 個が `origin=true`、28 個が `destination=true` だった。9 個の Beat に `Lyrics` があり、各 `Lyrics` には 5 個の `Line` 要素があった。先頭行に本文が存在し、後続 4 行は空だった。3 個の `Note/ConcertPitch/Pitch/Accidental` は `x` だった。件数、設定値、tie と空行の配置はこのファイルでの観測値であり、GP8.1.5 全般の必須構造ではない。

同じファイルには、`<Rhythm ref="0"/>` を持ちながら `Notes`、`Rest`、`Chord` を持たない `Beat` もあった。`Rhythms/Rhythm[id="0"]` は `<NoteValue>Quarter</NoteValue>` を示す。このBeat定義は4/4小節の末尾イベントとして2回参照され、どちらも `Dynamic=MF` と `PrimaryPickupVolume` / `PrimaryPickupTone` の `Float=0.500000` を持っていた。これはこのファイルでの観測値であり、IDや出現回数を固定仕様とはしない。

この無音Beatの `Rhythm` は小節内の時間を占めるため、インポートでは参照音価を保つ休符へ対応させる。休符は新しい歌詞slotを消費しない。`PrimaryPickupVolume` と `PrimaryPickupTone` は音声・演奏設定であり、GuitarDSL の音符や歌詞位置には変換しない。

同じ分析ファイルの末尾には、`MasterBar/Bars` から `Bar`、`Bar/Voices` から `Voice` への参照はあるが、その Voice の `Beats` 参照が空の小節が1つあった。これは37小節目として保持する完全な無内容小節である。インポートでは `| N.C. |` に対応させ、休符・音符attack・コード・歌詞slotを作らない。再インポート時も小節数を保つ。この配置は分析対象での観測であり、すべての GPIF に必須ではない。

## 5. 歌詞の GuitarDSL への対応

- 各 `Lyrics/Line` は verse 順を保って読み、本文を該当する譜面イベントの lyric slot に対応させる。1つの `Line` 本文は1つの lyric slot として扱い、文字単位に分割しない。
- 歌詞は TAB の音符 attack または標準譜表の Beat pitch group に割り当てる。標準譜表ではtie継続側も独立した歌詞slotを持つ。TABのtie継続beatと休符・無音Beatにはslotがなく、本文が割り当てられている場合は位置を推測せずエラーにする。
- ある verse の途中に空 slot があり、その後に本文が続く場合は、attack 位置を基準に skip として保持する。本文のない末尾 slot は出力しない。
- 選択トラック全体で本文が一度も現れない末尾 `Line` 行は verse として生成しない。したがって、観測例の空の後続 4 行から空 verse を4つ作らない。
- 本文、verse 順、attack 位置を GuitarDSL で表現できない場合はインポートを失敗させ、黙って省略・移動・書き換えをしない。
- 生成した GuitarDSL は通常のパーサーで検査し、error diagnostic が0件の場合だけ文書として開く。

GuitarDSL の lyric slot と TAB attack の詳細な記法は [言語構文仕様 §19](guitardsl-syntax.md#19-ギター-tab-guitar-tablature) に従う。

## Error and boundary behavior

適合するインポーターは、ZIP/XML/GPIF の上限と参照を検証し、選択トラックの歌詞本文・verse 順・slot 位置を保ち、未知または表現不能な意味を成功扱いしない。GP7 形式のサポートは維持するが、GP7 公式アプリを用いた互換性確認は本 Issue の受入条件に含めない。GP8 の公式アプリ確認と、自動化した GP7/GP8 fixture 検証は [Issue #97 の設計・証拠](../design/gp78-interchange.md) に記録する。

## Verification strategy

GPIF の参照・意味対応は本書の fixture matrix と [互換性証拠](../status/evidence/issue-97/compatibility-matrix.md) に従って検証する。コマンド動作と loss 確認は [拡張機能仕様 §3.15](extension.md#315-guitardslimportguitarpro) に従う。
