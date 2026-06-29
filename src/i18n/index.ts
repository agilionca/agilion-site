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

export function getAlternatePath(currentPath: string, targetLang: Lang): string {
  const withoutPrefix = currentPath.replace(/^\/en(?=\/|$)/, '') || '/';
  return targetLang === DEFAULT_LANG ? withoutPrefix : `/en${withoutPrefix}`;
}
