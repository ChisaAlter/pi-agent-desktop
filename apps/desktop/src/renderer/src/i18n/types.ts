// i18n context 类型 — useI18n hook 返回这个 shape

import type { SupportedLocale } from './config';

export type Locale = SupportedLocale;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  ready: boolean;
}
