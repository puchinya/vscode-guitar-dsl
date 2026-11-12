const RETIRED_GEMINI_SECRET_KEY = 'guitardsl.geminiApiKey';

type SecretStorageDelete = {
  delete(key: string): PromiseLike<boolean> | PromiseLike<void>;
};

/** Delete the retired Gemini key without letting storage failures escape activation. */
export function deleteRetiredGeminiApiKeyBestEffort(secretStorage: SecretStorageDelete): void {
  try {
    void Promise.resolve(secretStorage.delete(RETIRED_GEMINI_SECRET_KEY)).catch(() => undefined);
  } catch {
    // Best effort only; never read or expose the old value.
  }
}
