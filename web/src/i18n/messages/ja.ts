import type { MessageShape } from './en';

export const ja = {
  menu: {
    main: 'メインメニュー',
    file: 'ファイル',
    edit: '編集',
    view: '表示',
    help: 'ヘルプ'
  },
  action: {
    save: '保存',
    downloadPdf: 'PDFを出力',
    help: 'ヘルプ',
    settings: '設定',
    close: '閉じる',
    newScore: '新しい楽譜',
    explorerOptions: 'エクスプローラーのオプション',
    importFile: 'ファイルを読み込む…',
    googleDriveOptions: 'Google Drive のオプション'
  },
  drive: {
    name: 'Google Drive',
    library: 'ライブラリ',
    connectionState: 'Google Drive: {status}',
    onThisDevice: 'このデバイス',
    status: {
      connected: '接続済み',
      connecting: '接続中…',
      reauth: '再接続',
      reauthDescription: 'Google Drive の再認証が必要です',
      offline: 'オフライン',
      disconnected: '未接続'
    },
    action: {
      connect: '接続',
      connecting: '接続中…',
      reconnect: 'Drive に再接続'
    },
    unavailableOffline: 'オフラインではDriveを利用できません',
    connectToShowFiles: '接続するとDriveのファイルが表示されます',
    chooseDestinationFolder: 'GuitarDSL ライブラリを設定してください',
    emptyLibrary: '楽譜やフォルダーはありません',
    importFromDrive: 'Google Drive からインポート…',
    newFolder: '新しいフォルダー…',
    refreshLibrary: '更新'
  },
  common: {
    collapse: '折りたたむ',
    expand: '展開',
    loading: '読み込み中…',
    noScores: '楽譜がありません'
  },
  explorer: {
    title: 'エクスプローラー',
    files: 'ファイル'
  },
  tabs: {
    openDocumentsAndViews: '開いている文書とワークスペース表示',
    closeDocument: '閉じる {name}',
    workspaceView: 'ワークスペース表示',
    sourceView: 'ソース表示',
    splitView: '分割表示',
    scoreView: '譜面表示',
    welcome: 'ようこそ',
    closeWelcome: 'ようこそを閉じる'
  },
  problems: {
    title: '問題',
    close: '問題を閉じる',
    severity: '重要度',
    severityType: {
      error: 'error',
      warning: 'warning',
      info: 'info'
    },
    file: 'ファイル',
    location: '行:列',
    message: 'メッセージ',
    empty: '問題はありません'
  },
  workspace: {
    tools: 'ワークスペースツール',
    toggleExplorer: 'エクスプローラーの表示切替',
    score: '楽譜ワークスペース',
    resizeExplorer: 'Explorer の幅を変更',
    resizeSourceAndScore: 'ソースと譜面の幅を変更',
    resizeInspector: 'Inspector の幅を変更',
    resizeProblems: '問題パネルの高さを変更',
    toolWindows: 'ツールウィンドウ',
    toggleInspector: 'Inspector の表示切替',
    toggleTutorial: 'チュートリアルの表示切替'
  },
  inspector: {
    title: 'インスペクタ',
    options: 'Inspector のオプション',
    tutorial: 'チュートリアル',
    welcomePlaceholder: '設定を編集するには、楽譜を選択または作成してください。'
  },
  about: {
    title: 'GuitarDSL について',
    product: 'GuitarDSL Web',
    version: 'バージョン {version}',
    license: 'MIT License',
    source: 'ソースコード（GitHub）',
    support: 'サポートに問い合わせる'
  },
  welcome: {
    heading: 'GuitarDSL へようこそ',
    subtitle: 'GuitarDSLは、コード進行やストローク、歌詞、メロディ、TABをテキストで編集し、譜面として確認できるギター譜エディターです。楽譜はこの端末に保存でき、必要に応じてGoogle Driveも利用できます。',
    start: 'はじめる',
    create: '新しい楽譜を作成',
    connect: 'Google Drive に接続して利用',
    connected: 'Google Drive 接続済み',
    driveHint: '左側のEXPLORERからGoogle Driveの楽譜を管理できます。',
    driveOffline: 'オフラインではGoogle Driveを利用できません',
    driveOfflineHint: 'オンラインに戻ってから再接続してください。この端末の楽譜は引き続き利用できます。',
    tutorial: 'チュートリアルを開始',
    storage: '保存について',
    storageText: '楽譜と下書きはこの端末に保存されます。Google Drive は任意で、利用を選んだときだけ接続します。',
    links: 'リンク',
    help: 'ヘルプ',
    terms: '利用規約',
    licenses: 'ライセンス（MIT/OSS）',
    privacy: 'プライバシーポリシー',
    source: 'ソースコード（GitHub）',
    suppress: '次回からこの画面を表示しない',
    storageError: '設定を保存できませんでした。変更前の設定を維持しています。'
  },
  tutorial: {
    title: 'チュートリアル',
    step: 'ステップ {current} / 10',
    previous: '戻る',
    next: '次へ',
    restart: '最初から',
    finish: '完了',
    completedA: 'メロディなしのレッスン完了',
    completedB: 'メロディ付きのレッスン完了',
    copy: '例をコピー',
    copied: '例をコピーしました。',
    copyFailed: '例をコピーできませんでした。',
    steps: {
      step1: { title: '楽譜を用意する', body: '既存の Untitled.guitardsl を使うか、自分で新しい楽譜を作成します。チュートリアルを始めてもファイルは作成・編集されません。' },
      step2: { title: '楽曲情報を設定する', body: '原曲はヘ長調です。このレッスンではハ長調に移調します。コード譜の例にある曲名、作者、調、テンポ、拍子、1段あたりの小節数を入力します。' },
      step3: { title: 'コードとストロークを付ける', body: '16小節それぞれでコードセルとリズムセルを分けます。コードが2つなら各コードは2拍ずつです。%は直前の小節のリズムだけを繰り返し、コードセルは省略しません。' },
      step4: { title: '1〜8小節に歌詞を付ける', body: 'コード譜の前半8小節に小節単位の l: 歌詞を追加します。例には前半を示しています。歌詞はそれぞれのリズムセルに記します。' },
      step5: { title: '9〜16小節に歌詞を付ける', body: '9〜16小節を加えて1番を完成させます。リズムが%の小節でもコードセルは明示します。' },
      step6: { title: 'A版を確認して保存する', body: 'メロディなしのコード譜をPreviewとProblemsで確認し、必要ならPDFを書き出してローカル保存します。ここでA版が完成します。B版は後から再開できます。' },
      step7: { title: 'B版を別ファイルにする', body: 'ExplorerでA版を複製してB版を作るか、新しいファイルを作成してソースをコピーします。A版は名前変更せずに残し、B版だけを編集します。チュートリアルが自動で複製・編集することはありません。' },
      step8: { title: '前半8小節のメロディを付ける', body: 'B版では小節単位の l: 歌詞を削除し、1〜8小節にメロディと音符単位の lyr: を追加します。例はA版と同じ前半のコードとリズムセルを含みます。音価と休符を保ちます。' },
      step9: { title: '後半8小節のメロディを付ける', body: 'メロディと lyr: を加えて9〜16小節を完成させます。8つの%を含め、A版と同じコードとリズムの小節を保ちます。' },
      step10: { title: 'B版を確認して保存する', body: 'メロディ譜表、伴奏リズム譜表、歌詞、Problemsの診断なし、PDF、再読み込みを確認します。A版とB版を別ファイルで残します。' }
    }
  },
  pwa: {
    title: 'アプリの更新',
    updateReady: 'GuitarDSL の更新があります',
    saveBeforeReload: '更新の前に編集中の内容を保存します。再読み込み後は元に戻す履歴が失われる場合があります。',
    later: '後で',
    checking: '確認中…',
    update: '更新する'
  },
  status: {
    workspace: 'ワークスペースの状態',
    cursorPosition: '行 1, 列 1',
    previewLoading: '譜面を読み込み中',
    ready: '準備完了',
    offline: 'オフライン'
  },
  help: {
    topics: 'ヘルプのトピック',
    openNewTab: 'ヘルプを新しいタブで開く'
  }
} satisfies MessageShape<typeof import('./en').en>;
