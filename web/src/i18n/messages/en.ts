export const en = {
  menu: {
    main: 'Main menu',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help'
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
    library: 'Library',
    connectionState: 'Google Drive: {status}',
    onThisDevice: 'On this device',
    status: {
      connected: 'Connected',
      connecting: 'Connecting…',
      reauth: 'Reconnect',
      reauthDescription: 'Google Drive needs reauthorization',
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
    chooseDestinationFolder: 'Set up the GuitarDSL Library',
    emptyLibrary: 'No scores or folders yet',
    importFromDrive: 'Import from Google Drive…',
    newFolder: 'New folder…',
    refreshLibrary: 'Refresh'
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
    scoreView: 'Score view',
    welcome: 'Welcome',
    closeWelcome: 'Close Welcome'
  },
  problems: {
    title: 'Problems',
    close: 'Close Problems',
    severity: 'Severity',
    severityType: {
      error: 'error',
      warning: 'warning',
      info: 'info'
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
    toggleInspector: 'Toggle Inspector',
    toggleTutorial: 'Toggle Tutorial'
  },
  inspector: {
    title: 'Inspector',
    options: 'Inspector options',
    tutorial: 'Tutorial',
    welcomePlaceholder: 'Select or create a score to edit its settings.'
  },
  about: {
    title: 'About GuitarDSL',
    product: 'GuitarDSL Web',
    version: 'Version {version}',
    license: 'MIT License',
    source: 'Source code (GitHub)',
    support: 'Contact support'
  },
  welcome: {
    heading: 'Welcome to GuitarDSL',
    subtitle: 'GuitarDSL is a guitar score editor for writing chord progressions, strumming, lyrics, melodies, and TAB as text and viewing them as a score. Scores can be saved on this device, and Google Drive is available when you choose to use it.',
    start: 'Get started',
    create: 'Create New Score',
    connect: 'Connect and Use Google Drive',
    connected: 'Google Drive connected',
    driveHint: 'Manage Google Drive scores from Explorer.',
    driveOffline: 'Google Drive is unavailable offline',
    driveOfflineHint: 'Reconnect after you are online. Scores on this device remain available.',
    tutorial: 'Start Tutorial',
    storage: 'Storage',
    storageText: 'Scores and drafts are saved on this device. Google Drive is optional and connects only when you choose to use it.',
    links: 'Links',
    help: 'Help',
    terms: 'Terms of Service',
    licenses: 'Licenses (MIT/OSS)',
    privacy: 'Privacy Policy',
    source: 'Source code (GitHub)',
    suppress: 'Do not show this page again',
    storageError: 'Could not save this preference. Your previous setting is still active.'
  },
  tutorial: {
    title: 'Tutorial',
    step: 'Step {current} of 10',
    previous: 'Back',
    next: 'Next',
    restart: 'Restart',
    finish: 'Finish',
    completedA: 'Chord-only lesson complete',
    completedB: 'Melody lesson complete',
    copy: 'Copy example',
    copied: 'Example copied.',
    copyFailed: 'Could not copy the example.',
    steps: {
      step1: { title: 'Prepare a score', body: 'Use an existing Untitled.guitardsl score, or create one yourself. Starting this tutorial does not create or edit a file.' },
      step2: { title: 'Set the song details', body: 'The original is in F major. This lesson moves it to C major. Enter the title, artist, key, tempo, time signature, and four measures per row shown in the chord example.' },
      step3: { title: 'Add chords and strumming', body: 'Each of the 16 bars has a chord cell followed by a rhythm cell. Two chord names divide a bar into two equal beats each. The percent sign repeats only the previous bar’s rhythm; chord cells remain explicit.' },
      step4: { title: 'Add lyrics to bars 1–8', body: 'Add the first eight bar-level l: lyrics to the chord chart. The example shows the first half; each lyric belongs in its own rhythm cell.' },
      step5: { title: 'Add lyrics to bars 9–16', body: 'Finish the first verse with bars 9–16. Keep each chord cell explicit, including bars whose rhythm uses %.' },
      step6: { title: 'Check and save version A', body: 'Confirm the melody-free chord chart in Preview and Problems, export a PDF if you like, and save the local file. Version A is complete here; you can return to version B later.' },
      step7: { title: 'Make a separate version B', body: 'Use Explorer to duplicate version A into B, or create a new file and copy the source into it. Keep version A under its existing name and edit only version B. This tutorial never duplicates or edits a file for you.' },
      step8: { title: 'Add the first eight melody bars', body: 'Remove the l: bar lyrics in version B, then add the melody and note-by-note lyr: lines for bars 1–8. The example includes the same first eight chord and rhythm cells as version A. Preserve each note duration and rest.' },
      step9: { title: 'Add the last eight melody bars', body: 'Complete bars 9–16 with the matching melody and lyr: lines. Keep the same chords and rhythm cells as version A, including the same eight % bars.' },
      step10: { title: 'Check and save version B', body: 'Verify the melody staff, accompaniment rhythm staff, lyrics, zero Problems diagnostics, PDF, and reload. Keep both A and B as separate files.' }
    }
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
