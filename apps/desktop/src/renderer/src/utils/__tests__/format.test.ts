// 时间格式化 helper 测试 (v1.0.9)
//
// 覆盖:
// 1. toDate: 各种输入 (Date / number / string / null / undefined / 无效)
// 2. formatTime / formatDateTime / formatDate: 命中 + 无效输入降级空串
// 3. formatIso: 输出 ISO 字符串, 无效输入空串
// 4. formatRelative: 不同时间差 (秒/分/时/天/月) 走不同分支
// 5. formatDuration: 毫秒/秒/分, 进行中, 负值
// 6. isValidTimestamp: 类型守卫

import { describe, it, expect, vi } from "vitest";
import {
    toDate,
    formatTime,
    formatDateTime,
    formatDate,
    formatIso,
    formatRelative,
    formatDuration,
    isValidTimestamp,
    isNumberOrUndefined,
} from "../format";

describe("toDate", () => {
    it("Date 实例", () => {
        const d = new Date(2026, 5, 2, 14, 32, 5);
        expect(toDate(d)).toBe(d); // 同一引用
    });

    it("number (ms epoch)", () => {
        const ms = new Date(2026, 5, 2).getTime();
        const d = toDate(ms);
        expect(d).toBeInstanceOf(Date);
        expect(d?.getFullYear()).toBe(2026);
    });

    it("string (ISO)", () => {
        const d = toDate("2026-06-02T14:32:05Z");
        expect(d).toBeInstanceOf(Date);
        expect(d?.getFullYear()).toBe(2026);
    });

    it("null / undefined → null", () => {
        expect(toDate(null)).toBeNull();
        expect(toDate(undefined)).toBeNull();
    });

    it("无效 string / number → null (不抛)", () => {
        expect(toDate("not a date")).toBeNull();
        expect(toDate(NaN)).toBeNull();
    });

    it("无效 Date 实例 → null", () => {
        expect(toDate(new Date("invalid"))).toBeNull();
    });

    it("非时间类型 (boolean / object) → null", () => {
        expect(toDate(true)).toBeNull();
        expect(toDate({ foo: 1 })).toBeNull();
    });
});

describe("formatTime / formatDateTime / formatDate / formatIso", () => {
    const ts = new Date(2026, 5, 2, 14, 32, 5).getTime(); // 本地时区

    it("formatTime 返本地时区时间串", () => {
        const s = formatTime(ts);
        // toLocaleTimeString 格式依赖 locale; 至少含冒号
        expect(s).toContain(":");
    });

    it("formatDateTime 含日期+时间", () => {
        const s = formatDateTime(ts);
        expect(s).toContain("2026");
    });

    it("formatDate 返短日期", () => {
        const s = formatDate(ts);
        expect(s).toMatch(/2026/);
    });

    it("formatIso 返 ISO 字符串", () => {
        const s = formatIso(ts);
        expect(s).toBe(new Date(ts).toISOString());
    });

    it("无效输入返空串 (不是 'Invalid Date')", () => {
        expect(formatTime(null)).toBe("");
        expect(formatTime(undefined)).toBe("");
        expect(formatTime("bad")).toBe("");
        expect(formatDateTime(null)).toBe("");
        expect(formatDate(NaN)).toBe("");
        expect(formatIso(null)).toBe("");
    });
});

