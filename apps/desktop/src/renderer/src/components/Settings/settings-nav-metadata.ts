import type { I18nContextValue } from "../../i18n";
import type {
    SettingsNavSection,
    SettingsSearchEntry,
    SettingsSearchResult,
    SettingsTab,
    SettingsTabDefinition,
} from "./tab-defs";

type Translate = I18nContextValue["t"];

function pageAnchor(tabId: SettingsTab): string {
    return `page-${tabId}`;
}

function field(anchor: string, label: string, description?: string, keywords: ReadonlyArray<string> = []): SettingsSearchEntry {
    return { anchor, label, description, keywords };
}

function tabDefinition(
    id: SettingsTab,
    sectionId: SettingsTabDefinition["sectionId"],
    label: string,
    caption: string,
    pageTitle: string,
    pageDescription: string,
    searchEntries: ReadonlyArray<SettingsSearchEntry>,
): SettingsTabDefinition {
    return {
        id,
        sectionId,
        label,
        caption,
        pageTitle,
        pageDescription,
        searchEntries,
    };
}

export function buildSettingsNavigation(t: Translate): SettingsNavSection[] {
    const general = tabDefinition(
        "general",
        "common",
        t("settings.tab.general"),
        t("settings.tabCaption.general"),
        t("settings.tab.general"),
        t("settings.general.description"),
        [
            field("general-language", t("settings.language.label"), t("settings.language.description")),
            field("general-auto-compaction", t("settings.autoCompaction.label"), t("settings.autoCompaction.description")),
            field(
                "general-notifications",
                t("settings.general.notifications.heading"),
                t("settings.general.notifications.description"),
                [
                    t("settings.general.notifications.system.label"),
                    t("settings.general.notifications.sound.label"),
                    t("settings.general.notifications.volume.aria"),
                ],
            ),
            field("general-autosave", t("settings.autoSave.label")),
            field("general-line-numbers", t("settings.showLineNumbers.label")),
            field("general-word-wrap", t("settings.wordWrap.label")),
        ],
    );

    const model = tabDefinition(
        "model",
        "common",
        t("settings.tab.model"),
        t("settings.tabCaption.model"),
        t("settings.tab.model"),
        t("settings.modelTab.description"),
        [
            field(
                "model-defaults",
                t("settings.model.defaultsHeading"),
                t("settings.model.defaultsDescription"),
                [t("settings.piagent.defaultProvider"), t("settings.piagent.defaultModel")],
            ),
            field(
                "model-provider-list",
                t("settings.model.providersHeading"),
                t("settings.model.providersDescription"),
                ["Provider", "模型"],
            ),
        ],
    );

    const piAgent = tabDefinition(
        "piagent",
        "common",
        t("settings.tab.piagent"),
        t("settings.tabCaption.piagent"),
        t("settings.piagent.heading"),
        t("settings.piagent.description"),
        [
            field("piagent-status", t("settings.piagent.statusHeading"), t("settings.piagent.statusDescription"), ["CLI", "status"]),
            field(
                "piagent-defaults",
                t("settings.piagent.defaultsHeading"),
                t("settings.piagent.defaultsDescription"),
                [t("settings.piagent.defaultProvider"), t("settings.piagent.defaultModel"), "Provider", "模型"],
            ),
            field(
                "piagent-providers",
                t("settings.piagent.providersHeading"),
                t("settings.piagent.providersDescription"),
                ["Provider"],
            ),
            field("piagent-config-path", t("settings.piagent.configPath"), t("settings.piagent.configPathDescription")),
        ],
    );

    const appearance = tabDefinition(
        "appearance",
        "common",
        t("settings.tab.appearance"),
        t("settings.tabCaption.appearance"),
        t("settings.appearance.heading"),
        t("settings.appearance.description"),
        [
            field("appearance-theme", t("settings.theme.label")),
            field("appearance-font-size", t("settings.fontSize.searchLabel"), t("settings.fontSize.aria")),
        ],
    );

    const permissions = tabDefinition(
        "permissions",
        "common",
        t("settings.tab.permissions"),
        t("settings.tabCaption.permissions"),
        t("settings.permissions.heading"),
        t("settings.permissions.description"),
        [
            field("permissions-workspace", t("settings.permissions.workspaceHeading"), t("settings.permissions.workspaceDescription")),
            field("permissions-tools", t("settings.permissions.toolsHeading"), t("settings.permissions.toolsDescription")),
        ],
    );

    const usage = tabDefinition(
        "usage",
        "common",
        t("settings.tab.usage"),
        t("settings.tabCaption.usage"),
        t("settings.usage.heading"),
        t("settings.usage.description"),
        [
            field("usage-overview", t("settings.usage.overviewHeading"), t("settings.usage.overviewDescription"), ["Token"]),
            field("usage-filters", t("settings.usage.filtersHeading"), t("settings.usage.filtersDescription")),
        ],
    );

    const longHorizon = tabDefinition(
        "longHorizon",
        "advanced",
        t("settings.tab.longHorizon"),
        t("settings.tabCaption.longHorizon"),
        t("settings.longHorizon.heading"),
        t("settings.longHorizon.description"),
        [
            field(
                "long-horizon-overview",
                t("settings.longHorizon.overviewHeading"),
                t("settings.longHorizon.overviewDescription"),
                [t("settings.longHorizon.enabled.label"), t("settings.longHorizon.defaultMode.label")],
            ),
            field("long-horizon-modes", t("settings.longHorizon.modes.heading"), t("settings.longHorizon.modes.description")),
            field("long-horizon-systems", t("settings.longHorizon.systems.heading"), t("settings.longHorizon.systems.description")),
        ],
    );

    const shortcuts = tabDefinition(
        "shortcuts",
        "advanced",
        t("settings.tab.shortcuts"),
        t("settings.tabCaption.shortcuts"),
        t("settings.shortcuts.heading"),
        t("settings.shortcuts.description"),
        [field("shortcuts-list", t("settings.shortcuts.listHeading"), t("settings.shortcuts.listDescription"))],
    );

    const config = tabDefinition(
        "config",
        "maintenance",
        t("settings.tab.config"),
        t("settings.tabCaption.config"),
        t("settings.config.heading"),
        t("settings.config.description"),
        [
            field("config-files", t("settings.config.filesHeading"), t("settings.config.filesDescription"), ["models.json", "auth.json", "settings.json"]),
            field("config-actions", t("settings.config.actionsHeading"), t("settings.config.actionsDescription")),
        ],
    );

    const about = tabDefinition(
        "about",
        "maintenance",
        t("settings.tab.about"),
        t("settings.tabCaption.about"),
        t("settings.about.heading"),
        t("settings.about.description"),
        [
            field("about-overview", t("settings.about.summaryHeading"), t("settings.about.stack")),
            field("about-updates", t("settings.about.updater.heading"), t("settings.about.updater.searchDescription"), ["update", "release"]),
        ],
    );

    // Herdr 运行时（UI-REQ-060）：设置窗口「智能体」分组
    const herdr = tabDefinition(
        "herdr",
        "agents",
        t("settings.tab.herdr"),
        t("settings.tabCaption.herdr"),
        t("settings.herdr.heading"),
        t("settings.herdr.description"),
        [
            field("herdr-status", t("settings.herdr.status.heading"), t("settings.herdr.status.desc"), ["connection", "version", "protocol"]),
            field("herdr-source", t("settings.herdr.general.sourceLabel"), t("settings.herdr.general.sourceDesc")),
            field("herdr-actions", t("settings.herdr.actions.heading"), t("settings.herdr.actions.desc"), ["connect", "stop"]),
            field("herdr-capabilities", t("settings.herdr.compat.capabilitiesHeading")),
            field("herdr-diagnostics", t("settings.herdr.diagnostics.connectionLabel"), t("settings.herdr.diagnostics.connectionDesc")),
        ],
    );

    return [
        {
            id: "common",
            label: t("settings.nav.common"),
            tabs: [general, model, piAgent, appearance, permissions, usage],
        },
        {
            id: "agents",
            label: t("settings.nav.agents"),
            tabs: [herdr],
        },
        {
            id: "advanced",
            label: t("settings.nav.advanced"),
            tabs: [longHorizon, shortcuts],
        },
        {
            id: "maintenance",
            label: t("settings.nav.maintenance"),
            tabs: [config, about],
        },
    ];
}

