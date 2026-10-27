import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { id } from './locales/id';
import { en } from './locales/en';
import type { Language } from '../types';

/**
 * Mesvee ships its translations in the bundle: no network request is needed on
 * first paint, which keeps onboarding and the lock screen instant and offline.
 */
void i18n.use(initReactI18next).init({
  resources: {
    id: { translation: id },
    en: { translation: en },
  },
  lng: 'id',
  fallbackLng: 'id',
  supportedLngs: ['id', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

/** Applies the persisted language without a full remount. */
export async function setLanguage(language: Language): Promise<void> {
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
  document.documentElement.lang = language;
}

export default i18n;
