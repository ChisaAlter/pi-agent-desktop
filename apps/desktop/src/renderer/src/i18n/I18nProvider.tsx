// I18nProvider — 在 App 根部 mount, 提供 t() / locale / setLocale
// locale 优先级: localStorage > navigator.language > DEFAULT_LOCALE
// 切换 locale 时立刻写 localStorage + 调 i18next.changeLanguage, UI 即时更新

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, type SupportedLocale } from './config';
import enUS from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import type { I18nContextValue, Locale } from './types';

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // localStorage 不可用 (隐私模式 / SSR), 走 navigator
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LOCALE;
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('en')) return 'en-US';
  return DEFAULT_LOCALE;
}

// 初始化 i18next (singleton) — 用 zh-CN 作为初始值避免空字典
void i18next.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false }, // React 已经 escape
  returnNull: false, // 缺 key 时返 key 字符串而不是 null, 方便发现漏翻译
});

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { i18n, ready } = useTranslation();
  const [locale, setLocaleState] = useState<Locale>(() => (i18n.language as Locale) || DEFAULT_LOCALE);

  // 故意只跑一次 (mount). 把 i18n / setLocaleState / locale 都过 ref, 避开 deps 警告
  // 又不依赖 i18n.language 防止循环
  const setLocaleStateRef = useRef(setLocaleState);
  setLocaleStateRef.current = setLocaleState;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  useEffect(() => {
    const i = i18nRef.current;
    const fresh = resolveInitialLocale();
    if (fresh !== i.language) {
      void i.changeLanguage(fresh);
    }
    if (fresh !== localeRef.current) {
      setLocaleStateRef.current(fresh);
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    void i18n.changeLanguage(next);
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // localStorage 写入失败 (隐私模式), 不阻塞
    }
  }, [i18n]);

  const t = useCallback<I18nContextValue['t']>(
    (key, options) => i18n.t(key, options) as string,
    [i18n],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, ready }),
    [locale, setLocale, t, ready],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return ctx;
}