export function flattenSettingsTabs(sections: ReadonlyArray<SettingsNavSection>): SettingsTabDefinition[] {
    return sections.flatMap((section) => section.tabs);
}

function buildSearchText(tab: SettingsTabDefinition, entry: SettingsSearchEntry): string {
    return [
        tab.label,
        tab.caption,
        tab.pageTitle,
        tab.pageDescription,
        entry.label,
        entry.description,
        ...(entry.keywords ?? []),
    ]
        .join(" ")
        .toLowerCase();
}

function matchesQuery(searchText: string, query: string): boolean {
    const terms = query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0) return false;
    return terms.every((term) => searchText.includes(term));
}

function scoreMatch(searchText: string, label: string, pageLabel: string, query: string): number {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabel = label.toLowerCase();
    const normalizedPageLabel = pageLabel.toLowerCase();
    if (normalizedLabel === normalizedQuery) return 0;
    if (normalizedPageLabel === normalizedQuery) return 1;
    if (normalizedLabel.startsWith(normalizedQuery)) return 2;
    if (normalizedPageLabel.startsWith(normalizedQuery)) return 3;
    if (searchText.includes(normalizedQuery)) return 4;
    return 5;
}

export function searchSettings(
    sections: ReadonlyArray<SettingsNavSection>,
    query: string,
): SettingsSearchResult[] {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) return [];

    return flattenSettingsTabs(sections)
        .flatMap((tab) =>
            tab.searchEntries.map((entry) => {
                const searchText = buildSearchText(tab, entry);
                return { tab, entry, searchText };
            }),
        )
        .filter(({ searchText }) => matchesQuery(searchText, normalizedQuery))
        .sort((left, right) => {
            const scoreDiff = scoreMatch(left.searchText, left.entry.label, left.tab.label, normalizedQuery)
                - scoreMatch(right.searchText, right.entry.label, right.tab.label, normalizedQuery);
            if (scoreDiff !== 0) return scoreDiff;
            return left.entry.label.localeCompare(right.entry.label);
        })
        .map(({ tab, entry }) => ({
            id: `${tab.id}:${entry.anchor}`,
            tabId: tab.id,
            anchor: entry.anchor,
            pageLabel: tab.label,
            pageCaption: tab.caption,
            label: entry.label,
            description: entry.description,
        }));
}

export function getDefaultSettingsAnchor(tabId: SettingsTab): string {
    return pageAnchor(tabId);
}