describe("formatRelative", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    // 简版 t: 跟 v1.0.9 中文映射一致, 验证函数本身不依赖具体 i18next 实例
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("< 60s → 刚刚", () => {
        expect(formatRelative(new Date(now.getTime() - 30_000), tZh, now)).toBe("刚刚");
    });

    // wave-110 residual: boundary just under 60s still justNow
    it("59s → 刚刚, 60s → 1 分钟前", () => {
        expect(formatRelative(new Date(now.getTime() - 59_000), tZh, now)).toBe("刚刚");
        expect(formatRelative(new Date(now.getTime() - 60_000), tZh, now)).toBe("1 分钟前");
    });

    it("1 分钟前", () => {
        expect(formatRelative(new Date(now.getTime() - 60_000), tZh, now)).toBe("1 分钟前");
    });

    it("1 小时前", () => {
        expect(formatRelative(new Date(now.getTime() - 60 * 60_000), tZh, now)).toBe("1 小时前");
    });

    it("1 天前", () => {
        expect(formatRelative(new Date(now.getTime() - 24 * 60 * 60_000), tZh, now)).toBe("1 天前");
    });

    it("> 30 天 → 退化到 formatDate (短日期)", () => {
        const past = new Date(now.getTime() - 60 * 24 * 60 * 60_000);
        const s = formatRelative(past, tZh, now);
        expect(s).toMatch(/2025|2026/); // 短日期格式
        expect(s).not.toContain("天前");
    });

    it("未来时间 (本地时钟漂移) → '刚刚'", () => {
        expect(formatRelative(new Date(now.getTime() + 60_000), tZh, now)).toBe("刚刚");
    });

    it("无效输入 → 空串 (t 不会被调)", () => {
        const tSpy = vi.fn(tZh);
        expect(formatRelative(null, tSpy, now)).toBe("");
        expect(formatRelative("bad", tSpy, now)).toBe("");
        expect(tSpy).not.toHaveBeenCalled();
    });

    it("en locale 走分钟/小时分支 → 英文串", () => {
        const tEn = (key: string, opts?: Record<string, unknown>): string => {
            const n = opts?.count as number | undefined;
            switch (key) {
                case "common.time.minutesAgo": return `${n} min ago`;
                case "common.time.hoursAgo": return `${n} h ago`;
                default: return key;
            }
        };
        expect(formatRelative(new Date(now.getTime() - 5 * 60_000), tEn, now)).toBe("5 min ago");
        expect(formatRelative(new Date(now.getTime() - 3 * 60 * 60_000), tEn, now)).toBe("3 h ago");
    });

    // wave-172 residual
    it("29 天仍 daysAgo；30 天起退化到短日期", () => {
        expect(formatRelative(new Date(now.getTime() - 29 * 24 * 60 * 60_000), tZh, now)).toBe("29 天前");
        const day30 = formatRelative(new Date(now.getTime() - 30 * 24 * 60 * 60_000), tZh, now);
        expect(day30).not.toContain("天前");
        expect(day30.length).toBeGreaterThan(0);
    });
});

describe("formatDuration", () => {
    const start = new Date(2026, 5, 2, 14, 0, 0).getTime();

    it("毫秒级: 350ms", () => {
        expect(formatDuration(start, start + 350)).toBe("350ms");
    });

    it("秒级: 1.2s", () => {
        expect(formatDuration(start, start + 1_234)).toBe("1.2s");
    });

    it("分级: 2m 3s", () => {
        expect(formatDuration(start, start + 2 * 60_000 + 3_000)).toBe("2m 3s");
    });

    it("end=undefined + now → 进行中 (用 now 替代)", () => {
        // start = 1970-01-01, now = 大约 2026 → 巨大数字, 走 '2m 3s' 分支太短
        // 用相对时间测: start 跟 now 差 30s
        const s = new Date(Date.now() - 30_000).getTime();
        const result = formatDuration(s);
        // 30s 应该走 < 60_000 分支, toFixed(1)
        expect(result).toMatch(/\d+\.\ds/);
    });

    it("负值 → 0s (时钟漂移兜底)", () => {
        expect(formatDuration(start, start - 100)).toBe("0s");
    });

    it("start 无效 → 空串", () => {
        expect(formatDuration(null)).toBe("");
    });

    // wave-110 residual
    it("end 无效 → 进行中", () => {
        expect(formatDuration(start, "not-a-date")).toBe("进行中");
        expect(formatDuration(start, NaN)).toBe("进行中");
    });

    it("exactly 0ms and 999ms stay in ms branch", () => {
        expect(formatDuration(start, start)).toBe("0ms");
        expect(formatDuration(start, start + 999)).toBe("999ms");
    });
});

describe("isValidTimestamp", () => {
    it("Date / number / ISO string → true", () => {
        expect(isValidTimestamp(new Date())).toBe(true);
        expect(isValidTimestamp(1_700_000_000_000)).toBe(true);
        expect(isValidTimestamp("2026-06-02")).toBe(true);
    });

    it("null / undefined / 'bad' / {} → false", () => {
        expect(isValidTimestamp(null)).toBe(false);
        expect(isValidTimestamp(undefined)).toBe(false);
        expect(isValidTimestamp("bad")).toBe(false);
        expect(isValidTimestamp({})).toBe(false);
    });
});

describe("isNumberOrUndefined", () => {
    it("accepts number and undefined only", () => {
        expect(isNumberOrUndefined(0)).toBe(true);
        expect(isNumberOrUndefined(1_700_000_000_000)).toBe(true);
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined(null)).toBe(false);
        expect(isNumberOrUndefined("1")).toBe(false);
        expect(isNumberOrUndefined(new Date())).toBe(false);
        // wave-110 residual: typeof NaN is number
        expect(isNumberOrUndefined(Number.NaN)).toBe(true);
        expect(isNumberOrUndefined(Number.POSITIVE_INFINITY)).toBe(true);
    });
});

