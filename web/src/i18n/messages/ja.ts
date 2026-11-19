import type { MessageShape } from './en';

export const ja = {
  menu: {
    main: 'メインメニュー',
    file: 'ファイル',
    edit: '編集',
    view: '表示'
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
    library: 'GuitarDSL ライブラリ',
    connectionState: 'Google Drive: {status}',
    onThisDevice: 'このデバイス',
    status: {
      connected: '接続済み',
      connecting: '接続中…',
      reauth: '再接続が必要',
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
    scoreView: '譜面表示'
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
    toggleInspector: 'Inspector の表示切替'
  },
  inspector: {
    title: 'インスペクタ',
    options: 'Inspector のオプション'
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
