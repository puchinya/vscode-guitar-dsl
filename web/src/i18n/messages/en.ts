export const en = {
  menu: {
    main: 'Main menu',
    file: 'File',
    edit: 'Edit',
    view: 'View'
  },
  action: {
    save: 'Save',
    downloadPdf: 'Download PDF',
    help: 'Help',
    settings: 'Settings',
    close: 'Close',
    newScore: 'New score',
    explorerOptions: 'Explorer options',
    importFile: 'Import file…',
    googleDriveOptions: 'Google Drive options'
  },
  drive: {
    name: 'Google Drive',
    connectionState: 'Google Drive: {status}',
    onThisDevice: 'On this device',
    status: {
      connected: 'Connected',
      connecting: 'Connecting…',
      reauth: 'Reconnect required',
      offline: 'Offline',
      disconnected: 'Not connected'
    },
    action: {
      connect: 'Connect',
      connecting: 'Connecting…',
      reconnect: 'Reconnect Drive'
    },
    unavailableOffline: 'Google Drive is unavailable offline',
    connectToShowFiles: 'Connect to show Google Drive files',
    chooseDestinationFolder: 'Choose a destination folder'
  },
  common: {
    collapse: 'Collapse',
    expand: 'Expand',
    loading: 'Loading…',
    noScores: 'No scores yet'
  },
  explorer: {
    title: 'EXPLORER',
    files: 'Files'
  },
  tabs: {
    openDocumentsAndViews: 'Open documents and workspace views',
    closeDocument: 'Close {name}',
    workspaceView: 'Workspace view',
    sourceView: 'Source view',
    splitView: 'Split view',
    scoreView: 'Score view'
  },
  problems: {
    title: 'Problems',
    close: 'Close Problems',
    severity: 'Severity',
    severityType: {
      error: 'error',
      warning: 'warning'
    },
    file: 'File',
    location: 'Line:Col',
    message: 'Message',
    empty: 'No problems'
  },
  workspace: {
    tools: 'Workspace tools',
    toggleExplorer: 'Toggle Explorer',
    score: 'Score workspace',
    resizeExplorer: 'Resize Explorer',
    resizeSourceAndScore: 'Resize source and score panes',
    resizeInspector: 'Resize Inspector',
    resizeProblems: 'Resize Problems',
    toolWindows: 'Tool windows',
    toggleInspector: 'Toggle Inspector'
  },
  inspector: {
    title: 'Inspector',
    options: 'Inspector options'
  },
  pwa: {
    title: 'App update',
    updateReady: 'A GuitarDSL update is ready',
    saveBeforeReload: 'The app checks that your work is saved before reloading. CodeMirror undo history may not survive the update.',
    later: 'Later',
    checking: 'Checking…',
    update: 'Update'
  },
  status: {
    workspace: 'Workspace status',
    cursorPosition: 'Ln 1, Col 1',
    previewLoading: 'Loading score',
    ready: 'Ready',
    offline: 'Offline'
  },
  help: {
    topics: 'Help topics',
    openNewTab: 'Open Help in a new tab'
  }
} as const;

export type MessageShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};
