const OPENAI_API_KEY_STORAGE_KEY = "openai_api_key";

export function getStoredOpenAiKey(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const key = localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY);
  return key?.trim() || undefined;
}

export function storeOpenAiKey(apiKey: string): void {
  localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, apiKey);
}

export function clearStoredOpenAiKey(): void {
  localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
}
