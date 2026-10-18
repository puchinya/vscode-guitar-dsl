# Implementation Contract — 弾き語り奏法ガイドとリズム符 DSL 拡張

**State:** ユーザー承認済みの要求・設計。実装・検証は未実施。空振りは対象外。  
**関連:** #83 (roadmap), #90 (playback), #93 (Practice), #101 (伴奏パターン), #142 (リズムタイ), #150 (現行GUI仕様)。  
**SVGデザイン原案（現行mainのGUI仕様を置き換えるものではない）**  
- [メロディ表示 ON — SVG](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-153-practice-guide-design-assets/docs/specs/gui_design/proposals/issue-153/practice-guide-melody-on.svg)
- [メロディ表示 OFF — SVG](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-153-practice-guide-design-assets/docs/specs/gui_design/proposals/issue-153/practice-guide-melody-off.svg)
- どちらも既存Previewの再生・楽譜設定・Practice行を保持。下部固定ガイドの表示順と奏法を確定する構造参照。実装完了時に実アプリのライト/ダーク画面と比較すること。

![Issue #153 弾き語り練習ガイド（メロディ表示ON）](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-153-practice-guide-design-assets/docs/specs/gui_design/proposals/issue-153/practice-guide-melody-on.svg)

![Issue #153 弾き語り練習ガイド（メロディ表示OFF）](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-153-practice-guide-design-assets/docs/specs/gui_design/proposals/issue-153/practice-guide-melody-off.svg)

**[契約Markdown（Issueに登録した実装指示書）](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-153-practice-guide-design-assets/docs/specs/gui_design/proposals/issue-153/implementation-contract.md)**  

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

| Repository basis | 確認済みの事実・保持事項 |
|---|---|
| `docs/specs/guitardsl-syntax.md` §8.1–8.7, §16, §17, §19 | 音価`<duration>.<modifier>`、`rN`、`.d/.u/.g/.pm/.arp/.t`、連符・加算・Fraction拍数・タイ・`let`・`%`・TAB は実装済み。`g/ghost` はブラッシングとして規定 |
| `docs/specs/extension.md` §§4.2,4.6 および `docs/specs/gui_design.md` §2.3 | Preview既存の48px再生行→44px楽譜設定行→Practice ON時42px操作行の順序を保持。譜面とPDFの共通SVG経路、既存Practiceを維持 |
| `docs/design/language-and-score-processing.md` / `preview-rendering-and-export.md` | コンパイラがスコアイベントを所有。タイムラインは再生順 `occurrence` とscore時刻を所有。Preview Webview が音源・transport・cleanupを所有 |
| `src/compiler.ts::RhythmItem`, `MeasureData.rhythmOrigin`, `parseRhythmToken`, `defaultRhythms` | 明示/補完/repeat の区別がある。現行 `parseRhythmToken` は一部未知修飾子を黙殺できるため診断追加が必須 |
| `src/duration.ts::parseRhythmDurationDetailed` | 複合・連符の厳密なFraction音価を使う。新しい音価パーサーを作らない |
| `src/playbackTimeline.ts::PlaybackEvent`, `buildPlaybackTimeline` | 現在は pitched / rhythmAttack / rest / metronome とタイ再アタック補正。新奏法を表せるイベント種別がまだない |
| `src/render/previewHtml.ts::scheduleTone`, `schedulePlaybackEvent` | WebAudio合成と声部解放。直前の音が音価末尾で消える場合があり、停止イベントの実音効果を検証する必要がある |
| `src/chordVoicingResolver.ts::resolveChordVoicing`, `src/instrumentModel.ts::InstrumentModel.pitchAt` | 物理ギター弦の音高はフォーム/調弦/カポから決定。表示専用の仮コード図や`chordToMidiNotes`（一般コード音）は単弦の根拠にならない |
| `src/accompaniment.ts::formatRhythms`, `src/strummingPatterns.ts::parseRhythmPattern` | 正規伴奏プリセット58件と整形出力を維持 |
| `docs/status/implementation-status.md`, `docs/agents/testing.md`, `.agent/project.json`, `AGENTS.md` | 現行 status、unit/E2E・Help/AI同期、workflow・milestone・PR gate の根拠 |

## 2. Architecture Decisions

### 2.1 ユーザー承認済みの表示・DSL意味

| 練習画面 | ソース DSL | 意味 |
|---|---|---|
| `↓` / `↑` | `8.d` / `8.u` | 方向付き有音ストローク（既存） |
| `〜` | **追加トークンなし** | 前の有音リズム符の**記譜音価・タイによる継続**。右手の空振りではない |
| `・` | **`8.m`** | 伴奏の既発音を消音。新しい発音はしない |
| 音価に応じた休符 | `r8` | 新しい発音なし。暗黙の消音はしない |
| `×↓` / `×↑` | **`8.d.b` / `8.u.b`** | 打音のあるブラッシング。`b=brush` は既存 `g/ghost` のエイリアス |
| `PM↓` / `PM↑` | `8.d.pm` / `8.u.pm` | 弾きながら減衰させるパームミュート（既存） |
| `1`～`6` | **`8.s1`～`8.s6`** | 指定弦1本を、現在位置の有効コードフォームから弾く。既存`.arp`（アルペジアート）と別 |

### 2.2 全曲表示グリッド

**必ず全小節を走査して、全曲で一つの基本表示分割（4分／8分／16分）を決める。** 現在の小節・セクション・スクロール範囲・Loop範囲では決めない。

- `ParsedScore.measures` の**全小節**から、明示リズム（`rhythmOrigin=explicit`）、`%`の解決済み反復、`let`の使用分を対象に、イベントの開始/終端Fractionと音価を収集する。未使用`let`、メロディ、BPM、暗黙の補完リズムは判定材料にしない。
- 明示リズムがないTAB-only小節ではTAB音価を参照する。明示リズムとTABの併存小節では奏法行は明示リズム優先（TABと二重発音・二重ガイドにしない）。
- **16分が1小節にでも必要なら全曲16分**、それ以外で8分が必要なら全曲8分、4分までなら全曲4分。例: サビに`16.d`が一つあればイントロの`8.d`も`↓ 〜`、`4.d`は`↓ 〜 〜 〜`。
- 三連符・一般連符はその区間だけ正確なFraction比で局所分割。全曲を巨大な最小公倍数グリッドにしない。弱起、6/8など拍子変更は小節幅・局所グループを変えるだけで基本分割の全曲統一を崩さない。
- 一つも明示リズム/TABがなければ基本4分とし、ガイドは**「自動補完」**と明示する。手動上書き（4/8/16）は表示専用のPreview文書別一時設定、既定は`自動（全曲）`。上書きでDSLやPlaybackTimelineを変更しない。
- 全曲判定はソース/有効DSL更新時に再実行し一括更新。Seek・Loop・速度変更では再判定しない。Fraction解決不能な小節は判定不能を明示し、古い別曲状態を流用しない。

### 2.3 `〜` / 消音 / 休符の境界

- 有音トークン開始位置にはストローク記号・弦番号（方向なしなら中立記号）、残りの**記譜継続スロット**には`〜`。正当な`.t`の継続トークンも`〜`とし再アタックしない。
- `〜`は新規DSLトークン・別攻撃・右手空振り・自然減衰波形の振幅を意味しない。**音価に対応した視覚化のみ**。スタッカート、ブラッシングなど短音・打音は無条件に`〜`を埋めない。
- `.m`の開始位置に`・`、`rN`には音価別休符、残りの占有区間に`〜`は置かない。消音は即時、存在音がなければno-op。連続`.m`も合法。休符は直前のギター音の停止を指示しない。
- `.m`は**同じギター伴奏バス**の現在発音中・release tailの声部だけを消音。メロディ、メトロノーム、他のセッションを止めない。同時刻イベントの処理順は消音→新発音。クリック防止フェードは実時間で最大8msを推奨。
- `src/render/previewHtml.ts` 現行音源では音価末に既にゼロになる場合がある。新奏法を含む伴奏音源では最大120ms程度の短いrelease tailを設けて`.m`が尾部を停止できるようにする。**新奏法がない既存譜面の音響包絡は不変**。スケジューリング・Stop/Seek/Loop/再構築/速度変更で旧generationの声部を解放する。
- `.b`/`.g` は打音を生む（harmonic chord presentationではない）。既存の`.g`で音響が普通のコード発音になっている場合は仕様に合わせて打音へ改め、音色変化をテストで記録する。

### 2.4 変更しない所有権・禁止する設計

- TextEditorがDSLとUndo、Compilerが解析/診断、PlaybackTimelineが演奏順イベント、既存Preview Webviewがtransport/WebAudio、既存Inspectorが明示Applyの所有者。**新しいWebview、AudioContext、伴奏言語、編集所有者を作らない。**
- 練習表示データは**既存Compilerイベントからの純粋な投影モデル**として構築し、独立した記譜イベント／音源イベントの権威にしない。Previewの固定操作列と通常譜面SVG/PDFの共有経路を維持。
- `tab:`と`.sN`の共存により新しい多声部音響を暗黙に生成しない。同時複数弦/独立リズム声部/ラスゲアード/空振りDSLは別要件。
- 意味を保持できないGP7/8等外部出力は、黙ってコード攻撃へ置換せず**unsupported**として安全に失敗する。

## 3. Exact Change Set

| 主な対象 | 必須変更 |
|---|---|
| `docs/specs/guitardsl-syntax.md` §8、§16、§17、§19 | `.m`, `.b`(=`.g`), `.s1`～`.s6`、禁止組合せと厳密Fraction時刻、継続/休符/消音の意味を追加 |
| `docs/specs/extension.md` §4.2、§4.6 と `docs/specs/gui_design.md` §2.3 | 固定下部ガイドと全曲分割、歌詞・メロディ・奏法・コード・コード図、次コード欄の振舞い。**既存 Preview 上部48/44/42pxを維持** |
| `docs/design/language-and-score-processing.md` / `preview-rendering-and-export.md` / `score-editing.md` | イベントモデル、タイ・Fraction投影、音声停止/Voice寿命、Preview状態、コードフォーム解決を明文化 |
| `src/compiler.ts::RhythmItem`, `parseRhythmToken`、タイ検証、diagnostics | `mute?:true`, `pickString?:GuitarString` を保持。`.b`は`ghost`へ正規化。`.m`/弦別/休符/タイの排他を位置付き診断。**未知修飾子は黙殺せずerror** |
| `src/playbackTimeline.ts::PlaybackEvent`, `buildPlaybackTimeline` | `rhythmMute`, `rhythmBrush`, `rhythmStringAttack`のtyped eventを追加。`rest`/既存rhythmAttack/タイの意味を保持。全てoccurrence時刻基準 |
| `src/chordVoicingResolver.ts`, `src/instrumentModel.ts`（呼出側中心） | `resolveChordVoicing`の押弦・`InstrumentModel.pitchAt`から弦音高を取得。ミュート弦、未解決フォーム、コードなし、範囲外はエラー（勝手に別弦にしない） |
| `src/render/previewHtml.ts`, `src/playbackSynth.ts` | 伴奏バス声部/消音/打音/単弦発音をスケジュール。generation・Loop・Seek・速度変更と資源解放を保持。新音源の独立所有権を作らない |
| `src/accompaniment.ts`, `src/strummingPatterns.ts` | `.m`=attack無し、`.b/.g`=percussive attack（non-harmonic）、`.sN`=単弦attack。正規プリセット58件と既存書式化の`.g`を維持。ソース保持編集では`.b`入力を保持 |
| `src/render/notation.ts`, `src/render/svg.ts`とPractice UI描画 | 通常Preview/PDFは同じ記譜SVG。新奏法の意味が分かる注記。`〜`は**固定練習パネルのみ**。グリッドと各元イベントへのsource spanを保持 |
| `src/gp78/`およびInterchange変換 | 新奏法のロスレス対応を確認。不可なら書出し前にunsupportedを返し既存出力を破壊しない |
| `src/i18n.ts`, `syntaxes/`, completion/hover/code actions関連、`docs/help/`, `docs/help/help-manifest.json`, `docs/status/implementation-status.md` | 文法支援/ローカライズ/ヘルプ/生成AI参照/実装状態の同期。既存未変更文書を機械的に書換えない |
| `tests/unit/`, `tests/e2e/` | §7の反例とGUI・時間境界テスト、ライト/ダークと日本語/英語画像証拠 |

### 修飾子の正確な許容範囲

- `.m`: **他の修飾子と併用しない**。例`8.m`のみ。`r8.m`, `8.d.m`, `8.m.pm`, `8.m.t`はerror。
- `.s1`～`.s6`: 一つだけ。任意の`.a`と併用可。方向`.d/.u`、他の`.sN`、`.arp`、`.t`、`.pm`は初期仕様ではerror。
- `.b`: `.g/.ghost`と同一の既存ghost意味。`.b.g`など重複指定はerror。`.d.b`/`.u.b`は合法。ソース保持編集では入力スペルを保持、生成パターンの既存正規出力は`.g`を維持。
- 既存修飾子の今まで合法な組合せを、このIssueの新規排他で一律禁止しない。unknownは`invalidTechnique`相当の位置付きerrorとして扱い、silent fallbackしない。

## 4. Implementation Sequence

1. Issue合意と現行masterとの差分確認 → `specs` (syntax/extension/gui) に受入規則を追加。
2. `design`に所有権・typed event・Fraction全曲判定・voice cleanup を記録。
3. Compilerとパターン解析/整形、コードフォーム・弦音高と診断を実装。
4. PlaybackTimelineとWebAudioのブラッシング/単弦/消音、タイ/Loop/Seek/停止の順序を実装。
5. 全小節を入力とする純粋なGuide projection → 固定Practice UI、任意メロディ・歌詞・コード図・次コードへ反映。最初にSVGプロトタイプとの視覚差分を確認。
6. Converter安全性、Help（日英）・AI参照生成・status・unit/E2E・画像証拠を完成。
7. 自己レビュー → verification → commit/push → **`Closes #<issue-number>`付きPR作成** → 必須Issue/PR review stateへ遷移。

## 5. Required Runtime Semantics

- **Normal:** 1スコア全小節を走査→基本分割決定→各イベントをFraction拍位置に配置→記号＋必要スロットの`〜`描画→同じscore timeで音声同期。
- **Repeat/Pickup/Meter/Tuplet:** 再生順は既存play order、タイの再アタック規則を維持。画面ガイドに時間丸めを持ち込まない。
- **Missing data:** 自動補完と明示入力を識別。未解決単弦は位置付きerrorにし、コード全体へのフォールバック発音禁止。
- **Invalid input:** 未知や違反修飾子を通常有音イベントとして実行せず、診断と安全な表示を行う。
- **Seek/Loop/speed/pause/stop/rebuild/dispose:** 声部は既存Webviewオーナーが保持、旧generationをcancel/fadeし二重音や残留イベントなし。繰返し・loop折返しに無音イベントの二重適用なし。複数回disposeは安全。
- **Compatibility:** `.g/.ghost`、`.pm`、`.arp`、`let`、`%`、TAB、メロディの既存意味を維持。既存ファイルの音声包絡変更はブラッシング音色の仕様修正以外に持ち込まない。

## 6. Non-goals / Forbidden Changes

- 空振りの自動描画、`.air`の追加、`〜`＝休符/空振りという解釈。
- 別の伴奏言語、独立Webview/音源、既存Inspector/Preview ownership変更。
- TABの多声部化、正確なギター物理モデル、ピッチ未指定の補完で弦番号を音高に見立てる方式。
- MIDI/Guitar Pro変換で新奏法の意味をサイレントに喪失すること。
- unrelated GUI、既存フラグメント/タイ/休符の再設計。

## 7. Concrete Tests

| ID | Setup → action | Expected |
|---|---|---|
| T01 | Introが8分のみ・Chorusに16分1個 → 全曲表示 | **全小節16分**、Introの`8.d`は`↓〜`、Verseの`4.d`は`↓〜〜〜` |
| T02 | Chorusの唯一16分を削除／LoopをIntroだけ設定 | 前者は**全小節8分へ一括再判定**、後者は16分のままでsource不変 |
| T03 | 未使用`let`に16分、暗黙リズムに4分 | 使用中の明示8分までで判定。未使用定義/暗黙補完が密度を変えない |
| T04 | 6/8と途中`@time`、8分3連/5連、pickup | 全曲基本密度と局所Fraction分割を維持、オンセット丸め/余分な音なし |
| T05 | `8.d`と`4.d`、16分全曲グリッド | `↓〜` / `↓〜〜〜`、発音回数は各1 |
| T06 | `8.d.t 8`（合法な同一コード） | `↓〜〜〜`で再アタックなし。無効/跨ぎ境界は既存診断と再生ルール |
| T07 | `4.d 4.m` vs `4.d r4` | 両者は次の発音無しだが、前者だけrelease尾部を停止。メロディ・メトロノーム不変 |
| T08 | `8.d.b`,`8.u.b`,`8.d.g`,`8.d.pm` | ブラッシングは打音、PMは有音、`.g`との意味等価、正規プリセット58件回帰 |
| T09 | `8.s5` と実フォーム / カポ / Drop D | 5弦の1音だけ、実音高がフォームに一致。TABと二重ガイドなし |
| T10 | Cフォームの6弦x、未解決フォーム、コードなしに`8.s6` | フォールバック発音せずソース位置付きerror |
| T11 | `8.foo`,`r8.m`,`8.d.m`,`8.b.g`,`8.s2.s3`,`8.s2.pm` | すべて位置付きerror、通常コード攻撃の誤発音なし |
| T12 | `let`/`%`/小節コード切替と反復・volta | 正しい有効コードとsource span、再生順/ガイド時刻一致 |
| T13 | Seek、A/B Loop、速度変更、Pause/Stop、文書切替、Panel Drop | 旧generation声部が残らない。音声停止作用が別セッションへ漏れない |
| T14 | 新奏法を含むGP出力と編集Undo | 表現できない場合はunsupportedで非破壊。GUI編集は元トークンに1回のUndo |
| T15 | メロディON/OFF、日英、ライト/ダーク、幅421/600/840/1100px | メロディ→歌詞→奏法→コード名→コード図、右側次コード。既存固定操作と譜面を欠損させない |

## 8. Verification

- `npm run compile`
- `npm run test:unit`
- `npm run check:help`
- `npm run check:ai`
- `npm test`（VS Code/Electron E2E は **sandbox外**、macOSは必要に応じて`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm test`）
- `npm run vscode:prepublish`
- `npx @vscode/vsce ls`
- `python -m agent_workflow validate-docs --issue <issue-number>`（プラグイン環境で実行）
- `git diff --check`、SVG XML parse・実レンダリング目視・Issueへ実画面の画像証拠を投稿。
- 未検証OS/VoiceOver/実音声出力はPASSと書かず、NOT RUNを明記。

## 9. Reviewer Checklist (実装前固定)

- [ ] C01: `.m/.b/.sN` / 既存`.g`互換と厳密なmodifier診断
- [ ] C02: 全小節走査・全曲基本分割の統一、`let/%`とTAB/暗黙リズム境界
- [ ] C03: `〜`は**伸長のみ**、消音・休符・空振りと取り違えない
- [ ] C04: タイ・連符・弱起・変拍子・BPM・repeatでスコア時刻が一致
- [ ] C05: 伴奏停止、打音、指定1弦発音、フォーム/調弦/カポ一致
- [ ] C06: Voice lifetime、Seek/Loop/speed/Stop/Disposeのcleanupと非漏洩
- [ ] C07: Preview固定操作/楽譜と下部ガイドの視認性、メロディON/OFF、次コード
- [ ] C08: 普通のPreview/PDF、`let/%`、TAB、プリセット58件、ソース保持編集の回帰
- [ ] C09: GP不可逆輸出の拒否、Help/AI/grammar/diagnostics/statusの同期
- [ ] C10: 全検証・実画像証拠・自己レビュー・**commit/push/PR（Closes #本Issue）**・review state

## 10. Completion Report

必須報告: **変更ファイル、C01–C10の自己レビュー結果、各テストコマンドとPASS/FAIL/NOT RUN、実画面画像リンク、未検証プラットフォーム、契約逸脱/差分・ブロッカー、残課題、commit SHA、branch、`Closes #<issue-number>`を含むPR URL、Issue/PR review phase**。

Issue作成やSVG原案の登録だけで実装完了としない。PR作成/Review遷移が認証・権限・branch制約で阻まれた場合は具体的なコマンド/エラーを記録して **BLOCKED** と報告する。

## Document impact

- **Specification:** `docs/specs/guitardsl-syntax.md`、`docs/specs/extension.md`、`docs/specs/gui_design.md`
- **Design:** `docs/design/language-and-score-processing.md`、`docs/design/preview-rendering-and-export.md`、`docs/design/score-editing.md`
- **Testing:** `tests/unit/`、`tests/e2e/`（具体的ケースは上記§7）
- **Status:** `docs/status/implementation-status.md`