// wave-118 residual
describe("format residual boundaries", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatRelative hits 59min / 23h / 29d edges before next unit", () => {
        expect(formatRelative(new Date(now.getTime() - 59 * 60_000), tZh, now)).toBe("59 分钟前");
        expect(formatRelative(new Date(now.getTime() - 60 * 60_000), tZh, now)).toBe("1 小时前");
        expect(formatRelative(new Date(now.getTime() - 23 * 60 * 60_000), tZh, now)).toBe("23 小时前");
        expect(formatRelative(new Date(now.getTime() - 24 * 60 * 60_000), tZh, now)).toBe("1 天前");
        expect(formatRelative(new Date(now.getTime() - 29 * 24 * 60 * 60_000), tZh, now)).toBe("29 天前");
        const thirtyDays = formatRelative(new Date(now.getTime() - 30 * 24 * 60 * 60_000), tZh, now);
        expect(thirtyDays).not.toContain("天前");
        expect(thirtyDays).toMatch(/2026|2025/);
    });

    it("formatDuration crosses 1000ms and 60s boundaries", () => {
        const start = new Date(2026, 5, 2, 14, 0, 0).getTime();
        expect(formatDuration(start, start + 1000)).toBe("1.0s");
        expect(formatDuration(start, start + 59_999)).toMatch(/^60\.0s$|^59\.9s$/);
        expect(formatDuration(start, start + 60_000)).toBe("1m 0s");
        expect(formatDuration(start, start + 61_000)).toBe("1m 1s");
    });

    it("toDate accepts Date and rejects empty string", () => {
        const d = new Date(2026, 0, 1);
        expect(toDate(d)).toBe(d);
        expect(toDate("")).toBeNull();
        expect(isValidTimestamp("")).toBe(false);
        expect(isValidTimestamp(d)).toBe(true);
    });

    it("format* accepts Date instances directly", () => {
        const d = new Date(2026, 5, 2, 14, 32, 5);
        expect(formatIso(d)).toBe(d.toISOString());
        expect(formatTime(d)).toContain(":");
        expect(formatDate(d)).toMatch(/2026/);
    });
});

// wave-126 residual
describe("format residual (wave-126)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatRelative treats future timestamps as justNow and invalid as empty", () => {
        expect(formatRelative(new Date(now.getTime() + 60_000), tZh, now)).toBe("刚刚");
        expect(formatRelative("not-a-date", tZh, now)).toBe("");
        expect(formatRelative(null, tZh, now)).toBe("");
    });

    it("formatDuration uses now when end is nullish; invalid end → 进行中; clamps negative to 0s", () => {
        const start = new Date(2026, 5, 2, 14, 0, 0);
        // product: end == null → substitute `now` (not "进行中")
        expect(formatDuration(start, undefined, now)).toBe("32m 5s");
        expect(formatDuration(start, null, now)).toBe("32m 5s");
        // non-null but invalid end → toDate fails → "进行中"
        expect(formatDuration(start, "bad-end", now)).toBe("进行中");
        expect(formatDuration(start, new Date(start.getTime() - 1000))).toBe("0s");
        expect(formatDuration(start, start.getTime() + 350)).toBe("350ms");
        expect(formatDuration(null, now)).toBe("");
    });

    it("isNumberOrUndefined only allows number or undefined", () => {
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined(0)).toBe(true);
        expect(isNumberOrUndefined(NaN)).toBe(true);
        expect(isNumberOrUndefined("1")).toBe(false);
        expect(isNumberOrUndefined(null)).toBe(false);
        expect(isNumberOrUndefined(true)).toBe(false);
    });

    it("formatIso/formatDateTime return empty for invalid and ISO for epoch numbers", () => {
        expect(formatIso("nope")).toBe("");
        expect(formatDateTime(undefined)).toBe("");
        const ms = Date.UTC(2026, 5, 2, 0, 0, 0);
        expect(formatIso(ms)).toBe(new Date(ms).toISOString());
    });
});

