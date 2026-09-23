import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'
import ta from './locales/ta.json'
import ms from './locales/ms.json'

/** Singapore's four official languages. zh/ta/ms shipped as English-value
 * stubs when this plumbing was first wired (DECISIONS #57); real Chinese/
 * Malay/Tamil translations landed afterward (git log: "Add real Chinese/
 * Malay/Tamil translations for nav, buttons, and key labels") — no code
 * change needed for that swap, per #57's own design. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'ms', label: 'BM' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

const STORAGE_KEY = 'jaga-language'

function storedLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) return stored as LanguageCode
  } catch {
    // localStorage unavailable (private mode, blocked) — fall through to default
  }
  return 'en'
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      ta: { translation: ta },
      ms: { translation: ms },
    },
    lng: storedLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

export function setLanguage(code: LanguageCode) {
  void i18n.changeLanguage(code)
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // best-effort persistence only
  }
}

export default i18n
