import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import it from './locales/it.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';
import enDb from './locales/en.db.json';
import frDb from './locales/fr.db.json';
import deDb from './locales/de.db.json';
import itDb from './locales/it.db.json';
import esDb from './locales/es.db.json';
import ptBRDb from './locales/pt-BR.db.json';

export const SUPPORTED = ['en', 'fr', 'de', 'it', 'es', 'pt-BR'];
export const DEFAULT_LOCALE = 'en';

export function normalizeLocale(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'pt' || v === 'pt-br' || v === 'pt_br' || v.startsWith('pt-') || v.startsWith('pt_')) return 'pt-BR';
  const exact = SUPPORTED.find((s) => s.toLowerCase() === v);
  if (exact) return exact;
  const base = v.split(/[-_]/)[0];
  const byBase = SUPPORTED.find((s) => s.toLowerCase() === base);
  if (byBase) return byBase;
  return null;
}

export function detectSystemLocale() {
  try {
    const candidates = [];
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
    for (const c of candidates) {
      const n = normalizeLocale(c);
      if (n) return n;
    }
  } catch {}
  return DEFAULT_LOCALE;
}

const resources = {
  en: { translation: en, db: enDb },
  fr: { translation: fr, db: frDb },
  de: { translation: de, db: deDb },
  it: { translation: it, db: itDb },
  es: { translation: es, db: esDb },
  'pt-BR': { translation: ptBR, db: ptBRDb },
};

let savedLocale = null;
try {
  const v = localStorage.getItem('klondike:language');
  if (v && SUPPORTED.includes(v)) savedLocale = v;
} catch {}

const initialLng = savedLocale || detectSystemLocale();

i18n.use(initReactI18next).init({
  resources,
  lng: initialLng,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED,
  ns: ['translation', 'db'],
  defaultNS: 'translation',
  fallbackNS: 'translation',
  nonExplicitSupportedLngs: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

try {
  document.documentElement.lang = i18n.language || initialLng;
} catch {}

export default i18n;