// wave-149 residual
describe("format residual (wave-149)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("toDate rejects boolean/array/function and accepts numeric epoch 0", () => {
        expect(toDate(false)).toBeNull();
        expect(toDate([])).toBeNull();
        expect(toDate(() => 0)).toBeNull();
        const d = toDate(0);
        expect(d).toBeInstanceOf(Date);
        expect(d?.getTime()).toBe(0);
        expect(isValidTimestamp(0)).toBe(true);
        expect(isValidTimestamp(false)).toBe(false);
    });

    it("formatDuration multi-minute with zero remainder seconds", () => {
        const start = new Date(2026, 5, 2, 14, 0, 0).getTime();
        expect(formatDuration(start, start + 5 * 60_000)).toBe("5m 0s");
        expect(formatDuration(start, start + 5 * 60_000 + 500)).toBe("5m 0s");
        expect(formatDuration(start, start + 5 * 60_000 + 1_000)).toBe("5m 1s");
    });

    it("formatRelative floor boundaries at 0s and 3599s stay in minute/hour buckets", () => {
        expect(formatRelative(new Date(now.getTime() - 0), tZh, now)).toBe("刚刚");
        // 3599s = 59m 59s → minutes branch (floor min = 59)
        expect(formatRelative(new Date(now.getTime() - 3599_000), tZh, now)).toBe("59 分钟前");
        // 3600s → 1 hour
        expect(formatRelative(new Date(now.getTime() - 3600_000), tZh, now)).toBe("1 小时前");
    });

    it("formatTime/formatDate empty for empty string and Invalid Date instance", () => {
        expect(formatTime("")).toBe("");
        expect(formatDate(new Date("invalid"))).toBe("");
        expect(formatIso(Number.NaN)).toBe("");
        expect(formatDateTime(Number.POSITIVE_INFINITY)).toBe("");
    });
});

// wave-158 residual
describe("format residual (wave-158)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatRelative day/month boundaries and falls back to formatDate after 30 days", () => {
        // 23h 59m → hours
        expect(formatRelative(new Date(now.getTime() - 23 * 3600_000 - 59 * 60_000), tZh, now)).toBe("23 小时前");
        // 24h → 1 day
        expect(formatRelative(new Date(now.getTime() - 24 * 3600_000), tZh, now)).toBe("1 天前");
        // 29 days → days
        expect(formatRelative(new Date(now.getTime() - 29 * 24 * 3600_000), tZh, now)).toBe("29 天前");
        // 30 days → short date fallback (formatDate)
        const old = new Date(now.getTime() - 30 * 24 * 3600_000);
        expect(formatRelative(old, tZh, now)).toBe(formatDate(old));
        expect(formatRelative(old, tZh, now)).toMatch(/2026|6|5|6月|May|Jun/);
    });

    it("formatDuration second-boundary and multi-minute remainders", () => {
        const start = new Date(2026, 5, 2, 14, 0, 0).getTime();
        expect(formatDuration(start, start + 999)).toBe("999ms");
        expect(formatDuration(start, start + 1000)).toBe("1.0s");
        expect(formatDuration(start, start + 59_900)).toBe("59.9s");
        expect(formatDuration(start, start + 60_000)).toBe("1m 0s");
        expect(formatDuration(start, start + 90_500)).toBe("1m 30s");
    });

    it("toDate preserves Date identity and rejects bigint/symbol", () => {
        const d = new Date(2026, 0, 1);
        expect(toDate(d)).toBe(d);
        expect(toDate(Symbol("t") as never)).toBeNull();
        expect(toDate(1n as never)).toBeNull();
        expect(isValidTimestamp(d)).toBe(true);
        expect(isNumberOrUndefined(Number.POSITIVE_INFINITY)).toBe(true);
    });
});

// wave-177 residual
describe("format residual (wave-177)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatRelative treats future times and sub-minute diffs as justNow", () => {
        expect(formatRelative(new Date(now.getTime() + 60_000), tZh, now)).toBe("刚刚");
        expect(formatRelative(new Date(now.getTime() - 59_000), tZh, now)).toBe("刚刚");
        expect(formatRelative(new Date(now.getTime() - 60_000), tZh, now)).toBe("1 分钟前");
    });

    it("formatDuration missing end uses now; invalid end is 进行中; negative span is 0s", () => {
        const start = new Date(now.getTime() - 1500);
        const live = formatDuration(start, undefined, now);
        expect(live).toBe("1.5s");
        expect(formatDuration(start, "not-a-date", now)).toBe("进行中");
        expect(formatDuration(now, new Date(now.getTime() - 5000), now)).toBe("0s");
        expect(formatDuration(null)).toBe("");
    });

    it("toDate/isValidTimestamp reject objects/arrays/booleans", () => {
        expect(toDate({})).toBeNull();
        expect(toDate([])).toBeNull();
        expect(toDate(true)).toBeNull();
        expect(toDate(false)).toBeNull();
        expect(isValidTimestamp({})).toBe(false);
        expect(isValidTimestamp("2026-06-02T00:00:00.000Z")).toBe(true);
        expect(formatIso("2026-06-02T00:00:00.000Z")).toBe("2026-06-02T00:00:00.000Z");
    });
});

