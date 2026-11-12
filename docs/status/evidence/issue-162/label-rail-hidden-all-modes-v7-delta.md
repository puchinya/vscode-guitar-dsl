# Implementation Contract v7 Delta — Hide the left label rail in both guide modes

**対象リポジトリ**: `puchinya/vscode-guitar-dsl`  
**基礎契約**: Issue #162 canonical Contract v6, comment `6554924588`, SHA-256 `b1fede14291281ff8a5fa2fd9e12739394ce9723ae3904f4395e82c824930ef5`  
**ユーザー追加決定**: 「左レールは両方で消していいです。」  
**位置付け**: Contract v6の左レール表示範囲だけを更新する。既存のv5、v6本文と承認履歴は変更しない。

## 1. Decision

- `.practice-guide-label-rail-shell` のDOMは維持するが、**compact/detailedの両モードで非表示**にし、どちらも幅を割り当てない。左端の小節／メロディ／歌詞／奏法／コード／コード図ラベルは表示しない。
- compactの4小節、次コード配置、v6の選択verse一行歌詞、奏法v5のpath形状・寸法・Fraction、フェード、イベント/ARIA保持はv6どおり。
- detailed gridは横スクロール、表示グリッド、複数行の歌詞、各レーンの高さとFraction配置を維持する。変更は左レールの除去と、その幅をtimelineへ戻すことに限る。
- `.practice-guide-label-rail-shell` をDOMから削除せず、レイアウト同期からも参照できる状態を保つ。CSSで非表示にし、`getBoundingClientRect().width` とgrid割当て幅が0であることを検査する。

## 2. Grid columns

- detailed: `minmax(0,1fr) 112px`（幅600 CSS px以下では `minmax(0,1fr) 96px`）。`.practice-guide-scroll` は1列目、次コード欄は2列目。detailed grid固有の横スクロールは維持する。
- compact 481–600px: `minmax(0,1fr) 96px`。4小節pageは1列目、次コード欄は2列目。
- compact 601px以上: `minmax(0,1fr) 112px`。4小節pageは1列目、次コード欄は2列目。
- compact 480px以下: `minmax(0,1fr)` のみ。次コード帯は1列目の上段、4小節pageは1列目の下段。compactには横スクロールを設けない。
- compactの4 slot幅は最終DOM pageの実 `clientWidth` から `(width - 16) / 4` で計算する。detailedからcompact、compactからdetailedへ切り替えた際にinline styleが列幅を再確保しない。

## 3. Tests and review

- 320/360/400/421/480/481/600/1100/1600 CSS pxで、compactとdetailedの双方について左rail computed displayがnone、幅0、未割当てを確認。
- compactは次コード位置、4 slot幅、4小節同時表示、横overflowなしを検査。detailedはtimelineが1列目で可視・操作可能、既存gridと水平スクロールを保つことを検査。
- compact↔detailed切替後も左railが非表示であること、detailedの行高/Fraction/複数verse配置が変化しないことを確認する。
- Contract v6のsingle-baseline歌詞、全テキスト保持、font-size/textLength、resize/page/fade検査をそのまま維持する。
