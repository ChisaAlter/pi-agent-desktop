// 支持的 locale 列表 + 默认值 + localStorage key
// 后续加语言: 加进 SUPPORTED_LOCALES + 在 locales/ 下加对应 .json 即可

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';
export const LOCALE_STORAGE_KEY = 'pi-desktop.locale';
