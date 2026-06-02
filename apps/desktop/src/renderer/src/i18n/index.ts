// i18n 集中导出 — UI 组件从这里 import useTranslation / I18nProvider / setLocale
export { I18nProvider, useI18n } from './I18nProvider';
export type { Locale, I18nContextValue } from './types';
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from './config';
// v1.0.6.1: i18n-IPC 错误本地化
export { translateIpcError, useTranslateIpcError, isIpcError } from './IpcError';
