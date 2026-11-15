export function createLatestRequestSequence() {
  let current = 0;
  return {
    begin(): number { current += 1; return current; },
    isLatest(sequence: number): boolean { return sequence === current; },
    invalidate(): void { current += 1; }
  };
}

export function canOpenDriveFile(options: {
  commandAccountId: string;
  currentAccountId: string | undefined;
  commandGeneration: number;
  currentGeneration: number;
  connected: boolean;
  rowAvailable: boolean;
}): boolean {
  return options.connected && options.rowAvailable
    && options.commandAccountId === options.currentAccountId
    && options.commandGeneration === options.currentGeneration;
}

export async function readLocalExplorerRowsIfCurrent<T>(
  readRows: () => Promise<T>,
  isCurrent: () => boolean,
  applyRows: (rows: T) => void
): Promise<boolean> {
  const rows = await readRows();
  if (!isCurrent()) return false;
  applyRows(rows);
  return true;
}
