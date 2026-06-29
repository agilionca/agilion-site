import { ui, type UiKey } from './ui';

export { ui, type UiKey };

export const LANGUAGES = { fr: 'Français', en: 'English' } as const;
export type Lang = keyof typeof LANGUAGES;
export const DEFAULT_LANG: Lang = 'fr';

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang in LANGUAGES) return lang as Lang;
  return DEFAULT_LANG;
}

export function useTranslations(lang: Lang) {
  return function t(key: UiKey): string {
    return (ui[lang][key] ?? ui[DEFAULT_LANG][key] ?? key) as string;
  };
}

export function getLocalePath(path: string, lang: Lang): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return lang === DEFAULT_LANG ? cleanPath : `/en${cleanPath}`;
}

// Slugs asymétriques FR → EN
const ROUTE_MAP_FR_TO_EN: Record<string, string> = {
  '/a-propos': '/en/about',
  '/blogue': '/en/blog',
};
// Inverse automatique
const ROUTE_MAP_EN_TO_FR: Record<string, string> = Object.fromEntries(
  Object.entries(ROUTE_MAP_FR_TO_EN).map(([fr, en]) => [en, fr])
);

export function getAlternatePath(currentPath: string, targetLang: Lang): string {
  // Slugs asymétriques — vérifier la map en premier
  const map = targetLang === 'en' ? ROUTE_MAP_FR_TO_EN : ROUTE_MAP_EN_TO_FR;
  if (map[currentPath]) return map[currentPath];
  // Slugs symétriques — logique existante
  const withoutPrefix = currentPath.replace(/^\/en(?=\/|$)/, '') || '/';
  return targetLang === DEFAULT_LANG ? withoutPrefix : `/en${withoutPrefix}`;
}
