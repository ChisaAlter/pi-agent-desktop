import React from "react";
import { normalizeLongHorizonSettings, type AgentMode, type LongHorizonSettings, type LongHorizonToggle } from "@shared";
import { useI18n } from "../../../i18n";
import { useRuntimeFeatureStore, clampAgentModeByRuntime, supportedAgentModes } from "../../../stores/runtime-feature-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { FieldRow, SectionTitle, SwitchControl } from "../_shared";

type ToggleKey = {
    [K in keyof LongHorizonSettings]: LongHorizonSettings[K] extends LongHorizonToggle ? K : never;
}[keyof LongHorizonSettings];

export function LongHorizonTab(): React.JSX.Element {
    const { t } = useI18n();
    const { settings, updateSettings } = useSettingsStore();
    const runtimeFeatureState = useRuntimeFeatureStore((state) => state.featureState);
    const longHorizon = normalizeLongHorizonSettings(settings.longHorizon);
    const availableModes = supportedAgentModes(runtimeFeatureState, longHorizon);
    const selectedDefaultMode = clampAgentModeByRuntime(longHorizon.defaultMode, runtimeFeatureState, longHorizon);

    const updateLongHorizon = (updates: Partial<LongHorizonSettings>): void => {
        updateSettings({
            longHorizon: normalizeLongHorizonSettings({
                ...longHorizon,
                ...updates,
            }),
        });
    };

    const updateToggle = (key: ToggleKey): void => {
        const current = longHorizon[key];
        updateLongHorizon({ [key]: { ...current, enabled: !current.enabled } } as Partial<LongHorizonSettings>);
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
                        value={selectedDefaultMode}
                        onChange={(event) => updateLongHorizon({
                            defaultMode: clampAgentModeByRuntime(event.target.value as AgentMode, runtimeFeatureState, longHorizon),
                        })}
                        className="w-full rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2.5 text-sm text-[var(--mm-text-primary)] focus:border-[var(--mm-accent-blue)] focus:outline-none"
                        aria-label={t("settings.longHorizon.defaultMode.label")}
                        disabled={!longHorizon.enabled}
                    >
                        {availableModes.includes("build") && <option value="build">Build</option>}
                        {availableModes.includes("plan") && <option value="plan">Plan</option>}
                        {availableModes.includes("compose") && <option value="compose">Compose</option>}
                    </select>
                </FieldRow>
            </div>

            <SectionTitle title={t("settings.longHorizon.modes.heading")} description={t("settings.longHorizon.modes.description")} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                {(["planMode", "composeMode"] as const).map((key) => (
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

            <SectionTitle title={t("settings.longHorizon.systems.heading")} description={t("settings.longHorizon.systems.description")} />
            <div className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                {(["goal", "memory", "history", "checkpoint", "task", "actor", "subagents"] as const).map((key) => (
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
                <FieldRow label={t("settings.longHorizon.ccIndex.label")} description={t("settings.longHorizon.ccIndex.description")}>
                    <SwitchControl
                        checked={longHorizon.memory.ccIndex ?? false}
                        label={t("settings.longHorizon.ccIndex.label")}
                        onChange={() => updateLongHorizon({
                            memory: {
                                ...longHorizon.memory,
                                ccIndex: !(longHorizon.memory.ccIndex ?? false),
                            },
                        })}
                    />
                </FieldRow>
            </div>
        </div>
    );
}
