<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# GUI 画面仕様書 (GuitarDSL GUI Screen Specification)

- Status: Current
- Owning Issue: [Issue #150](https://github.com/puchinya/vscode-guitar-dsl/issues/150)
- Related Issue: [Issue #137](https://github.com/puchinya/vscode-guitar-dsl/issues/137)
- Related Issue: [Issue #158](https://github.com/puchinya/vscode-guitar-dsl/issues/158)
- Related specification: [拡張機能仕様](extension.md)

## Purpose

本書は、GuitarDSL 拡張機能が独自に表示する現行画面の構成、要素の順序、代表状態を規定する。各画面の全表示内容を独立した SVG に描き、図中の数値と文言はその画面状態を説明するサンプル値とする。

## Scope

対象は GuitarDSL のサイドバー、Preview、Inspector、コード図エディタ、YouTube 採譜パネルである。VS Code のタイトルバー、アクティビティバー、標準サイドバー、ステータスバー、ブラウザー外枠など、対象画面ではない周辺 UI は図に含めない。VS Code 標準の Quick Pick、Input Box、ファイルダイアログ、通常のテキストエディタも独立した画面図にはしない。

各 SVG は対象画面だけを描く独立したベクター図であり、スクリーンショットを貼り込んだものではない。矩形、線、パス、円、文字などで画面を表現する。画面内に縦スクロールがある場合は、図の高さをスクロール内容の末尾まで延ばして、その代表状態の全項目・全操作を含める。横幅からはみ出す操作列も図の幅に含める。表示領域の端で対象要素を切らない。

表の幅と高さは SVG の出力寸法を示す。これは VS Code の固定ウィンドウ寸法や Webview の CSS 寸法を規定するものではない。Preview の譜面、候補値、文書依存の表示はサンプル文書に対する代表状態であり、任意長の文書や実行中の全状態を固定するものではない。テーマ色は現在の代表表示に合わせた例であり、テーマ選択の規範ではない。

## 画面一覧

| 画面 | SVG | 出力寸法 | 図に含める表示内容の末尾 |
|---|---|---:|---|
| サイドバー・開始時 | [sidebar-start-here.svg](gui_design/sidebar-start-here.svg) | 300 × 390 px | 対象なしと「ヘルプ」区分 |
| サイドバー・GuitarDSL ファイル選択時 | [sidebar-current-file.svg](gui_design/sidebar-current-file.svg) | 300 × 382 px | GuitarDSL ヘルプを見る項目 |
| Preview・ページ表示 | [preview-paged.svg](gui_design/preview-paged.svg) | 640 × 930 px | 楽譜ページ下端とページ番号 1/1 |
| Preview・連続表示 | [preview-continuous.svg](gui_design/preview-continuous.svg) | 640 × 560 px | サンプル譜面の2段目の五線譜 |
| Preview・Practice 有効 | [preview-practice.svg](gui_design/preview-practice.svg) | 640 × 650 px | 練習行、2段目の五線譜を含む譜面 |
| TextEditor・Preview編集・変数Inspector | [bidirectional-editor-overview.svg](gui_design/proposals/issue-158/bidirectional-editor-overview.svg) | 1950 × 1110 px | 常設の通常 / 編集 / 練習セレクター、排他的な編集ドックとPracticeガイド、4つのInspector上位タブ、変数表示 |
| Inspector・変数一覧と参照編集 | [variable-inspector-states.svg](gui_design/proposals/issue-158/variable-inspector-states.svg) | 1600 × 1110 px | 上位4タブ、変数一覧、定義ドラフト、参照編集の選択状態 |
| Inspector・対象文書なし | [inspector-empty.svg](gui_design/inspector-empty.svg) | 293 × 190 px | 対象文書を開く案内文 |
| Inspector・カポ / 弾きやすさ | [inspector-capo-playability.svg](gui_design/inspector-capo-playability.svg) | 293 × 900 px | 候補12と「適用」「閉じる」 |
| Inspector・初心者モード | [inspector-beginner.svg](gui_design/inspector-beginner.svg) | 293 × 850 px | 候補2の理由と「適用」「閉じる」 |
| Inspector・移調 | [inspector-transpose.svg](gui_design/inspector-transpose.svg) | 293 × 1050 px | コード対応表と「適用」「閉じる」 |
| Inspector・コード進行候補 | [inspector-progression.svg](gui_design/inspector-progression.svg) | 480 × 1360 px | 試聴設定、適用、閉じる |
| コード図エディタ | [chord-editor.svg](gui_design/chord-editor.svg) | 548 × 1260 px | DSL 行と保存操作一式 |
| YouTube 採譜パネル・設定を閉じた状態 | [youtube-transcription.svg](gui_design/youtube-transcription.svg) | 548 × 528 px | 採譜を開始するボタンと未入力時の状態表示 |
| YouTube 採譜パネル・詳細設定を展開 | [youtube-transcription-advanced.svg](gui_design/youtube-transcription-advanced.svg) | 548 × 1000 px | AI モデルと採譜開始ボタン |
| YouTube 採譜パネル・結果プレビュー | [youtube-transcription-result.svg](gui_design/youtube-transcription-result.svg) | 548 × 800 px | 読み取り専用 GuitarDSL とコピー操作 |

## Normative requirements

各 SVG は画面一覧の寸法で対象領域の表示内容をすべて含める。縦スクロールがある画面では代表状態の末尾までを図示し、横方向にはみ出す操作列も含める。図に表示した順序、文言、サンプル状態は後続の各画面仕様に従う。

## 画面構成

### 1. GuitarDSL サイドバー

サイドバーは開始操作と、現在アクティブな GuitarDSL ファイルへの操作を提供する。文書を直接編集する画面ではない。

#### 1.1 開始時

サイドバーは1つの Tree View で、最上部に操作できない対象行を表示する。対象行はアクティブな GuitarDSL ファイル名、無題文書のローカライズ名、または「対象なし」を示す。対象行の下には「新規作成」「開く・取り込む」「編集支援」「書き出す」「ヘルプ」の5区分をこの順に表示する。初回は「新規作成」と「開く・取り込む」を展開し、残りを折りたたむ。ファイル選択時の図は手動で区分を展開した代表状態である。

![開始時の GuitarDSL サイドバー](gui_design/sidebar-start-here.svg)

#### 1.2 GuitarDSL ファイル選択時

![GuitarDSL ファイルを選択したサイドバー](gui_design/sidebar-current-file.svg)

対象行にアクティブな GuitarDSL ファイル名を表示する。図では「編集支援」「書き出す」「ヘルプ」を展開し、アクティブなファイルに対する Preview / Inspector / PDF / Guitar Pro 7 の導線を示す。

アクティブなエディタが別文書へ切り替わったときに、区分の展開状態を強制変更しない。対象を使う Preview / Export 操作は、項目を押した時点のアクティブエディタだけを使う。

#### 1.3 項目・コマンド・対象

| 区分・項目 | コマンド | 対象と動作 |
|---|---|---|
| 新規作成・テンプレートから新規作成 | `guitardsl.newDocumentFromTemplate` | 選択したテンプレートから新しい未保存文書を作成する |
| 新規作成・サンプルから作成 | `guitardsl.openSample` | 選択した同梱サンプルから新しい未保存文書を作成する |
| 開く・取り込む・GuitarDSL ファイルを開く | `guitardsl.navigation.openGuitarDslFile`（内部コマンド） | `.guitardsl` / `.gdsl` だけを選び、通常の TextEditor で開く |
| 開く・取り込む・Guitar Pro 7/8 を取り込む | `guitardsl.importGuitarPro` | 既存の Guitar Pro 取り込み処理を使う |
| 開く・取り込む・音源から採譜 | `guitardsl.navigation.chooseTranscriptionSource`（内部コマンド） | YouTube またはローカル WAV を選ぶ。Esc ではどちらも実行しない |
| 編集支援・楽譜 Preview を開く | `guitardsl.navigation.showPreviewActive`（内部コマンド） | 実行時にアクティブな GuitarDSL 文書を明示する。対象なしでは何も出力しない |
| 編集支援・Inspector を開く | `guitardsl.openInspector` | 既存 Inspector の対象解決と空状態を使う |
| 書き出す・PDF に書き出す | `guitardsl.navigation.exportPdfActive`（内部コマンド） | 実行時にアクティブな GuitarDSL 文書だけを `guitardsl.exportPdf` に渡す |
| 書き出す・Guitar Pro 7 に書き出す | `guitardsl.navigation.exportGuitarProActive`（内部コマンド） | 実行時にアクティブな GuitarDSL 文書だけを `guitardsl.exportGuitarPro` に渡す |
| ヘルプ・GuitarDSL ヘルプを見る | `guitardsl.openHelp` | 同梱ヘルプを開く |

サイドバーの項目・更新条件は [拡張機能仕様 §4C](extension.md) を参照する。

### 2. 楽譜 Preview

Preview は、再生操作、楽譜設定、譜面の順に表示する。ページ表示と連続表示は同じサンプル楽譜を異なるレイアウトで示す。練習モードが有効な状態では、楽譜設定行の下に練習操作行を加える。

#### 2.1 ページ表示

![全内容を含む Preview・ページ表示](gui_design/preview-paged.svg)

| 上からの順序 | 要素と表示仕様 |
|---:|---|
| 1 | 再生行。再生、一時停止、停止、再生位置、経過時間 / 総時間、ループ、設定、表示切替を配置する。 |
| 2 | 楽譜設定行。カポ選択、弾きやすさスコア「71/100 簡単」、初心者切替を配置する。 |
| 3 | 1ページの白い譜面面。曲名「Guitar Rhythm Score」、作者、キー C、BPM 120、カポ 0 を上部に表示する。 |
| 4 | 譜面上部のコードダイアグラム列。C、G、Am、F の図と運指を表示する。 |
| 5 | セクション「Verse」と五線譜2段を表示し、各段に C、G、Am、F のコード進行を配置する。 |
| 6 | ページ下端にページ番号 1/1 を置く。 |

#### 2.2 Web 連続表示

![全内容を含む Preview・連続表示](gui_design/preview-continuous.svg)

ページ表示と同じ再生行・楽譜設定行を譜面の上に置く。譜面は紙面ごとに区切らず連続レイアウトとし、曲名、作者、キー / BPM / カポ、コードダイアグラム、Verse、サンプル文書の五線譜2段をすべて図に含める。ページ境界とページ番号は表示しない。

#### 2.3 Practice 有効

![全内容を含む Preview・Practice 有効](gui_design/preview-practice.svg)

再生行と楽譜設定行の次に Practice 行を表示する。Practice 行には速度 100%、Loop オフ、A / B 操作を置く。その下にページ表示と同じサンプル楽譜の全表示内容を置き、2段の五線譜まで含める。Practice の選択状態や再生位置を譜面データの一部として描かない。

再生と Practice の操作意味は [拡張機能仕様 §4.2、§4.6、§4.7](extension.md) を参照する。

#### 2.4 弾き語り練習ガイド (Issues #153, #155, #162)

Practice が有効なときは既存の再生行、楽譜設定行、42 px Practice 操作行、ページ表示を維持し、Preview 下端に練習ガイドを置く。音楽レーン順はメロディ、歌詞、奏法、コード名、コード図とする。コンパクト表示では次コードの名前と図を常時表示し、実際のガイド幅が480 CSS px以下なら上段帯、481 px以上なら右欄へ置く。メロディを OFF にする設定はメロディ行だけに作用し、歌詞との時間関係を保つ。

既存設定 UI の「コンパクト」（既定）/「詳細グリッド」と「ペア更新」（既定）/「連続スクロール」を保つ。詳細グリッドは Issue #153 の Fraction 配置、全曲密度判定、タイムライン表示を維持する。練習ガイドの外側操作 UI は HTML/CSS のままにし、コンパクト4小節の番号、メロディ、歌詞、奏法、コード名、コード図、小節線、playhead は各小節1枚のSVGに描く。レーンは `<g data-guide-lane="...">` で分け、拍位置は `x = 5 + beat / measureBeats * (slotWidth - 10)` の共通変換を使う。SVG の viewBox 幅とCSS幅を実測slot幅へ合わせ、1 SVG単位を1 CSS pxにする。DSL、音源、`PlaybackTimeline`、通常譜面SVG、PDFは変更しない。

コンパクト表示は常に4小節容量を保ち、実際にある演奏出現だけを表示する。各カードの幅はページ実幅 `W` から `slotWidth = max(0, (W - 16) / 4)` で均等配分し、余りは最後のslotに足す。カード間は4 px、bank間は8 pxとし、文字列長、奏法数、コード図で幅を増やさない。320 / 360 / 400 / 421 / 480 / 600 / 840 / 1100 / 1600 CSS pxの全幅で4slotを同じ可視範囲へ収め、横overflowは1 px以下とする。コンパクト表示に横スクロールを設けない。次コード帯の名前と正方形図を含め、400 pxでも番号と全5レーンの情報を視認可能にする。

幅480 px以下は次コード帯をガイド内の上段に配置し、下段を `44px minmax(0, 1fr)` のレーン名と4小節にする。幅481 px以上は右欄を保つ。固定スケールでストリップ全体を縮小せず、カード内コード図は `min(144px, slotWidth - 10px)`、次コード図は44～52 pxの正方形にする。歌詞など重なりを避ける必要があるレーンは縦行を追加し、候補小節の最大行数を共有する。奏法記号は常に一段の時間順で横に並べ、同時刻の記号は入力順で視覚位置だけをずらす。正確な拍/Fractionとそのxアンカーを視覚位置から分離し、時刻情報は変更しない。Compact奏法は詳細グリッドと別のSVG geometryを使う。down/up masterは `10 × 36` 座標系でshaftを `y≈3..32`・高さ75%以上、arrowheadを約 `5 × 5`、stroke幅を1.7～2.0とし、cap/joinを揃える。標準artboardは `10 × 36`。brush/mute/PM/string記号は必要なら横幅を足せるが、shaft/head比率と視覚高を保つ。tie/継続記号は拍位置のそばに短く置く。詳細グリッドのgeometryは変更しない。利用区間が12 pxまたは自然幅より狭い場合はSVG全体をX/Y同率で縮小し、12 px未満での視覚判別は要求しない。全記号とアクセシブル名を保つ。Compact奏法の通常/past/next/current色は順に `#1f2937` / `#475569` / `#37465e` / `#005f85` とし、白背景で4.5:1以上のcontrastを保つ。past/nextのopacityは下げず、currentは色相や太さでも区別する。歌詞の通常/current/past色は白背景に対してそれぞれ4.5:1以上のコントラストを保ち、currentとpastは明度差だけでなく色相や太字でも区別する。コード名と図は各コード区間の中央で横一列に対応させる。長い文字列だけを省略記号で切り、元の文字列は `title` とARIAから取得可能にする。音符、奏法、継続記号、コード図は省略しない。Compactメロディ休符はglyphやDOM/SVG要素を出力せず、その時間幅を空白に保ち、後続pitch barの拍位置とdurationを維持する。詳細グリッド、通常譜面SVG/PDF、DSL、playbackの休符表示・意味は変えない。

各小節SVGは小節番号、メロディ、歌詞、奏法、コード名、コード図、小節線、playheadを拍のFractionと共通x変換で描く。コード名と図はコードの有効区間の中点に揃え、同じ共有voicingから作った144×144 viewBoxの図をネストSVGで縮小する。各要素は演奏UIが必要とする小節、event、beat、verse、chordの `data-*` を維持する。幅、grid、表示切替、文書更新後の計測・SVG配置・高さ同期は、既存 `syncPracticeGuidePanelGeometry()` のRAFへまとめる。

継続記号は選択中gridに対応する各Fraction位置へ独立したSVG wave pathを描く。各記号は `data-guide-wave-grid`、拍と `n/d` Fraction、eventを保持し、同一 `(measure,event,grid,Fraction)` は重複させない。休符、mute、ghost/brush等の打音、staccatoには継続を作らない。tie開始はattackを追加せず継続waveを1つ描き、その後の有効grid位置も個別に描く。密な場合はwaveを伸長・集約せず、縦行を追加する。

初期表示 `[01, 02] [03, 04]`、左右2bank、演奏順 `PlaybackTimeline.occurrences`、repeat / volta / arrangement / lyricVerse、手動previous/nextは維持する。bank交替時は再生済みbankのみを同座標でopacity交差させ、現在bankのDOMとhighlightは動かさない。遷移先 `tempoBpm × effectiveSpeed()` から `fadeMs = clamp(round(60000 / effectiveBpm), 450, 900)` を開始時に計算し、不正時600 msとする。旧220 ms固定を使わず、fallback cleanupは `fadeMs + 80 ms` とする。進行中のfadeは速度変更で変えず、seek / loop / resize / mode変更 / disposeではgeneration管理で即時再投影する。reduced motion、初回表示、手動ページ移動、seek、復元、resizeは0 msとする。音声時刻・再生には影響しない。

奏法とwaveはSVG `path` 等のベクトルで描き、可視の `↓` / `↑` / `〜` をUnicode・CSS content・フォントglyphで代用しない。矢印、PM、弦番号、休符、mute、brushの既存意味は保ち、奏法SVGの縮小はX/Y同一倍率にする。コンパクト継続waveの標準 `d` と `stroke-width` はgridや区間幅ごとに変形せず、親要素の等倍率transformだけで縮小する。実画面検収は最終HEADで400/421/600/1100 px × 日英 × Light/Dark × melody ON/OFF（32枚）と400 px × grid4/8/16 × 日英 × Light/Dark（12枚）を採取し、DOMRect、横overflow、拍アンカー/視覚位置、歌詞コントラスト、レーン位置、voicing、fade時刻を測定する。通常譜面SVG、PDF、詳細grid、DSL、音源にはcompact変更を漏らさない。

#### 2.5 双方向編集モード（Issue #158）

Preview は既存の単一 WebviewPanel を使い、既定の「通常」、双方向編集の「編集」、練習操作の「練習」を排他的に切り替える。48 px再生行の右側 `.toolbar-actions` に通常 / 編集 / 練習のセレクターを常設する。幅600 px未満は現在値が読めるネイティブselect、600 px以上はsegmented controlを表示し、ARIA状態、フォーカスとキーボード操作を備える。旧Practice単独トグルと編集フォーム内の切替を置かない。

再生・一時停止・停止は全幅でアイコンのみを表示する。ボタンのtitleとaccessible nameは維持し、再生状態に応じて再生 / 再開へ更新する。

通常は48 px再生行と44 px楽譜設定行の下に楽譜を表示し、編集ドック・Practice行・ガイドを隠す。編集は同じ2行の下に楽譜と下端固定編集ドックを表示し、42 px Practice行と4小節ガイドを隠す。練習は同じ2行と42 px Practice行、4小節ガイドを表示し、編集ドックと編集hit-areaを隠す。編集フォームは通常 / 練習では高さ0、編集で未選択なら案内、選択時は種別別操作を表示する。編集overlayとhit-areaはPreviewにのみ存在し、PDFのSVGには出力しない。

標準 TextEditor が唯一の永続ソースである。Preview は明示した URI・文書version・Preview世代に結び付けた選択と編集 intent を送り、Host が最新テキスト、parser source binding、token種別、期待原文、音楽的整合性を検証してから一回の WorkspaceEdit を行う。1回のドラッグまたはキー確定は1 Undoとし、キャンセル、古い世代、文書切替、二重適用、解析・検証・音声停止失敗では文書を変更しない。

編集対象はauthored chord名、melody音符・休符・音価、rhythm token、単一TAB声部の弦・フレット・音価、lyrの一音節とする。省略値の継承、拍数、tie/slur、歌詞対応、TAB制約が壊れる場合は安全な明示化ができるときだけ許可し、それ以外は編集不可の理由と「コードで開く」を示す。同じソースが反復・編曲で複数表示される場合、曖昧な単一出現編集を行わない。

編集ドックとPracticeガイドは同時に表示しない。編集時はドックの高さだけを譜面の下余白に加え、練習時は既存Practiceガイドの高さを使う。どちらも幅421 / 600 / 840 / 1100 CSS pxと短い高さで本文を覆わず、末尾の譜面に到達できる。Host HTML再構築後のスクロール、フォーカス、選択は同一URI/version/generationとsource bindingに再解決できる場合だけ復元し、stale document・削除・disposeでは破棄する。同一URIの再構築ではモードを維持し、別文書またはPreview disposeで通常に戻す。

**図の位置づけ:** 追加した2枚は承認済みの純ベクター設計図であり、実装済み画面のキャプチャではない。画面一覧の元の Preview・Inspector 図は引き続き現行画面の基準とする。実 Extension Development Host の証拠は実装検収に別途記録し、設計図との差を説明する。

### 3. GuitarDSL Inspector

Inspector は対象文書がない状態と、文書に応じた設定画面を同じ領域に表示する。設定画面はタブ、説明または入力、結果、確定操作の順に構成する。

単一 Inspector の上位タブは「文書 / 変数 / 楽譜設定 / コード進行」の4ボタンを維持する。コンテンツ幅が360 CSS px以下では等幅4列にし、視覚ラベルを日本語「文書 / 変数 / 楽譜 / 進行」、英語「Doc / Vars / Score / Chords」として1行に収める。360 CSS pxを超える幅では従来の正式ラベルを表示する。狭幅でも各ボタンの `aria-label` と `title` は正式名称（日本語「文書 / 変数 / 楽譜設定 / コード進行」、英語「Document / Variables / Score settings / Progression」）を保持し、同じtab ID、ARIA状態、キーボード操作、focus表示を使う。横スクロールや省略記号でタブを隠さない。

#### 3.1 対象文書なし

![対象文書なしの Inspector](gui_design/inspector-empty.svg)

見出し「GuitarDSL Inspector」の下に、GuitarDSL 文書が選択されていない旨を2行で強調表示する。続けて、エディタで GuitarDSL 文書を開くとここに文書コンテキストを表示する説明を置く。別の開いている文書を暗黙に選択した表示は含めない。

#### 3.2 カポ / 弾きやすさ

![全候補を含む Inspector・カポ / 弾きやすさ](gui_design/inspector-capo-playability.svg)

| 上からの順序 | 要素と代表表示 |
|---:|---|
| 1 | Inspector 見出しと設定タブ。「カポ/弾きやすさ」を選択し、「初心者モード」「移調」も同じタブ群に表示する。 |
| 2 | 現在のカポ 0、選択中のカポ 1、推奨カポ 3 の情報カード。 |
| 3 | カポ候補0〜12の全13行。各行に候補番号、弾きやすさスコア、難易度、変更可能状態を表示する。現在値0、選択値1、推奨値3を行内でも識別できるようにする。 |
| 4 | 候補一覧の後に「適用」「閉じる」を置く。 |

図の候補スコアは順に、58、59、43、81、24、78、24、22、73、29、70、15、62。難易度ラベルと変更可否は図に示すサンプル値である。

#### 3.3 初心者モード

![全候補を含む Inspector・初心者モード](gui_design/inspector-beginner.svg)

1. Inspector 見出しとタブ群を表示し、「初心者モード」を選択状態にする。
2. 鳴る響きをカポで保ちながら押さえやすい位置と簡単なコードを提案する説明を表示する。設定は DSL に保存されない旨も含める。
3. バレーコード方針「使用しない」、カポ 0、推奨カポ 3 の設定を縦に配置する。
4. 現在の弾きやすさ「普通 58/100」と変更後「とても簡単 85/100」を別の情報欄に置く。
5. 推奨カポ候補0〜2をすべて表示する。候補0は現在・変更可、候補1は B の押さえ方がないため変更不可、候補2は Bb の押さえ方がないため変更不可とし、理由文を候補に続けて表示する。
6. 一覧の後に「適用」「閉じる」を置く。

#### 3.4 移調

![全内容を含む Inspector・移調](gui_design/inspector-transpose.svg)

| 上からの順序 | 要素と代表表示 |
|---:|---|
| 1 | Inspector 見出しと3つの設定タブ。「移調」を選択状態にする。 |
| 2 | 曲全体の鳴る音を移調して DSL を書き換えること、カポを維持・推奨・指定から選べることの説明。 |
| 3 | 移調量 0 半音、移調後のキー C (0)、移調後カポ方針「そのまま」、変更後カポ 0 のコントロール。 |
| 4 | 現在のキー C / 移調後のキー C / 現在のカポ 0 / 変更後のカポ 0 の比較欄。 |
| 5 | コード対応表。元のコードと移調後を2列で示し、C→C、G→G、Am→Am、F→F の4行を置く。 |
| 6 | コード対応表の後に「適用」「閉じる」を置く。 |

#### 3.5 コード進行候補

![全候補と試聴操作を含む Inspector・コード進行](gui_design/inspector-progression.svg)

| 上からの順序 | 要素と代表表示 |
|---:|---|
| 1 | Inspector 見出し、画面見出し「コード進行候補」、候補の選択だけでは再生や文書編集が始まらないことを示す注意。 |
| 2 | 進行全体の長さ 4 / 8 / 16 小節と、配置方法「対象の小節を置き換える」「本文末に追加する」。 |
| 3 | 候補カード4枚。各カードにコード列、進行ヒューリスティックのスコアとキー、ローマ数字による進行名、評価根拠を表示する。 |
| 4 | 候補カードの後に試聴モード「進行全体」、試聴、停止、A 原文 / B 候補、試聴速度 100% を置く。 |
| 5 | 最下部に「候補を適用…」「閉じる」を置く。 |

候補カードの順序とコード列は、C→F→Fm→C、C→G→Am→F、C→Am→F→G、C→Am→Dm→G。図では2番目を選択状態にする。各カードには表示したスコアと調性、進行のローマ数字、同一開始・主音終止・メロディ評価の注記を含める。候補4枚と最下部の操作までを1枚の図に含め、スクロール領域の途中で切らない。

Inspector の設定・候補操作の意味は [拡張機能仕様 §4B、§4D](extension.md) を参照する。

#### 3.6 変数

既存の共通 Inspector に「変数」表示を追加し、現在アクティブな GuitarDSL 文書だけを対象にする。変数一覧には有効なlet定義、使用文脈、直接参照数、間接参照数、参照位置、未使用状態と診断を示す。chord定義は変数として表示しない。

Inspector の検証済みドラフトから新規作成、定義編集、名前変更、複製、未使用定義の削除を行う。「変更を適用」までは原文、Preview、PDF、音声を変えず、適用は一つの編集・一回のUndoとする。名前変更は定義と前方・後方・入れ子の全参照を一回で更新する。参照位置から元ソースへジャンプできる。

#### 3.7 Inspector 上部コンテキストタブ（Issue #158）

既存 singleton Inspector の見出し直下に「文書」「変数」「楽譜設定」「コード進行」の上部タブを1組だけ表示する。各タブは同じ Inspector 領域を切り替え、設定内の既存タブはその内側に残す。コード進行は有効な候補 session があるときだけ操作可能にし、切替だけで候補を作らない。変数 / 設定 draft の破棄確認とコード進行試聴停止が必要な場合は、確認・Stop ACK・lease 解放の完了後に遷移する。

上部タブは `role=tablist` / `role=tab` を使い、矢印キー、Home / End、Enter / Space、roving focus、`aria-selected`、`aria-controls` を実装する。全状態は日英、ライト / ダーク、狭い Inspector 幅で読めること。編集モードから開く場合は Preview が保持する文書の「変数」を初期表示する。Preview の再描画で現在のタブを再初期化しない。

Preview で変数参照を編集するときは「定義を編集（全参照）」「この箇所だけ展開して編集」「キャンセル」を明示する。後者は選択した一つのauthored参照だけが展開され、全スコアの音楽的意味が保たれるとHostが確認できる場合に限る。繰返しや編曲で複数回表示される出現、曖昧な範囲、入れ子で安全性を確定できない対象は変更しない。

### 4. コード図エディタ

![全入力項目と保存操作を含むコード図エディタ](gui_design/chord-editor.svg)

コード図エディタは上からプリセット、運指編集、コード情報、プレビュー、DSL 出力、保存操作の順に構成する。図には下記すべてを含む。

| 上からの順序 | 要素と代表表示 |
|---:|---|
| 1 | 「プリセット」見出し。「ルート」は C、C#、D、Eb、E、F、F#、G、Ab、A、Bb、B の12音を選べる。「タイプ」は maj、m、7、maj7、m7、sus2、sus4、7sus4、6、m6、add9、9、m9、dim、aug を表示する。 |
| 2 | プリセット形状候補の小型ダイアグラム列。候補の開放弦 / ミュート、押弦位置、フレット情報を図示する。 |
| 3 | 「コードダイアグラム編集」と新規定義状態。操作モードは押弦、指番号、セーハ、クリア。マス目をクリックして押弦を切り替え、上端の × / ○ でミュート / 開放弦を指定する案内を置く。 |
| 4 | 6弦のフレットボードと上端の弦状態を表示する。サンプル運指は C の x32010。 |
| 5 | 開始フレットの −、値1、＋。 |
| 6 | コード名 C、ラベル入力、空欄ならデフォルトを使う説明、自動判定結果 C。 |
| 7 | 編集中のコードダイアグラムのプレビュー。 |
| 8 | DSL 出力行 chord C = x32010。 |
| 9 | 「保存」「別バリエーションとして保存」「閉じる」の3操作を図の最下部に表示する。 |

#### 4.1 コード図内の表示規則

フレットボードは6本の弦と複数のフレット位置を直交線で表す。押弦は黒丸と指番号、ミュート弦は ×、開放弦は ○ で表す。開始フレットの値はボード直下に置く。コード名・ラベル・プレビュー・DSL はフレットボードの後に続け、保存操作はすべての編集情報の後にまとめる。

コード図の編集動作と DSL 表記は [拡張機能仕様 §3.3](extension.md) を参照する。

### 5. YouTube 採譜パネル

画面はタイトル、実験的な注意、YouTube URL、キー状態とキー管理の開閉、詳細設定の開閉、開始ボタン、進捗またはエラーの順に並べる。採譜処理の境界は [拡張機能仕様 §3.4](extension.md) に従う。

![設定を閉じた YouTube 採譜パネル](gui_design/youtube-transcription.svg)

![詳細設定を展開した YouTube 採譜パネル](gui_design/youtube-transcription-advanced.svg)

![採譜結果プレビューを表示した YouTube パネル](gui_design/youtube-transcription-result.svg)

初期図はキー管理と詳細設定の両方を閉じ、URL とキーが未設定で開始ボタンを無効にした状態を示す。キー欄は管理を開いた場合だけ表示し、保存後は入力値を空に戻す。通常は未設定 / 保存済みの状態を示すが、SecretStorage の読み取りに失敗した場合はローカライズした「キー状態を確認できない」と表示し、どちらとも断定しない。キーの値は画面の状態表示、ログ、HTML に含めない。

詳細設定は BPM（自動 / 30–300 の手動値）、カポ（自動 / 0–12 の手動値）、ビート（自動 / 8 / 16）、伴奏ファミリーとプリセット、繰り返し圧縮、AI モデルの順に表示する。選択肢、既定値、既存コマンドへ渡す値は変えない。閉じた開閉領域の操作部品はキーボードフォーカス順に含めない。

開始ボタンは URL が空でなく、保存済みキーまたは入力キーがある場合だけ有効にする。URL の検証は拡張機能ホストが引き続き行う。開始後は二重実行を抑え、既存の段階進捗とエラーを同じパネルに表示する。Start 時の SecretStorage 読み取り失敗はローカライズしたエラーを表示して開始を復旧し、Gemini 呼び出しと文書生成を行わない。YouTube の実行中キャンセル操作は表示しない。

構造検証に成功した GuitarDSL は、このパネル内の読み取り専用欄に表示する。**コピー** 操作で通常の GuitarDSL エディターへ貼り付けて編集できる。採譜成功時にエディター文書は自動作成しない。パネルを閉じるとプレビューは破棄する。プレビュー表示、コピー操作、処理状態の同期は、Extension host からの message と Webview の応答に従う。

## Observable behavior

各図は見出しに記載した一つの代表状態を示す。スコア、コード、キー、選択行、候補数など文書や計算結果に応じて変わる値は、図のサンプル状態に限る。Preview の任意長譜面、別のキー・運指・候補、画面幅に応じた折り返し、読み込み中・エラー表示は、ここに示す図の寸法や代表値によって固定しない。

この仕様が規定するのは画面内の構成、表示順、情報のまとまりである。コマンド実行、文書変更、フォーカス、再生音、候補適用・取消の動作は [拡張機能仕様](extension.md) に従う。仕様と実装に差異がある場合、実装に合わせて既存の動作契約を変更せず、差異を Issue で解決する。

## Error and boundary behavior

入力検証、エラー表示、無効操作の扱いは [拡張機能仕様](extension.md) に従う。本書の SVG は明記した代表状態だけを示す。動的に増減する譜面・候補数・計算値や、読み込み・エラー時の全画面を一つの図で固定しない。

## Security and privacy

画面図に実在の API Key、個人の文書名、ユーザーデータを含めない。曲名、作者、コード、URL、API Key 欄の例は説明用の合成値またはプレースホルダーである。

## Verification strategy

画面仕様の図は SVG として XML 解析でき、`image` 要素やスクリーンショット画像の埋め込みを含まないことを確認する。SVG は各ファイルに記載した全寸法でベクターレンダラーを使って出力し、全13図を一覧表示して、対象画面の先頭から最下部の要素まで欠落がないことを確認する。Markdown の参照先と仕様書メタデータは `python3 -m agent_workflow validate-docs --issue 150` で検証する。
