const pendingSaves = new Map<string, Promise<void>>();

/** Serialize saves to a Drive file within this browser app instance. */
export async function serializeDriveSave<T>(accountId: string, fileId: string, operation: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([accountId, fileId]);
  const previous = pendingSaves.get(key);
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pendingSaves.set(key, current);

  try {
    await previous;
    return await operation();
  } finally {
    release();
    if (pendingSaves.get(key) === current) pendingSaves.delete(key);
  }
}
