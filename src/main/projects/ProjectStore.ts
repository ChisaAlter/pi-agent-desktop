import { app, dialog } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../../shared/types";

export class ProjectStore {
  private readonly filePath = join(app.getPath("userData"), "projects.json");
  private projects: Project[] = [];

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.projects = JSON.parse(raw) as Project[];
    } catch {
      this.projects = [];
    }
    if (this.ensureSortOrder()) await this.save();
    return this.list();
  }

  list() {
    return [...this.projects].sort((a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || this.projectSortOrder(a) - this.projectSortOrder(b)
      || b.lastOpenedAt - a.lastOpenedAt
    );
  }

  get(id: string) {
    return this.projects.find(project => project.id === id);
  }

  async chooseAndAdd() {
    const result = await dialog.showOpenDialog({
      title: "选择项目目录",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return this.add(result.filePaths[0]);
  }

  async add(path: string) {
    const existing = this.projects.find(project => project.path === path);
    if (existing) {
      existing.lastOpenedAt = Date.now();
      await this.save();
      return existing;
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(path) || path,
      path,
      lastOpenedAt: Date.now(),
      sortOrder: this.nextSortOrder(),
    };

    this.projects.push(project);
    await this.save();
    return project;
  }

  async remove(id: string) {
    this.projects = this.projects.filter(project => project.id !== id);
    await this.save();
  }

  async reorder(projectIds: string[]) {
    const orderById = new Map(projectIds.map((id, index) => [id, index]));
    const tailStart = projectIds.length;
    const currentOrder = this.list().map((project) => project.id);

    this.projects.forEach((project) => {
      const explicitOrder = orderById.get(project.id);
      project.sortOrder = explicitOrder ?? tailStart + currentOrder.indexOf(project.id);
    });

    await this.save();
    return this.list();
  }

  private ensureSortOrder() {
    const needsOrder = this.projects.some(
      (project) => typeof project.sortOrder !== "number" || Number.isNaN(project.sortOrder),
    );
    if (!needsOrder) return false;

    // 首次升级旧数据时保留原来的“置顶优先 + 最近打开”顺序，之后由用户拖拽顺序接管。
    [...this.projects]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.lastOpenedAt - a.lastOpenedAt)
      .forEach((project, index) => {
        project.sortOrder = index;
      });
    return true;
  }

  private nextSortOrder() {
    if (this.projects.length === 0) return 0;
    return Math.max(...this.projects.map((project) => this.projectSortOrder(project))) + 1;
  }

  private projectSortOrder(project: Project) {
    return typeof project.sortOrder === "number" && !Number.isNaN(project.sortOrder)
      ? project.sortOrder
      : Number.MAX_SAFE_INTEGER;
  }

  private async save() {
    // 项目列表是桌面端自己的轻量状态，不写入 pi session，避免影响 pi 原生会话格式。
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.projects, null, 2), "utf8");
  }
}
