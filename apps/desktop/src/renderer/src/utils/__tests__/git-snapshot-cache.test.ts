import { beforeEach, describe, expect, it } from "vitest";
import type { GitStatus } from "@shared";
import { clearGitSnapshotCache, countDiffStats, readCachedGitSnapshot, writeCachedGitSnapshot } from "../git-snapshot-cache";

function makeGitStatus(paths: Partial<Record<"modified" | "added" | "deleted" | "untracked", string[]>> = {}): GitStatus {
    return {
        branch: "master",
        modified: paths.modified ?? [],
        added: paths.added ?? [],
        deleted: paths.deleted ?? [],
        untracked: paths.untracked ?? [],
        ahead: 0,
        behind: 0,
    } as GitStatus;
}

describe("git-snapshot-cache — 共享 LRU 缓存", () => {
    beforeEach(() => {
        clearGitSnapshotCache();
    });

    it("写入后可读回", () => {
        writeCachedGitSnapshot("C:\\proj-a", makeGitStatus({ modified: ["a.ts"] }), { additions: 1, deletions: 0 }, "+a");
        const cached = readCachedGitSnapshot("C:\\proj-a");
        expect(cached?.git?.modified).toEqual(["a.ts"]);
        expect(cached?.diffStats).toEqual({ additions: 1, deletions: 0 });
    });

    it("未写过的路径返回 null", () => {
        expect(readCachedGitSnapshot("C:\\nope")).toBeNull();
    });

    it("超过 8 个 workspace 时 LRU 淘汰最旧", () => {
        for (let i = 0; i < 10; i++) {
            writeCachedGitSnapshot(`C:\\proj-${i}`, null, { additions: 0, deletions: 0 }, "");
            // 触达前 8 个后, 最早写入的应被淘汰
            if (i >= 8) {
                expect(readCachedGitSnapshot(`C:\\proj-${i - 8}`)).toBeNull();
            }
        }
        // 最新的仍在
        expect(readCachedGitSnapshot("C:\\proj-9")).not.toBeNull();
    });

    it("countDiffStats 统计 +/- 行 (排除 +++/--- 头)", () => {
        const stats = countDiffStats([
            "--- a/x.ts",
            "+++ b/x.ts",
            "@@ -1,3 +1,3 @@",
            "-old line",
            "+new line",
            " context",
        ].join("\n"));
        expect(stats).toEqual({ additions: 1, deletions: 1 });
    });
});