// wave-186 residual
describe("format residual (wave-186)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatDuration uses ms under 1s, fixed.1s under 1m, and m/s above", () => {
        const start = now.getTime();
        expect(formatDuration(start, start + 350, now)).toBe("350ms");
        expect(formatDuration(start, start + 999, now)).toBe("999ms");
        expect(formatDuration(start, start + 1000, now)).toBe("1.0s");
        expect(formatDuration(start, start + 59_000, now)).toBe("59.0s");
        expect(formatDuration(start, start + 60_000, now)).toBe("1m 0s");
        expect(formatDuration(start, start + 125_000, now)).toBe("2m 5s");
    });

    it("formatRelative hour/day boundaries and >30 days falls back to formatDate", () => {
        expect(formatRelative(new Date(now.getTime() - 59 * 60_000), tZh, now)).toBe("59 分钟前");
        expect(formatRelative(new Date(now.getTime() - 60 * 60_000), tZh, now)).toBe("1 小时前");
        expect(formatRelative(new Date(now.getTime() - 23 * 60 * 60_000), tZh, now)).toBe("23 小时前");
        expect(formatRelative(new Date(now.getTime() - 24 * 60 * 60_000), tZh, now)).toBe("1 天前");
        expect(formatRelative(new Date(now.getTime() - 29 * 24 * 60 * 60_000), tZh, now)).toBe("29 天前");
        const old = new Date(now.getTime() - 31 * 24 * 60 * 60_000);
        expect(formatRelative(old, tZh, now)).toBe(formatDate(old));
    });

    it("isNumberOrUndefined accepts number and undefined only", () => {
        expect(isNumberOrUndefined(0)).toBe(true);
        expect(isNumberOrUndefined(1.5)).toBe(true);
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined(null)).toBe(false);
        expect(isNumberOrUndefined("1")).toBe(false);
        expect(isNumberOrUndefined(NaN)).toBe(true); // typeof number
        expect(toDate(NaN)).toBeNull();
        expect(formatTime(null)).toBe("");
        expect(formatDateTime(undefined)).toBe("");
        expect(formatDate("not-a-date")).toBe("");
    });
});

