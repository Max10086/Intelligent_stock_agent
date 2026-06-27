import type { Language } from '../types.ts';

export const UI_LANGUAGE_STORAGE_KEY = 'intelligentStockAgentUiLanguage';

export function readStoredUiLanguage(): Language | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return raw === 'cn' || raw === 'en' ? raw : null;
  } catch {
    return null;
  }
}

export function persistUiLanguage(lang: Language): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Best-effort preference only.
  }
}
