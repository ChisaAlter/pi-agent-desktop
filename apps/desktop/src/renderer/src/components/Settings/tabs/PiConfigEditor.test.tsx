// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PiConfigEditor } from "./PiConfigEditor";

const configGetModels = vi.fn();
const configGetAuth = vi.fn();
const configGetSettings = vi.fn();
const configSaveRaw = vi.fn();
const configExport = vi.fn();
const configImport = vi.fn();

vi.mock("../../../i18n", () => ({
  useTranslateIpcError: () => (err: { message?: string }) => err?.message ?? "ipc-error",
}));

vi.mock("../_shared", () => ({
  SettingsPage: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  SettingsCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionTitle: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

describe("PiConfigEditor", () => {
  beforeEach(() => {
    configGetModels.mockResolvedValue({ raw: '{"providers":{}}', parsed: { providers: {} } });
    configGetAuth.mockResolvedValue({ raw: "{}", parsed: {} });
    configGetSettings.mockResolvedValue({ raw: "{}", parsed: {} });
    configSaveRaw.mockResolvedValue({ valid: true });
    configExport.mockResolvedValue('{"export":true}');
    configImport.mockResolvedValue({ valid: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).piAPI = {
      configGetModels,
      configGetAuth,
      configGetSettings,
      configSaveRaw,
      configExport,
      configImport,
      configFetchModels: vi.fn(),
      configTestProvider: vi.fn(),
    };
  });

  it("loads models.json by default and shows textarea content", async () => {
    render(<PiConfigEditor />);
    await waitFor(() => {
      expect(configGetModels).toHaveBeenCalled();
    });
    const area = screen.getByLabelText("Pi 配置 JSON") as HTMLTextAreaElement;
    expect(area.value).toContain("providers");
    expect(screen.getByRole("button", { name: "models.json" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("switches file tabs and reloads auth.json", async () => {
    render(<PiConfigEditor />);
    await waitFor(() => expect(configGetModels).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "auth.json" }));
    await waitFor(() => expect(configGetAuth).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "auth.json" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("saves current raw content", async () => {
    render(<PiConfigEditor />);
    await waitFor(() => expect(configGetModels).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "保存当前文件" }));
    await waitFor(() => {
      expect(configSaveRaw).toHaveBeenCalledWith("models.json", expect.any(String));
    });
    expect(await screen.findByText(/已保存/)).toBeTruthy();
  });

  it("exposes primary config actions focus-visible rings for keyboard a11y", async () => {
    render(<PiConfigEditor />);
    await waitFor(() => expect(configGetModels).toHaveBeenCalled());
    for (const name of ["保存当前文件", "导出配置包", "从编辑区导入配置包"]) {
      expect(screen.getByRole("button", { name }).className).toContain("focus-visible:ring-2");
    }
  });
});