// wave-193 residual
describe("format residual (wave-193)", () => {
    const now = new Date(2026, 5, 2, 14, 32, 5);
    const tZh = (key: string, opts?: Record<string, unknown>): string => {
        const n = opts?.count as number | undefined;
        switch (key) {
            case "common.time.justNow": return "刚刚";
            case "common.time.minutesAgo": return `${n} 分钟前`;
            case "common.time.hoursAgo": return `${n} 小时前`;
            case "common.time.daysAgo": return `${n} 天前`;
            default: return key;
        }
    };

    it("formatDuration empty start, in-progress end, and negative span", () => {
        expect(formatDuration(null, now, now)).toBe("");
        expect(formatDuration(undefined, now, now)).toBe("");
        expect(formatDuration("bad", now, now)).toBe("");
        // end omitted → uses now; valid start
        expect(formatDuration(now.getTime() - 500, undefined, now)).toBe("500ms");
        // invalid end with valid start → 进行中
        expect(formatDuration(now, "not-a-date", now)).toBe("进行中");
        // negative duration clamps to 0s
        expect(formatDuration(now.getTime() + 5000, now.getTime(), now)).toBe("0s");
    });

    it("formatRelative justNow for sub-minute and future clock drift", () => {
        expect(formatRelative(new Date(now.getTime() - 0), tZh, now)).toBe("刚刚");
        expect(formatRelative(new Date(now.getTime() - 59_000), tZh, now)).toBe("刚刚");
        expect(formatRelative(new Date(now.getTime() - 60_000), tZh, now)).toBe("1 分钟前");
        // future → justNow
        expect(formatRelative(new Date(now.getTime() + 60_000), tZh, now)).toBe("刚刚");
        expect(formatRelative(null, tZh, now)).toBe("");
    });

    it("toDate keeps same Date instance and rejects Invalid Date / arrays", () => {
        const d = new Date(2026, 0, 1);
        expect(toDate(d)).toBe(d);
        expect(toDate(new Date(Number.NaN))).toBeNull();
        expect(toDate([])).toBeNull();
        expect(toDate({ getTime: () => 1 })).toBeNull();
        expect(isValidTimestamp(d)).toBe(true);
        expect(isValidTimestamp(Number.NaN)).toBe(false);
        expect(formatIso(d)).toBe(d.toISOString());
        expect(formatIso(Number.NaN)).toBe("");
    });

    // wave-197 residual
    it("formatDuration minute boundary and isNumberOrUndefined rejects boolean/string", () => {
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatDuration(now.getTime() - 60_000, now, now)).toBe("1m 0s");
        expect(formatDuration(now.getTime() - 61_500, now, now)).toBe("1m 1s");
        expect(formatDuration(now.getTime() - 999, now, now)).toBe("999ms");
        expect(formatDuration(now.getTime() - 1000, now, now)).toBe("1.0s");
        expect(isNumberOrUndefined(false)).toBe(false);
        expect(isNumberOrUndefined("0")).toBe(false);
        expect(isNumberOrUndefined(0)).toBe(true);
        expect(isValidTimestamp("2026-07-21T00:00:00.000Z")).toBe(true);
        expect(isValidTimestamp("not-a-date")).toBe(false);
    });

    // wave-202 residual
    it("formatDuration zero/null end uses now; invalid end → 进行中; negative delta 0s", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        const now = new Date("2026-07-21T12:00:05.000Z");
        expect(formatDuration(start, null, now)).toBe("5.0s");
        expect(formatDuration(start, undefined, now)).toBe("5.0s");
        expect(formatDuration(start, "bad-end", now)).toBe("进行中");
        expect(formatDuration(start, start.getTime() - 1, now)).toBe("0s");
        expect(formatDuration(start, start, now)).toBe("0ms");
        expect(toDate(false)).toBeNull();
        expect(toDate(true)).toBeNull();
        expect(isNumberOrUndefined(Number.POSITIVE_INFINITY)).toBe(true);
        expect(isNumberOrUndefined(Number.NaN)).toBe(true);
        expect(isNumberOrUndefined([])).toBe(false);
    });

    it("formatIso/formatTime empty on invalid; isValidTimestamp accepts epoch numbers", () => {
        expect(formatIso("not-iso")).toBe("");
        expect(formatTime(undefined)).toBe("");
        expect(formatDateTime(null)).toBe("");
        expect(formatDate({})).toBe("");
        expect(isValidTimestamp(0)).toBe(true);
        expect(isValidTimestamp(1_700_000_000_000)).toBe(true);
        expect(isValidTimestamp(Number.NaN)).toBe(false);
    });

    // wave-208 residual
    it("toDate accepts Date/ISO/ms and rejects empty string/object/array", () => {
        const d = new Date("2026-07-21T00:00:00.000Z");
        expect(toDate(d)).toBe(d);
        expect(toDate(d.toISOString())?.toISOString()).toBe(d.toISOString());
        expect(toDate(d.getTime())?.toISOString()).toBe(d.toISOString());
        expect(toDate("")).toBeNull();
        expect(toDate("   ")).toBeNull();
        expect(toDate([])).toBeNull();
        expect(toDate({ getTime: () => 1 })).toBeNull();
        expect(toDate(new Date(Number.NaN))).toBeNull();
    });

    it("formatDuration multi-minute and formatIso round-trips valid inputs", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        const end = new Date("2026-07-21T12:03:05.000Z");
        expect(formatDuration(start, end)).toBe("3m 5s");
        expect(formatDuration(start.getTime(), end.getTime())).toBe("3m 5s");
        expect(formatIso(start)).toBe("2026-07-21T12:00:00.000Z");
        expect(formatIso(start.getTime())).toBe("2026-07-21T12:00:00.000Z");
        expect(isValidTimestamp(start)).toBe(true);
        expect(isValidTimestamp(start.toISOString())).toBe(true);
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined(null)).toBe(false);
    });

    // wave-212 residual
    it("formatDuration 0ms branch, sub-minute fixed.1s, invalid end → 进行中", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        expect(formatDuration(start, start)).toBe("0ms");
        expect(formatDuration(start, new Date(start.getTime() + 45_000))).toBe("45.0s");
        expect(formatDuration(start, new Date(start.getTime() + 60_000))).toBe("1m 0s");
        expect(formatDuration(start, "nope")).toBe("进行中");
        expect(isNumberOrUndefined(42)).toBe(true);
        expect(isNumberOrUndefined("42")).toBe(false);
        expect(isValidTimestamp("")).toBe(false);
        expect(isValidTimestamp(null)).toBe(false);
    });

    // wave-217 residual
    it("formatDuration clamps negative span to 0s; omitted end uses now; invalid start empty", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        const earlier = new Date("2026-07-21T11:00:00.000Z");
        expect(formatDuration(start, earlier)).toBe("0s");
        const now = new Date(start.getTime() + 1500);
        expect(formatDuration(start, undefined, now)).toBe("1.5s");
        expect(formatDuration(start, null, now)).toBe("1.5s");
        expect(formatDuration("not-a-date", now)).toBe("");
        expect(formatDuration(undefined, now)).toBe("");
    });

    it("toDate rejects bool/object; isNumberOrUndefined accepts NaN as number; formatRelative 0ms justNow", () => {
        expect(toDate(true)).toBeNull();
        expect(toDate(false)).toBeNull();
        expect(toDate({ toString: () => "2026-01-01" })).toBeNull();
        expect(isNumberOrUndefined(Number.NaN)).toBe(true);
        expect(isNumberOrUndefined(0)).toBe(true);
        const tZh = (key: string) => (key === "common.time.justNow" ? "刚刚" : key);
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(now, tZh, now)).toBe("刚刚");
        expect(formatRelative(now.getTime(), tZh, now)).toBe("刚刚");
    });

    // wave-238 residual
    it("formatRelative buckets min/hour/day and falls back to formatDate after 30 days", () => {
        const t = (key: string, opts?: Record<string, unknown>) =>
            opts?.count != null ? `${key}:${opts.count}` : key;
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(new Date(now.getTime() - 90_000), t, now)).toBe(
            "common.time.minutesAgo:1",
        );
        expect(formatRelative(new Date(now.getTime() - 2 * 3_600_000), t, now)).toBe(
            "common.time.hoursAgo:2",
        );
        expect(formatRelative(new Date(now.getTime() - 3 * 86_400_000), t, now)).toBe(
            "common.time.daysAgo:3",
        );
        // future → justNow
        expect(formatRelative(new Date(now.getTime() + 60_000), t, now)).toBe("common.time.justNow");
        // >30 days → short date via formatDate (locale-dependent but non-empty)
        const old = new Date(now.getTime() - 40 * 86_400_000);
        const long = formatRelative(old, t, now);
        expect(long).toBe(formatDate(old));
        expect(long.length).toBeGreaterThan(0);
    });

    it("formatIso/formatTime empty for invalid; valid Date returns ISO and locale time", () => {
        expect(formatIso(null)).toBe("");
        expect(formatIso("not-a-date")).toBe("");
        expect(formatTime(undefined)).toBe("");
        const d = new Date("2026-07-21T12:34:56.000Z");
        expect(formatIso(d)).toBe(d.toISOString());
        expect(formatTime(d)).toBe(d.toLocaleTimeString());
        expect(formatDateTime(d)).toBe(d.toLocaleString());
        expect(isValidTimestamp(d)).toBe(true);
        expect(isValidTimestamp(Number.NaN)).toBe(false);
    });

    it("formatDuration minutes branch and sub-second ms branch", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        expect(formatDuration(start, new Date(start.getTime() + 250))).toBe("250ms");
        expect(formatDuration(start, new Date(start.getTime() + 125_000))).toBe("2m 5s");
    });

    // wave-254 residual
    it("toDate accepts ISO string and ms epoch; rejects boolean/object/empty string", () => {
        const iso = "2026-07-21T08:00:00.000Z";
        const fromIso = toDate(iso);
        expect(fromIso?.toISOString()).toBe(iso);
        const ms = Date.parse(iso);
        expect(toDate(ms)?.getTime()).toBe(ms);
        expect(toDate(true)).toBeNull();
        expect(toDate({})).toBeNull();
        expect(toDate("")).toBeNull();
        expect(toDate(Number.NaN)).toBeNull();
    });

    it("formatRelative day boundary 23h59 stays hours; 24h becomes 1 day", () => {
        const t = (key: string, opts?: Record<string, unknown>) =>
            opts?.count != null ? `${key}:${opts.count}` : key;
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(new Date(now.getTime() - 23 * 3_600_000 - 59 * 60_000), t, now)).toBe(
            "common.time.hoursAgo:23",
        );
        expect(formatRelative(new Date(now.getTime() - 24 * 3_600_000), t, now)).toBe(
            "common.time.daysAgo:1",
        );
        expect(formatRelative(new Date(now.getTime() - 59_000), t, now)).toBe("common.time.justNow");
    });
    // wave-282 residual
    it("formatDuration 0s for negative span; 999ms stays ms; 1000ms becomes 1.0s", () => {
        const start = new Date("2026-07-21T12:00:00.000Z");
        expect(formatDuration(start, new Date(start.getTime() - 5))).toBe("0s");
        expect(formatDuration(start, new Date(start.getTime() + 999))).toBe("999ms");
        expect(formatDuration(start, new Date(start.getTime() + 1000))).toBe("1.0s");
        expect(formatDuration(start, new Date(start.getTime() + 59_900))).toBe("59.9s");
        expect(formatDuration(start, new Date(start.getTime() + 60_000))).toBe("1m 0s");
    });

    it("formatRelative minute boundary at 60s; invalid/null empty; isValidTimestamp ISO/number", () => {
        const t = (key: string, opts?: Record<string, unknown>) =>
            opts?.count != null ? `${key}:${opts.count}` : key;
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(new Date(now.getTime() - 59_999), t, now)).toBe("common.time.justNow");
        expect(formatRelative(new Date(now.getTime() - 60_000), t, now)).toBe("common.time.minutesAgo:1");
        expect(formatRelative(null, t, now)).toBe("");
        expect(formatRelative("not-a-date", t, now)).toBe("");
        expect(isValidTimestamp("2026-07-21T12:00:00.000Z")).toBe(true);
        expect(isValidTimestamp(Date.parse("2026-07-21T12:00:00.000Z"))).toBe(true);
        expect(isValidTimestamp("")).toBe(false);
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined("1")).toBe(false);
    });





    // wave-290 residual
    it("toDate rejects objects/booleans; format* empty on invalid; formatIso uses UTC ISO", () => {
        expect(toDate({})).toBeNull();
        expect(toDate(true)).toBeNull();
        expect(toDate(false)).toBeNull();
        expect(toDate([])).toBeNull();
        expect(formatTime(null)).toBe("");
        expect(formatDateTime(undefined)).toBe("");
        expect(formatDate("nope")).toBe("");
        const d = new Date("2026-07-21T12:34:56.000Z");
        expect(formatIso(d)).toBe("2026-07-21T12:34:56.000Z");
        expect(formatIso("bad")).toBe("");
    });

    it("formatRelative future→justNow; hours/days thresholds; >30 days uses formatDate", () => {
        const t = (key: string, opts?: Record<string, unknown>) =>
            opts?.count != null ? `${key}:${opts.count}` : key;
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(new Date(now.getTime() + 5_000), t, now)).toBe("common.time.justNow");
        expect(formatRelative(new Date(now.getTime() - 3_600_000), t, now)).toBe("common.time.hoursAgo:1");
        expect(formatRelative(new Date(now.getTime() - 86_400_000), t, now)).toBe("common.time.daysAgo:1");
        const old = new Date(now.getTime() - 31 * 86_400_000);
        const rel = formatRelative(old, t, now);
        // product degrades to formatDate which is locale-dependent non-empty
        expect(rel).not.toBe("");
        expect(rel).not.toMatch(/common\.time\./);
        expect(formatDuration(null)).toBe("");
        const start = new Date(now.getTime() - 2_000);
        expect(formatDuration(start, undefined, now)).toBe("2.0s");
        expect(formatDuration(start, "bad", now)).toBe("进行中");
    });


    // wave-296 residual
    it("formatDuration ms/s/m boundaries; invalid end → 进行中; negative → 0s", () => {
        const start = Date.parse("2026-07-21T12:00:00.000Z");
        expect(formatDuration(start, start + 0)).toBe("0ms");
        expect(formatDuration(start, start + 999)).toBe("999ms");
        expect(formatDuration(start, start + 1000)).toBe("1.0s");
        expect(formatDuration(start, start + 59_999)).toBe("60.0s");
        expect(formatDuration(start, start + 60_000)).toBe("1m 0s");
        expect(formatDuration(start, start + 61_500)).toBe("1m 1s");
        expect(formatDuration(start, start - 1)).toBe("0s");
        expect(formatDuration(start, "bad")).toBe("进行中");
        expect(formatDuration(null, start)).toBe("");
    });

    it("formatRelative day 29 vs 30 boundary; minutes/hours counts; justNow under 60s", () => {
        const t = (key: string, opts?: Record<string, unknown>) =>
            opts?.count != null ? `${key}:${opts.count}` : key;
        const now = new Date("2026-07-21T12:00:00.000Z");
        expect(formatRelative(new Date(now.getTime() - 59_999), t, now)).toBe("common.time.justNow");
        expect(formatRelative(new Date(now.getTime() - 5 * 60_000), t, now)).toBe("common.time.minutesAgo:5");
        expect(formatRelative(new Date(now.getTime() - 23 * 3_600_000), t, now)).toBe("common.time.hoursAgo:23");
        expect(formatRelative(new Date(now.getTime() - 29 * 86_400_000), t, now)).toBe("common.time.daysAgo:29");
        const d30 = formatRelative(new Date(now.getTime() - 30 * 86_400_000), t, now);
        expect(d30).not.toMatch(/common\.time\./);
        expect(d30.length).toBeGreaterThan(0);
    });

    it("isValidTimestamp and isNumberOrUndefined product guards", () => {
        expect(isValidTimestamp(0)).toBe(true);
        expect(isValidTimestamp(new Date(0))).toBe(true);
        expect(isValidTimestamp(Number.NaN)).toBe(false);
        expect(isValidTimestamp(undefined)).toBe(false);
        expect(isNumberOrUndefined(0)).toBe(true);
        expect(isNumberOrUndefined(undefined)).toBe(true);
        expect(isNumberOrUndefined(null)).toBe(false);
        expect(isNumberOrUndefined("1")).toBe(false);
    });

});
