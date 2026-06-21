import React from "react";
import { DEFAULT_LONG_HORIZON_SETTINGS, type AgentMode, type LongHorizonSettings } from "@shared";
import { useI18n } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings-store";
import { FieldRow, SectionTitle, SwitchControl } from "../_shared";

function mergeLongHorizon(value: LongHorizonSettings | undefined): LongHorizonSettings {
    return {
        ...DEFAULT_LONG_HORIZON_SETTINGS,
        ...value,
        maxMode: { ...DEFAULT_LONG_HORIZON_SETTINGS.maxMode, ...value?.maxMode },
        memory: { ...DEFAULT_LONG_HORIZON_SETTINGS.memory, ...value?.memory },
        checkpoint: { ...DEFAULT_LONG_HORIZON_SETTINGS.checkpoint, ...value?.checkpoint },
        goal: { ...DEFAULT_LONG_HORIZON_SETTINGS.goal, ...value?.goal },
        subagents: { ...DEFAULT_LONG_HORIZON_SETTINGS.subagents, ...value?.subagents },
        composeWorkflow: { ...DEFAULT_LONG_HORIZON_SETTINGS.composeWorkflow, ...value?.composeWorkflow },
    };
}

export function LongHorizonTab(): React.JSX.Element {
    const { t } = useI18n();
    const { settings, updateSettings } = useSettingsStore();
    const longHorizon = mergeLongHorizon(settings.longHorizon);

    const updateLongHorizon = (updates: Partial<LongHorizonSettings>): void => {
        updateSettings({
            longHorizon: mergeLongHorizon({
                ...longHorizon,
                ...updates,
            }),
        });
    };

    const updateToggle = (key: keyof Pick<LongHorizonSettings, "memory" | "checkpoint" | "goal" | "subagents" | "composeWorkflow">): void => {
        updateLongHorizon({ [key]: { enabled: !longHorizon[key].enabled } } as Partial<LongHorizonSettings>);
    };

    return (
        <div className="settings-tab-panel" role="tabpanel" id="settings-tabpanel-longHorizon" aria-labelledby="settings-tab-longHorizon">
            <SectionTitle title={t("settings.longHorizon.heading")} description={t("settings.longHorizon.description")} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                <FieldRow label={t("settings.longHorizon.enabled.label")} description={t("settings.longHorizon.enabled.description")}>
                    <SwitchControl
                        checked={longHorizon.enabled}
                        label={t("settings.longHorizon.enabled.label")}
                        onChange={() => updateLongHorizon({ enabled: !longHorizon.enabled })}
                    />
                </FieldRow>
                <FieldRow label={t("settings.longHorizon.defaultMode.label")} description={t("settings.longHorizon.defaultMode.description")}>
                    <select
                        value={longHorizon.defaultMode}
                        onChange={(event) => updateLongHorizon({ defaultMode: event.target.value as AgentMode })}
                        className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2.5 text-sm text-[var(--mm-text-primary)] focus:border-[#1f1f1f] focus:outline-none"
                        aria-label={t("settings.longHorizon.defaultMode.label")}
                        disabled={!longHorizon.enabled}
                    >
                        <option value="build">Build</option>
                        <option value="plan">Plan</option>
                        <option value="compose">Compose</option>
                        {longHorizon.maxMode.enabled && <option value="max">Max</option>}
                    </select>
                </FieldRow>
                <FieldRow label={t("settings.longHorizon.maxMode.label")} description={t("settings.longHorizon.maxMode.description")}>
                    <div className="flex items-center gap-3">
                        <SwitchControl
                            checked={longHorizon.maxMode.enabled}
                            label={t("settings.longHorizon.maxMode.label")}
                            onChange={() => updateLongHorizon({ maxMode: { ...longHorizon.maxMode, enabled: !longHorizon.maxMode.enabled } })}
                        />
                        <label className="flex items-center gap-2 text-xs text-[var(--mm-text-secondary)]">
                            <span>{t("settings.longHorizon.maxMode.candidates")}</span>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={longHorizon.maxMode.candidates ?? 5}
                                onChange={(event) => updateLongHorizon({
                                    maxMode: {
                                        ...longHorizon.maxMode,
                                        candidates: Math.max(1, Math.min(20, Number(event.target.value) || 5)),
                                    },
                                })}
                                className="w-16 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs"
                                aria-label={t("settings.longHorizon.maxMode.candidates")}
                            />
                        </label>
                    </div>
                </FieldRow>
            </div>

            <SectionTitle title={t("settings.longHorizon.systems.heading")} description={t("settings.longHorizon.systems.description")} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                {(["goal", "memory", "checkpoint", "subagents", "composeWorkflow"] as const).map((key) => (
                    <FieldRow
                        key={key}
                        label={t(`settings.longHorizon.${key}.label`)}
                        description={t(`settings.longHorizon.${key}.description`)}
                    >
                        <SwitchControl
                            checked={longHorizon[key].enabled}
                            label={t(`settings.longHorizon.${key}.label`)}
                            onChange={() => updateToggle(key)}
                        />
                    </FieldRow>
                ))}
            </div>
        </div>
    );
}
