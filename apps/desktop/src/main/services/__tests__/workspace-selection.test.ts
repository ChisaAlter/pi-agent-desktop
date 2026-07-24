import { describe, expect, it } from "vitest";
import { getMostRecentlyActiveWorkspace } from "../workspace-selection";

describe("workspace-selection", () => {
    it("prefers the most recently active workspace instead of the first entry", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "default",
                    name: "Default",
                    path: "C:/repo/default",
                    createdAt: 100,
                    lastActiveAt: 100,
                },
                {
                    id: "target",
                    name: "Target",
                    path: "C:/repo/target",
                    createdAt: 200,
                    lastActiveAt: 500,
                },
            ]),
        ).toMatchObject({
            id: "target",
            path: "C:/repo/target",
        });
    });

    it("falls back to createdAt when lastActiveAt is missing", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "older",
                    name: "Older",
                    path: "C:/repo/older",
                    createdAt: 100,
                },
                {
                    id: "newer",
                    name: "Newer",
                    path: "C:/repo/newer",
                    createdAt: 300,
                },
            ]),
        ).toMatchObject({
            id: "newer",
            path: "C:/repo/newer",
        });
    });

    it("returns undefined for an empty workspace list", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
    });

    it("keeps the earlier entry on equal activity timestamps", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "first",
                    name: "First",
                    path: "C:/repo/first",
                    createdAt: 100,
                    lastActiveAt: 500,
                },
                {
                    id: "second",
                    name: "Second",
                    path: "C:/repo/second",
                    createdAt: 200,
                    lastActiveAt: 500,
                },
            ]),
        ).toMatchObject({ id: "first" });
    });

    // wave-98 residual
    it("returns the only workspace for a singleton list", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "solo",
                    name: "Solo",
                    path: "C:/repo/solo",
                    createdAt: 42,
                    lastActiveAt: 99,
                },
            ]),
        ).toMatchObject({ id: "solo", path: "C:/repo/solo" });
    });

    it("prefers lastActiveAt even when createdAt is older", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "old-but-active",
                    name: "Old",
                    path: "C:/repo/old",
                    createdAt: 10,
                    lastActiveAt: 900,
                },
                {
                    id: "new-idle",
                    name: "New",
                    path: "C:/repo/new",
                    createdAt: 800,
                    lastActiveAt: 801,
                },
            ]),
        ).toMatchObject({ id: "old-but-active" });
    });

    it("treats lastActiveAt=0 as a valid timestamp", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "zero",
                    name: "Zero",
                    path: "C:/repo/zero",
                    createdAt: 50,
                    lastActiveAt: 0,
                },
                {
                    id: "later",
                    name: "Later",
                    path: "C:/repo/later",
                    createdAt: 40,
                },
            ]),
        ).toMatchObject({ id: "later" });
    });

    // wave-121 residual
    it("returns the same object reference from the input list", () => {
        const target = {
            id: "ref",
            name: "Ref",
            path: "C:/repo/ref",
            createdAt: 1,
            lastActiveAt: 999,
        };
        const other = {
            id: "other",
            name: "Other",
            path: "C:/repo/other",
            createdAt: 2,
            lastActiveAt: 10,
        };
        expect(getMostRecentlyActiveWorkspace([other, target])).toBe(target);
    });

    it("uses createdAt when only some entries have lastActiveAt", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                {
                    id: "with-active",
                    name: "A",
                    path: "C:/a",
                    createdAt: 10,
                    lastActiveAt: 50,
                },
                {
                    id: "created-only",
                    name: "B",
                    path: "C:/b",
                    createdAt: 100,
                },
            ]),
        ).toMatchObject({ id: "created-only" });
    });

    it("keeps first entry when all timestamps are equal via createdAt fallback", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "a", name: "A", path: "C:/a", createdAt: 7 },
                { id: "b", name: "B", path: "C:/b", createdAt: 7 },
                { id: "c", name: "C", path: "C:/c", createdAt: 7 },
            ]),
        ).toMatchObject({ id: "a" });
    });

    // wave-127 residual
    it("returns undefined for empty list and sole entry for singleton", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "only", name: "Only", path: "C:/o", createdAt: 1 },
            ]),
        ).toMatchObject({ id: "only" });
    });

    it("prefers higher lastActiveAt over later createdAt when both set", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "old-active", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 1000 },
                { id: "new-created", name: "B", path: "C:/b", createdAt: 500, lastActiveAt: 200 },
            ]),
        ).toMatchObject({ id: "old-active" });
    });

    // wave-141 residual
    it("selects the maximum lastActiveAt across a long list", () => {
        const list = Array.from({ length: 50 }, (_, i) => ({
            id: `w${i}`,
            name: `W${i}`,
            path: `C:/w${i}`,
            createdAt: i,
            lastActiveAt: i === 37 ? 10_000 : i,
        }));
        expect(getMostRecentlyActiveWorkspace(list)).toMatchObject({ id: "w37" });
    });

    it("does not prefer later createdAt when lastActiveAt ties", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "first", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 100 },
                { id: "second", name: "B", path: "C:/b", createdAt: 999, lastActiveAt: 100 },
            ]),
        ).toMatchObject({ id: "first" });
    });

    it("falls back to createdAt when lastActiveAt is undefined for all entries", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "a", name: "A", path: "C:/a", createdAt: 10 },
                { id: "b", name: "B", path: "C:/b", createdAt: 30 },
                { id: "c", name: "C", path: "C:/c", createdAt: 20 },
            ]),
        ).toMatchObject({ id: "b" });
    });

    // wave-151 residual
    it("returns undefined for empty list and the sole entry for singleton", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "only", name: "Only", path: "C:/only", createdAt: 1, lastActiveAt: 2 },
            ]),
        ).toMatchObject({ id: "only", path: "C:/only" });
    });

    it("treats lastActiveAt 0 as a real timestamp not a missing value", () => {
        // product: ?? only falls back on null/undefined, not 0
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "zero", name: "Z", path: "C:/z", createdAt: 100, lastActiveAt: 0 },
                { id: "no-active", name: "N", path: "C:/n", createdAt: 50 },
            ]),
        ).toMatchObject({ id: "no-active" });
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "zero", name: "Z", path: "C:/z", createdAt: 10, lastActiveAt: 0 },
                { id: "neg", name: "N", path: "C:/n", createdAt: -5 },
            ]),
        ).toMatchObject({ id: "zero" });
    });

    it("keeps first entry when all timestamps equal", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "a", name: "A", path: "C:/a", createdAt: 5, lastActiveAt: 5 },
                { id: "b", name: "B", path: "C:/b", createdAt: 5, lastActiveAt: 5 },
                { id: "c", name: "C", path: "C:/c", createdAt: 5, lastActiveAt: 5 },
            ]),
        ).toMatchObject({ id: "a" });
    });

    // wave-173 residual
    it("uses strict greater-than so later equal timestamps keep the earlier entry", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "first", name: "F", path: "C:/f", createdAt: 10, lastActiveAt: 100 },
                { id: "second", name: "S", path: "C:/s", createdAt: 20, lastActiveAt: 100 },
            ]),
        ).toMatchObject({ id: "first" });
    });

    it("mixes lastActiveAt and createdAt fallbacks across a multi-entry list", () => {
        // product: timestamp = lastActiveAt ?? createdAt; pick max
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "old-active", name: "O", path: "C:/o", createdAt: 1, lastActiveAt: 50 },
                { id: "new-created-only", name: "N", path: "C:/n", createdAt: 80 },
                { id: "mid", name: "M", path: "C:/m", createdAt: 10, lastActiveAt: 60 },
            ]),
        ).toMatchObject({ id: "new-created-only" });
    });

    it("handles negative and very large timestamps without throwing", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "neg", name: "N", path: "C:/n", createdAt: -100, lastActiveAt: -50 },
                { id: "zero", name: "Z", path: "C:/z", createdAt: 0 },
                { id: "big", name: "B", path: "C:/b", createdAt: 1, lastActiveAt: Number.MAX_SAFE_INTEGER },
            ]),
        ).toMatchObject({ id: "big" });
        // lastActiveAt 0 is real (not missing); loses to positive createdAt
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "zero-active", name: "Z", path: "C:/z", createdAt: 999, lastActiveAt: 0 },
                { id: "created-1", name: "C", path: "C:/c", createdAt: 1 },
            ]),
        ).toMatchObject({ id: "created-1" });
    });

    // wave-182 residual
    it("returns undefined for empty list and the only entry for singleton", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "solo", name: "S", path: "C:/s", createdAt: 42 },
            ]),
        ).toMatchObject({ id: "solo", createdAt: 42 });
    });

    it("does not mutate the input array or entry objects", () => {
        const list = [
            { id: "a", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 10 },
            { id: "b", name: "B", path: "C:/b", createdAt: 2, lastActiveAt: 20 },
        ];
        const freeze = JSON.stringify(list);
        const pick = getMostRecentlyActiveWorkspace(list);
        expect(pick).toMatchObject({ id: "b" });
        expect(JSON.stringify(list)).toBe(freeze);
        expect(list[0]).toMatchObject({ id: "a", lastActiveAt: 10 });
    });

    it("prefers later lastActiveAt even when createdAt is older", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "new-create", name: "N", path: "C:/n", createdAt: 1000 },
                { id: "old-but-active", name: "O", path: "C:/o", createdAt: 1, lastActiveAt: 2000 },
            ]),
        ).toMatchObject({ id: "old-but-active" });
    });

    // wave-193 residual
    it("ties on equal timestamps keep the earlier list entry (strict >)", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "first", name: "F", path: "C:/f", createdAt: 100, lastActiveAt: 50 },
            { id: "second", name: "S", path: "C:/s", createdAt: 200, lastActiveAt: 50 },
        ]);
        // candidateTimestamp > currentTimestamp is false on equal → keep current
        expect(pick).toMatchObject({ id: "first" });
    });

    it("falls back to createdAt when lastActiveAt is undefined for all", () => {
        expect(
            getMostRecentlyActiveWorkspace([
                { id: "a", name: "A", path: "C:/a", createdAt: 10 },
                { id: "b", name: "B", path: "C:/b", createdAt: 30 },
                { id: "c", name: "C", path: "C:/c", createdAt: 20 },
            ]),
        ).toMatchObject({ id: "b" });
    });

    it("returns first item reference identity for singleton", () => {
        const solo = { id: "solo", name: "S", path: "C:/s", createdAt: 1 };
        expect(getMostRecentlyActiveWorkspace([solo])).toBe(solo);
    });

    // wave-198 residual
    it("treats lastActiveAt 0 as real activity (?? does not fall through to createdAt)", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "zero-active", name: "Z", path: "C:/z", createdAt: 9999, lastActiveAt: 0 },
            { id: "old", name: "O", path: "C:/o", createdAt: 100 },
        ]);
        // 0 is not nullish → candidateTimestamp 0 loses to 100
        expect(pick).toMatchObject({ id: "old" });
    });

    it("null lastActiveAt falls back to createdAt like undefined", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "null-active", name: "N", path: "C:/n", createdAt: 5, lastActiveAt: null as never },
            { id: "newer", name: "W", path: "C:/w", createdAt: 50 },
        ]);
        expect(pick).toMatchObject({ id: "newer" });
    });

    // wave-202 residual
    it("empty list is undefined; equal timestamps keep the first reduce seed", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        const a = { id: "a", name: "A", path: "C:/a", createdAt: 10, lastActiveAt: 100 };
        const b = { id: "b", name: "B", path: "C:/b", createdAt: 20, lastActiveAt: 100 };
        // candidateTimestamp > currentTimestamp is false on equal → keep current (first)
        expect(getMostRecentlyActiveWorkspace([a, b])).toBe(a);
        expect(getMostRecentlyActiveWorkspace([b, a])).toBe(b);
    });

    it("strictly newer lastActiveAt wins even when createdAt is older", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "old-created", name: "O", path: "C:/o", createdAt: 1, lastActiveAt: 500 },
            { id: "new-created", name: "N", path: "C:/n", createdAt: 999, lastActiveAt: 50 },
        ]);
        expect(pick).toMatchObject({ id: "old-created" });
    });

    // wave-208 residual
    it("returns the only workspace unchanged; later createdAt wins without lastActiveAt", () => {
        const only = { id: "one", name: "One", path: "C:/one", createdAt: 42 };
        expect(getMostRecentlyActiveWorkspace([only])).toBe(only);
        const pick = getMostRecentlyActiveWorkspace([
            { id: "early", name: "E", path: "C:/e", createdAt: 10 },
            { id: "late", name: "L", path: "C:/l", createdAt: 20 },
            { id: "mid", name: "M", path: "C:/m", createdAt: 15 },
        ]);
        expect(pick).toMatchObject({ id: "late" });
    });

    it("preserves generic record fields beyond selection keys", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "a", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 1, extra: "keep" },
            { id: "b", name: "B", path: "C:/b", createdAt: 1, lastActiveAt: 2, extra: "win" },
        ]);
        expect(pick).toMatchObject({ id: "b", extra: "win" });
    });

    // wave-213 residual
    it("lastActiveAt 0 is valid and beats missing lastActiveAt with higher createdAt", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "with-zero", name: "Z", path: "C:/z", createdAt: 1, lastActiveAt: 0 },
            { id: "created-only", name: "C", path: "C:/c", createdAt: 999 },
        ]);
        // product: lastActiveAt ?? createdAt → 0 is not nullish, so 0 vs 999 → created-only wins
        expect(pick).toMatchObject({ id: "created-only" });
        const pick2 = getMostRecentlyActiveWorkspace([
            { id: "old", name: "O", path: "C:/o", createdAt: 1, lastActiveAt: 10 },
            { id: "new", name: "N", path: "C:/n", createdAt: 1, lastActiveAt: 11 },
        ]);
        expect(pick2).toMatchObject({ id: "new" });
    });

    // wave-218 residual
    it("empty list is undefined; single item returns itself; ties keep earlier reduce winner", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        const only = { id: "solo", name: "S", path: "C:/s", createdAt: 5 };
        expect(getMostRecentlyActiveWorkspace([only])).toBe(only);
        const a = { id: "a", name: "A", path: "C:/a", createdAt: 10, lastActiveAt: 10 };
        const b = { id: "b", name: "B", path: "C:/b", createdAt: 10, lastActiveAt: 10 };
        expect(getMostRecentlyActiveWorkspace([a, b])).toMatchObject({ id: "a" });
    });

    it("undefined lastActiveAt falls back to createdAt; higher createdAt beats low lastActiveAt", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "older", name: "O", path: "C:/o", createdAt: 100 },
            { id: "newer", name: "N", path: "C:/n", createdAt: 50, lastActiveAt: 200 },
        ]);
        expect(pick).toMatchObject({ id: "newer" });
        const pick2 = getMostRecentlyActiveWorkspace([
            { id: "by-created", name: "C", path: "C:/c", createdAt: 300 },
            { id: "by-active", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 10 },
        ]);
        expect(pick2).toMatchObject({ id: "by-created" });
    });

    // wave-247 residual
    it("lastActiveAt 0 is not nullish so loses to higher createdAt; negative timestamps still compared", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "zero-active", name: "Z", path: "C:/z", createdAt: 50, lastActiveAt: 0 },
            { id: "created-high", name: "C", path: "C:/c", createdAt: 100 },
        ]);
        expect(pick).toMatchObject({ id: "created-high" });
        const pickNeg = getMostRecentlyActiveWorkspace([
            { id: "neg", name: "N", path: "C:/n", createdAt: -5 },
            { id: "zero", name: "Z", path: "C:/z", createdAt: 0 },
        ]);
        expect(pickNeg).toMatchObject({ id: "zero" });
    });

    it("multi-item reduce keeps first on equal timestamps; later higher lastActiveAt wins", () => {
        const list = [
            { id: "a", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 10 },
            { id: "b", name: "B", path: "C:/b", createdAt: 1, lastActiveAt: 10 },
            { id: "c", name: "C", path: "C:/c", createdAt: 1, lastActiveAt: 12 },
            { id: "d", name: "D", path: "C:/d", createdAt: 1, lastActiveAt: 11 },
        ];
        expect(getMostRecentlyActiveWorkspace(list)).toMatchObject({ id: "c" });
        expect(getMostRecentlyActiveWorkspace([list[0]!, list[1]!])).toMatchObject({ id: "a" });
    });

    // wave-259 residual
    it("empty array yields undefined; single item returns itself", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        const one = { id: "only", name: "O", path: "C:/o", createdAt: 1 };
        expect(getMostRecentlyActiveWorkspace([one])).toBe(one);
    });

    it("lastActiveAt always preferred over createdAt when present including equal createdAt", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "a", name: "A", path: "C:/a", createdAt: 1000, lastActiveAt: 5 },
            { id: "b", name: "B", path: "C:/b", createdAt: 1000, lastActiveAt: 6 },
        ]);
        expect(pick).toMatchObject({ id: "b" });
    });



    // wave-289 residual
    it("missing lastActiveAt falls back to createdAt; higher lastActiveAt wins across mixed", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "old", name: "O", path: "C:/o", createdAt: 10 },
            { id: "mid", name: "M", path: "C:/m", createdAt: 1, lastActiveAt: 20 },
            { id: "new-created", name: "N", path: "C:/n", createdAt: 15 },
        ]);
        expect(pick).toMatchObject({ id: "mid" });
    });

    it("ties keep first reduced candidate; identical timestamps do not flip", () => {
        const a = { id: "a", name: "A", path: "C:/a", createdAt: 5, lastActiveAt: 5 };
        const b = { id: "b", name: "B", path: "C:/b", createdAt: 5, lastActiveAt: 5 };
        expect(getMostRecentlyActiveWorkspace([a, b])).toBe(a);
        expect(getMostRecentlyActiveWorkspace([b, a])).toBe(b);
        // only createdAt present and equal → first wins
        const c = { id: "c", name: "C", path: "C:/c", createdAt: 9 };
        const d = { id: "d", name: "D", path: "C:/d", createdAt: 9 };
        expect(getMostRecentlyActiveWorkspace([c, d])).toBe(c);
    });


    // wave-296 residual
    it("prefers higher lastActiveAt even when createdAt is much older", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "ancient-active", name: "A", path: "C:/a", createdAt: 1, lastActiveAt: 1000 },
            { id: "fresh-created", name: "B", path: "C:/b", createdAt: 900 },
        ]);
        expect(pick).toMatchObject({ id: "ancient-active" });
    });

    it("reduces left-to-right; later equal timestamp does not replace", () => {
        const first = { id: "first", name: "F", path: "C:/f", createdAt: 50 };
        const second = { id: "second", name: "S", path: "C:/s", createdAt: 50 };
        const third = { id: "third", name: "T", path: "C:/t", createdAt: 40, lastActiveAt: 60 };
        expect(getMostRecentlyActiveWorkspace([first, second, third])).toMatchObject({ id: "third" });
        expect(getMostRecentlyActiveWorkspace([third, first, second])).toMatchObject({ id: "third" });
        expect(getMostRecentlyActiveWorkspace([first, second])).toBe(first);
    });

    it("undefined lastActiveAt is treated as missing not zero", () => {
        const pick = getMostRecentlyActiveWorkspace([
            { id: "with-zero-ish", name: "Z", path: "C:/z", createdAt: 10, lastActiveAt: undefined },
            { id: "created-only", name: "C", path: "C:/c", createdAt: 20 },
        ]);
        expect(pick).toMatchObject({ id: "created-only" });
    });


    // wave-317 residual
    it("empty list undefined; single candidate identity preserved", () => {
        expect(getMostRecentlyActiveWorkspace([])).toBeUndefined();
        const only = { id: "only", name: "O", path: "C:/o", createdAt: 1, lastActiveAt: 2, extra: 9 as never };
        expect(getMostRecentlyActiveWorkspace([only as never])).toBe(only);
    });

    it("lastActiveAt preferred over createdAt; zero lastActiveAt is valid timestamp", () => {
        // effective timestamp = lastActiveAt ?? createdAt
        const pick = getMostRecentlyActiveWorkspace([
            { id: "created-high", name: "C", path: "C:/c", createdAt: 40 },
            { id: "active-zero", name: "Z", path: "C:/z", createdAt: 100, lastActiveAt: 0 },
            { id: "active-high", name: "A", path: "C:/a", createdAt: 2, lastActiveAt: 50 },
        ]);
        // timestamps: 40, 0, 50 → active-high
        expect(pick).toMatchObject({ id: "active-high" });
        // among created-only, higher createdAt wins
        const created = getMostRecentlyActiveWorkspace([
            { id: "c1", name: "1", path: "C:/1", createdAt: 10 },
            { id: "c2", name: "2", path: "C:/2", createdAt: 11 },
        ]);
        expect(created).toMatchObject({ id: "c2" });
        // lastActiveAt 0 is present so used; loses to createdAt 1
        const zeroVsCreated = getMostRecentlyActiveWorkspace([
            { id: "z", name: "Z", path: "C:/z", createdAt: 5, lastActiveAt: 0 },
            { id: "c", name: "C", path: "C:/c", createdAt: 1 },
        ]);
        expect(zeroVsCreated).toMatchObject({ id: "c" });
    });

    it("strict greater-than comparison; equal timestamps keep first reduce seed", () => {
        const a = { id: "a", name: "A", path: "C:/a", createdAt: 7, lastActiveAt: 7 };
        const b = { id: "b", name: "B", path: "C:/b", createdAt: 7, lastActiveAt: 7 };
        expect(getMostRecentlyActiveWorkspace([a, b])).toBe(a);
        expect(getMostRecentlyActiveWorkspace([b, a])).toBe(b);
    });

});
