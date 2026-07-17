import { Type, type Static } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const tone = Type.Optional(Type.Union([
    Type.Literal("neutral"),
    Type.Literal("info"),
    Type.Literal("success"),
    Type.Literal("warning"),
    Type.Literal("danger"),
]));
const primitive = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const listItem = Type.Object({
    id: Type.String(),
    label: Type.String(),
    status: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
}, { additionalProperties: false });
const keyValueItem = Type.Object({ id: Type.String(), key: Type.String(), value: Type.String() }, { additionalProperties: false });
const option = Type.Object({
    label: Type.String(),
    value: Type.String(),
    description: Type.Optional(Type.String()),
}, { additionalProperties: false });
const formBase = {
    id: Type.String(),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    required: Type.Optional(Type.Boolean()),
};
const formField = Type.Union([
    Type.Object({ ...formBase, kind: Type.Union([Type.Literal("text"), Type.Literal("textarea")]), placeholder: Type.Optional(Type.String()), defaultValue: Type.Optional(Type.String()) }, { additionalProperties: false }),
    Type.Object({ ...formBase, kind: Type.Literal("number"), min: Type.Optional(Type.Number()), max: Type.Optional(Type.Number()), step: Type.Optional(Type.Number()), defaultValue: Type.Optional(Type.Number()) }, { additionalProperties: false }),
    Type.Object({ ...formBase, kind: Type.Union([Type.Literal("select"), Type.Literal("radio")]), options: Type.Array(option, { minItems: 1, maxItems: 50 }), defaultValue: Type.Optional(Type.String()) }, { additionalProperties: false }),
    Type.Object({ ...formBase, kind: Type.Literal("multi-select"), options: Type.Array(option, { minItems: 1, maxItems: 50 }), defaultValue: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })) }, { additionalProperties: false }),
    Type.Object({ ...formBase, kind: Type.Literal("checkbox"), defaultValue: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);
const action = Type.Object({
    id: Type.String(),
    label: Type.String(),
    kind: Type.Union([
        Type.Literal("copy-text"),
        Type.Literal("open-file"),
        Type.Literal("open-url"),
        Type.Literal("switch-view"),
        Type.Literal("prefill-message"),
        Type.Literal("send-message"),
    ]),
    value: Type.String(),
    tone,
}, { additionalProperties: false });
const section = Type.Union([
    Type.Object({ id: Type.String(), kind: Type.Literal("markdown"), content: Type.String() }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("callout"), title: Type.Optional(Type.String()), content: Type.String(), tone }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("metric_grid"), items: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), value: Type.String(), detail: Type.Optional(Type.String()), trend: Type.Optional(Type.String()), tone }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("key_value"), items: Type.Array(keyValueItem, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Union([Type.Literal("status_list"), Type.Literal("steps"), Type.Literal("file_list")]), items: Type.Array(listItem, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("timeline"), items: Type.Array(Type.Object({ id: Type.String(), title: Type.String(), time: Type.Optional(Type.String()), description: Type.Optional(Type.String()), status: Type.Optional(Type.String()) }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("progress"), items: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), value: Type.Number(), max: Type.Number({ exclusiveMinimum: 0 }), status: Type.Optional(Type.String()), description: Type.Optional(Type.String()) }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("table"), caption: Type.Optional(Type.String()), columns: Type.Array(Type.Object({ key: Type.String(), label: Type.String(), align: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")])), format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("number"), Type.Literal("percent")])), sortable: Type.Optional(Type.Boolean()) }, { additionalProperties: false }), { minItems: 1, maxItems: 24 }), rows: Type.Array(Type.Record(Type.String(), primitive), { minItems: 1, maxItems: 200 }) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("chart"), chartType: Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("area"), Type.Literal("pie")]), data: Type.Array(Type.Record(Type.String(), primitive), { minItems: 1, maxItems: 500 }), xKey: Type.String(), series: Type.Array(Type.Object({ key: Type.String(), label: Type.Optional(Type.String()), stack: Type.Optional(Type.String()) }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }), summary: Type.String(), stacked: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("form"), fields: Type.Array(formField, { minItems: 1, maxItems: 24 }), submitLabel: Type.Optional(Type.String()), submitPrompt: Type.Optional(Type.String()) }, { additionalProperties: false }),
    Type.Object({ id: Type.String(), kind: Type.Literal("action_bar"), actions: Type.Array(action, { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }),
]);
const cardSchema = Type.Object({
    version: Type.Literal("v2"),
    id: Type.String({ minLength: 1, maxLength: 120 }),
    title: Type.Optional(Type.String()),
    subtitle: Type.Optional(Type.String()),
    tone,
    sections: Type.Array(section, { minItems: 1, maxItems: 24 }),
}, { additionalProperties: false });
const renderUiSchema = Type.Object({
    card: cardSchema,
}, { additionalProperties: false });

type RenderUiParams = Static<typeof renderUiSchema>;

function emitCard(pi: ExtensionAPI, card: RenderUiParams["card"]): void {
    const bytes = Buffer.byteLength(JSON.stringify(card), "utf8");
    if (bytes > 256 * 1024) throw new Error("Generated UI payload exceeds 256 KB");
    pi.sendMessage({
        customType: "generated-ui",
        content: "",
        display: true,
        details: { operation: "upsert", card },
    }, { triggerTurn: false });
}

function overviewCard(): RenderUiParams["card"] {
    return {
        version: "v2",
        id: "generated-ui-overview",
        title: "生成式 UI v2",
        subtitle: "任务、数据、图表、表单与安全操作",
        tone: "info",
        sections: [
            { id: "metrics", kind: "metric_grid", items: [
                { id: "tests", label: "测试", value: "128", detail: "全部通过", tone: "success" },
                { id: "coverage", label: "覆盖率", value: "91%", trend: "+4.2%" },
                { id: "files", label: "变更文件", value: "7" },
            ] },
            { id: "progress", kind: "progress", items: [{ id: "ship", label: "交付进度", value: 82, max: 100, status: "running" }] },
            { id: "table", kind: "table", caption: "模块状态", columns: [
                { key: "module", label: "模块", sortable: true },
                { key: "status", label: "状态", sortable: true },
                { key: "tests", label: "测试", align: "right", format: "number", sortable: true },
            ], rows: [
                { module: "Runtime", status: "完成", tests: 42 },
                { module: "Renderer", status: "进行中", tests: 61 },
                { module: "Persistence", status: "完成", tests: 25 },
            ] },
            { id: "chart", kind: "chart", chartType: "bar", xKey: "module", summary: "Renderer 当前耗时最高，Runtime 次之。", series: [{ key: "duration", label: "耗时(ms)" }], data: [
                { module: "Runtime", duration: 180 },
                { module: "Renderer", duration: 310 },
                { module: "Persistence", duration: 95 },
            ] },
            { id: "form", kind: "form", submitLabel: "提交选择", submitPrompt: "请根据用户在生成式 UI 表单中的选择继续。", fields: [
                { id: "target", kind: "select", label: "部署环境", required: true, options: [{ label: "测试", value: "staging" }, { label: "生产", value: "production" }] },
                { id: "notes", kind: "textarea", label: "补充说明", placeholder: "可选" },
                { id: "confirm", kind: "checkbox", label: "我已检查变更", required: true },
            ] },
            { id: "actions", kind: "action_bar", actions: [
                { id: "copy", label: "复制摘要", kind: "copy-text", value: "Generated UI v2 ready" },
                { id: "prefill", label: "继续检查", kind: "prefill-message", value: "请继续检查生成式 UI 的交互和响应式表现。" },
            ] },
        ],
    };
}

const EXPLICIT_UI_PATTERN = /(生成式\s*ui|卡片|表格|图表|表单|仪表盘|dashboard|chart|table|form)/i;
const GUIDANCE = `Generated UI is available through the render_ui tool. Use it for structured, high-value results such as plans, status summaries, test reports, file deliveries, metrics, comparisons, charts, or user input forms. Keep a short textual conclusion and put detailed structure in one primary card per turn. Never simulate UI with JSON or HTML in prose. Never use Generated UI actions to run commands or modify files.`;

export default function generatedUiExtension(pi: ExtensionAPI): void {
    pi.registerTool(defineTool({
        name: "render_ui",
        label: "Render UI",
        description: "Create or update a safe declarative UI card in the conversation. Use for structured task results, tables, charts, forms, progress, files, metrics, and explicit user requests for visual UI. Reuse the same card.id to update it in place. Do not use for short conversational answers.",
        parameters: renderUiSchema,
        async execute(_toolCallId, params) {
            emitCard(pi, params.card);
            return {
                content: [{ type: "text", text: `Rendered Generated UI card: ${params.card.id}` }],
                details: { cardId: params.card.id },
            };
        },
    }));

    pi.registerCommand("ui", {
        description: "显示生成式 UI 功能预览。用法: /ui",
        handler: async (args) => {
            if ((args ?? "").trim()) {
                pi.sendMessage({ customType: "generated-ui-help", content: "直接输入 /ui 查看生成式 UI 功能预览。", display: true }, { triggerTurn: false });
                return;
            }
            emitCard(pi, overviewCard());
        },
    });

    pi.on("before_agent_start", async (event) => {
        const explicit = EXPLICIT_UI_PATTERN.test(event.prompt ?? "");
        const instruction = explicit
            ? `${GUIDANCE}\nThe user explicitly requested a visual or structured UI in this turn, so you MUST call render_ui before finishing.`
            : GUIDANCE;
        return { systemPrompt: `${event.systemPrompt}\n\n<generated-ui-guidance>\n${instruction}\n</generated-ui-guidance>` };
    });
}
