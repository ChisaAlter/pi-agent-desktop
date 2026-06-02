// IPC 错误本地化辅助 (v1.0.6.1)
// 主进程 IPC handler 失败时返 IpcError 形状 ({ code, params, fallback }).
// 渲染层拿到结果先判 IpcError, 然后用 t() 翻译 code; 找不到 i18n 词条
// 时降级用 fallback (兜底中文, 至少 dev 阶段好排查).
//
// 业务代码用法:
//   const result = await window.piAPI.piInstall();
//   if (isIpcError(result)) {
//     toast.error(translateIpcError(result));
//   } else {
//     // 成功路径
//   }
//
// 之所以 t() 在 helper 里调: 集中处理 "code 找不到 / params 类型不对" 等 fallback,
// 业务代码不用关心 i18n 缺失的细节.

import type { IpcError } from "@shared";
import { isIpcError as isIpcErrorShared } from "@shared";
import { useI18n } from "./I18nProvider";

/** 守卫 re-export 包装: 让 i18n/index.ts 一处能 export isIpcError (TS 类型收窄) */
export const isIpcError = isIpcErrorShared;

/** 翻译单个 IpcError 到当前 locale 的字符串. 失败时降级 fallback. */
export function translateIpcError(err: IpcError, t: (key: string, options?: Record<string, unknown>) => string): string {
    // 防御: params 类型不匹配 t() 期望的, 用空对象
    const safeParams = (err.params ?? {}) as Record<string, unknown>;
    try {
        const translated = t(err.code, safeParams);
        // i18next 缺 key 时返 key 本身; 如果翻译结果等于 key 字符串, 说明缺词条
        if (translated === err.code) {
            return err.fallback;
        }
        return translated;
    } catch {
        return err.fallback;
    }
}

/** React hook 包装: 直接传 IpcError, 拿翻译后的字符串 */
export function useTranslateIpcError(): (err: IpcError) => string {
    const { t } = useI18n();
    return (err: IpcError) => translateIpcError(err, t);
}
