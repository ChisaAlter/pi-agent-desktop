// PlanFileService 单测: 覆盖 create/read/update/complete/delete/list + slug sanitize
// 用 mkdtempSync 创建独立 tmpdir 作为 workspacePath,避免相互污染.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    PlanFileService,
    type PlanRecord,
} from "../plan-file-service";

describe("PlanFileService", () => {
    const dirs: string[] = [];
    let service: PlanFileService;
    let workspacePath: string;

    beforeEach(() => {
        workspacePath = mkdtempSync(join(tmpdir(), "pi-plan-"));
        dirs.push(workspacePath);
        service = new PlanFileService();
    });

    afterEach(() => {
        vi.useRealTimers();
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // ── 1. create + read 回环 ─────────────────────────────────────────

    describe("create + read round trip", () => {
        it("create 写入文件并返回完整 PlanRecord,read 解析后字段一致", () => {
            const created = service.create(workspacePath, {
                slug: "fix-login-bug",
                title: "修复登录 Bug",
                content: "## 目标\n\n- 修复登录失败\n- 加测试",
            });

            // 返回字段
            expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
            expect(created.filename).toMatch(/^\d+-fix-login-bug\.md$/);
            expect(created.path).toBe(join(workspacePath, ".pi", "plans", created.filename));
            expect(created.title).toBe("修复登录 Bug");
            expect(created.status).toBe("draft");
            expect(created.content).toBe("## 目标\n\n- 修复登录失败\n- 加测试");
            expect(created.createdAt).toBeGreaterThan(0);
            expect(created.updatedAt).toBe(created.createdAt);

            // 文件确实落盘
            expect(existsSync(created.path)).toBe(true);

            // read 回环: 所有字段一致
            const read = service.read(workspacePath, created.filename);
            expect(read).not.toBeNull();
            const record = read as PlanRecord;
            expect(record.id).toBe(created.id);
            expect(record.filename).toBe(created.filename);
            expect(record.path).toBe(created.path);
            expect(record.title).toBe(created.title);
            expect(record.status).toBe(created.status);
            expect(record.createdAt).toBe(created.createdAt);
            expect(record.updatedAt).toBe(created.updatedAt);
            expect(record.content).toBe(created.content);
        });

        it("create 自动创建 .pi/plans/ 目录", () => {
            const plansDir = join(workspacePath, ".pi", "plans");
            expect(existsSync(plansDir)).toBe(false);
            service.create(workspacePath, { slug: "x", title: "t", content: "" });
            expect(existsSync(plansDir)).toBe(true);
        });

        it("create 空 title 兜底为 '未命名计划'", () => {
            const created = service.create(workspacePath, {
                slug: "x",
                title: "   ",
                content: "",
            });
            expect(created.title).toBe("未命名计划");
            const read = service.read(workspacePath, created.filename);
            expect(read?.title).toBe("未命名计划");
        });

        it("read 不存在的文件返回 null", () => {
            expect(service.read(workspacePath, "nonexistent.md")).toBeNull();
        });

        it("create 的 title 含双引号与反斜杠时 read 正确还原", () => {
            const created = service.create(workspacePath, {
                slug: "quote",
                title: 'say "hi" and C:\\path',
                content: "body",
            });
            const read = service.read(workspacePath, created.filename);
            expect(read?.title).toBe('say "hi" and C:\\path');
        });
    });

    // ── 2. update ─────────────────────────────────────────────────────

    describe("update", () => {
        it("update 提供 content 时替换 body,frontmatter 其它字段保留", () => {
            const created = service.create(workspacePath, {
                slug: "u1",
                title: "原标题",
                content: "旧内容",
            });
            const updated = service.update(workspacePath, created.filename, {
                content: "新内容",
            });
            expect(updated.content).toBe("新内容");
            expect(updated.title).toBe("原标题");
            expect(updated.status).toBe("draft");
            expect(updated.createdAt).toBe(created.createdAt);
            expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

            // 再次 read 验证落盘
            const read = service.read(workspacePath, created.filename);
            expect(read?.content).toBe("新内容");
            expect(read?.title).toBe("原标题");
        });

        it("update 提供 status 时更新 frontmatter,其它字段保留", () => {
            const created = service.create(workspacePath, {
                slug: "u2",
                title: "t",
                content: "c",
            });
            const updated = service.update(workspacePath, created.filename, {
                status: "executing",
            });
            expect(updated.status).toBe("executing");
            expect(updated.content).toBe("c");
            expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

            const read = service.read(workspacePath, created.filename);
            expect(read?.status).toBe("executing");
        });

        it("update 提供 title 时更新 frontmatter title", () => {
            const created = service.create(workspacePath, {
                slug: "u3",
                title: "old",
                content: "c",
            });
            const updated = service.update(workspacePath, created.filename, {
                title: "new title",
            });
            expect(updated.title).toBe("new title");
            const read = service.read(workspacePath, created.filename);
            expect(read?.title).toBe("new title");
        });

        it("update 空 title 保留原 title", () => {
            const created = service.create(workspacePath, {
                slug: "u4",
                title: "保留我",
                content: "c",
            });
            const updated = service.update(workspacePath, created.filename, {
                title: "   ",
            });
            expect(updated.title).toBe("保留我");
        });

        it("update 不存在的文件抛 Plan not found", () => {
            expect(() =>
                service.update(workspacePath, "missing.md", { content: "x" }),
            ).toThrowError(/Plan not found: missing\.md/);
        });
    });

    // ── 3. complete ───────────────────────────────────────────────────

    describe("complete", () => {
        it("complete 把文件移动到 completed/ 并设置 status", () => {
            const created = service.create(workspacePath, {
                slug: "c1",
                title: "完成我",
                content: "body",
            });
            const sourcePath = created.path;
            const completed = service.complete(workspacePath, created.filename);

            expect(completed.status).toBe("completed");
            expect(completed.filename).toBe(created.filename);
            expect(completed.path).toBe(join(workspacePath, ".pi", "plans", "completed", created.filename));
            // 原文件已移走
            expect(existsSync(sourcePath)).toBe(false);
            // completed/ 下存在
            expect(existsSync(completed.path)).toBe(true);

            // read 顶层找不到 (已移动)
            expect(service.read(workspacePath, created.filename)).toBeNull();
        });

        it("complete 不存在的文件抛 Plan not found", () => {
            expect(() =>
                service.complete(workspacePath, "missing.md"),
            ).toThrowError(/Plan not found: missing\.md/);
        });

        it("complete 自动创建 completed/ 子目录", () => {
            const created = service.create(workspacePath, {
                slug: "c2",
                title: "t",
                content: "c",
            });
            const completedDir = join(workspacePath, ".pi", "plans", "completed");
            expect(existsSync(completedDir)).toBe(false);
            service.complete(workspacePath, created.filename);
            expect(existsSync(completedDir)).toBe(true);
        });
    });

    // ── 4. delete ─────────────────────────────────────────────────────

    describe("delete", () => {
        it("delete 把文件移动到 cancelled/ 并设置 status", () => {
            const created = service.create(workspacePath, {
                slug: "d1",
                title: "取消我",
                content: "body",
            });
            const sourcePath = created.path;
            service.delete(workspacePath, created.filename);

            const cancelledPath = join(workspacePath, ".pi", "plans", "cancelled", created.filename);
            expect(existsSync(sourcePath)).toBe(false);
            expect(existsSync(cancelledPath)).toBe(true);
        });

        it("delete 不存在的文件静默返回 (idempotent)", () => {
            expect(() =>
                service.delete(workspacePath, "missing.md"),
            ).not.toThrow();
        });

        it("delete 二次调用 (文件已被移走) 不抛错", () => {
            const created = service.create(workspacePath, {
                slug: "d2",
                title: "t",
                content: "c",
            });
            service.delete(workspacePath, created.filename);
            expect(() =>
                service.delete(workspacePath, created.filename),
            ).not.toThrow();
        });
    });

    // ── 5. list ────────────────────────────────────────────────────────

    describe("list", () => {
        it("list 按 created_at desc 排序", () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
                const r1 = service.create(workspacePath, { slug: "first", title: "1", content: "a" });
                vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
                const r2 = service.create(workspacePath, { slug: "second", title: "2", content: "b" });
                vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
                const r3 = service.create(workspacePath, { slug: "third", title: "3", content: "c" });

                const list = service.list(workspacePath);
                expect(list.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
            } finally {
                vi.useRealTimers();
            }
        });

        it("list 默认不包含 completed/ 与 cancelled/ 下的文件", () => {
            const created = service.create(workspacePath, {
                slug: "lc1",
                title: "t",
                content: "c",
            });
            service.complete(workspacePath, created.filename);

            const created2 = service.create(workspacePath, {
                slug: "lc2",
                title: "t2",
                content: "c2",
            });
            service.delete(workspacePath, created2.filename);

            // 顶层只剩 0 个 (都移动了)
            const list = service.list(workspacePath);
            expect(list).toEqual([]);
        });

        it("list includeCompleted=true 包含 completed/ 下的文件", () => {
            const created = service.create(workspacePath, {
                slug: "lc3",
                title: "t",
                content: "c",
            });
            service.complete(workspacePath, created.filename);

            const list = service.list(workspacePath, { includeCompleted: true });
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe(created.id);
            expect(list[0].status).toBe("completed");
            expect(list[0].path).toBe(join(workspacePath, ".pi", "plans", "completed", created.filename));
        });

        it("list includeCancelled=true 包含 cancelled/ 下的文件", () => {
            const created = service.create(workspacePath, {
                slug: "lc4",
                title: "t",
                content: "c",
            });
            service.delete(workspacePath, created.filename);

            const list = service.list(workspacePath, { includeCancelled: true });
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe(created.id);
            expect(list[0].status).toBe("cancelled");
        });

        it("list 同时包含 completed 与 cancelled", () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
                const c1 = service.create(workspacePath, { slug: "a", title: "a", content: "a" });
                vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
                const c2 = service.create(workspacePath, { slug: "b", title: "b", content: "b" });
                vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
                const c3 = service.create(workspacePath, { slug: "c", title: "c", content: "c" });

                service.complete(workspacePath, c1.filename);
                service.delete(workspacePath, c2.filename);
                // c3 留在顶层

                const list = service.list(workspacePath, {
                    includeCompleted: true,
                    includeCancelled: true,
                });
                expect(list.map((r) => r.id)).toEqual([c3.id, c2.id, c1.id]);
            } finally {
                vi.useRealTimers();
            }
        });

        it("list 空目录返回 []", () => {
            expect(service.list(workspacePath)).toEqual([]);
        });
    });

    // ── 6. slug sanitize ──────────────────────────────────────────────

    describe("slug sanitize", () => {
        function filenameFor(slug: string): string {
            const rec = service.create(workspacePath, { slug, title: "t", content: "c" });
            return rec.filename;
        }

        it("空白与下划线转 dash,大小写归一", () => {
            expect(filenameFor("Hello World")).toMatch(/^\d+-hello-world\.md$/);
            expect(filenameFor("foo__bar  baz")).toMatch(/^\d+-foo-bar-baz\.md$/);
        });

        it("特殊字符 (!@#$%^&*) 全部剔除", () => {
            expect(filenameFor("foo!@#$%^&*()bar")).toMatch(/^\d+-foobar\.md$/);
        });

        it("CJK 字符全部剔除,空串兜底为 'plan'", () => {
            expect(filenameFor("测试计划")).toMatch(/^\d+-plan\.md$/);
            expect(filenameFor("计划-1")).toMatch(/^\d+-1\.md$/);
        });

        it("超长 slug (>50) 截断到 50 字符", () => {
            const longSlug = "a".repeat(60);
            const filename = filenameFor(longSlug);
            // <timestamp>-<50 个 a>.md
            const match = filename.match(/^\d+-(a+)\.md$/);
            expect(match).not.toBeNull();
            expect((match as RegExpMatchArray)[1].length).toBe(50);
        });

        it("空字符串兜底为 'plan'", () => {
            expect(filenameFor("")).toMatch(/^\d+-plan\.md$/);
            expect(filenameFor("   ")).toMatch(/^\d+-plan\.md$/);
            expect(filenameFor("!!!")).toMatch(/^\d+-plan\.md$/);
        });

        it("首尾 dash 被去除", () => {
            expect(filenameFor("---leading")).toMatch(/^\d+-leading\.md$/);
            expect(filenameFor("trailing---")).toMatch(/^\d+-trailing\.md$/);
            expect(filenameFor("---both---")).toMatch(/^\d+-both\.md$/);
        });

        it("resolvePath 返回的路径包含 sanitized slug", () => {
            const path = service.resolvePath(workspacePath, "Hello World!");
            expect(path).toMatch(/[\\/]\.pi[\\/]plans[\\/]\d+-hello-world\.md$/);
        });
    });

    // ── 7 & 8. 错误处理 (合并到上面 describe 块) ──────────────────────

    describe("error handling", () => {
        it("update / complete 缺失文件抛错,delete 幂等", () => {
            expect(() => service.update(workspacePath, "nope.md", { content: "x" })).toThrow();
            expect(() => service.complete(workspacePath, "nope.md")).toThrow();
            expect(() => service.delete(workspacePath, "nope.md")).not.toThrow();
        });
    });

    // wave-171 residual
    describe("parse / path residual", () => {
        it("read returns null for corrupt frontmatter and missing required fields", () => {
            const plans = join(workspacePath, ".pi", "plans");
            mkdirSync(plans, { recursive: true });
            writeFileSync(join(plans, "no-fm.md"), "# just body\n", "utf8");
            writeFileSync(
                join(plans, "partial.md"),
                "---\nid: x\ntitle: t\n---\nbody\n",
                "utf8",
            );
            writeFileSync(
                join(plans, "bad-status.md"),
                "---\nid: y\ntitle: t\nstatus: weird\ncreated_at: 1\nupdated_at: 2\n---\nbody\n",
                "utf8",
            );
            expect(service.read(workspacePath, "no-fm.md")).toBeNull();
            expect(service.read(workspacePath, "partial.md")).toBeNull();
            expect(service.read(workspacePath, "bad-status.md")).toBeNull();
        });

        it("read/update use basename so path separators cannot escape plans dir", () => {
            const created = service.create(workspacePath, {
                slug: "safe",
                title: "Safe",
                content: "body",
            });
            // Traversal-style filename must resolve via basename to the real plan file.
            const sneaky = `../${created.filename}`;
            const got = service.read(workspacePath, sneaky);
            expect(got?.id).toBe(created.id);
            const updated = service.update(workspacePath, sneaky, { content: "patched" });
            expect(updated.content).toBe("patched");
            expect(service.read(workspacePath, created.filename)?.content).toBe("patched");
        });

        it("complete throws when destination already exists in completed/", () => {
            const created = service.create(workspacePath, {
                slug: "dup",
                title: "Dup",
                content: "c",
            });
            const completed = join(workspacePath, ".pi", "plans", "completed");
            mkdirSync(completed, { recursive: true });
            writeFileSync(join(completed, created.filename), "already there", "utf8");
            expect(() => service.complete(workspacePath, created.filename)).toThrow(
                /already exists in completed/,
            );
        });
    });
});
