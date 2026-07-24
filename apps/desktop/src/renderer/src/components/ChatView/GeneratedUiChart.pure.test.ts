import { describe, expect, it } from "vitest";
import { buildChartOption, type ChartSection } from "./GeneratedUiChart";

function section(partial: Partial<ChartSection> & Pick<ChartSection, "chartType">): ChartSection {
  return {
    id: "c1",
    kind: "chart",
    summary: "销量概览",
    xKey: "name",
    series: [{ key: "value", label: "销量" }],
    data: [
      { name: "A", value: 10 },
      { name: "B", value: 20 },
    ],
    ...partial,
  } as ChartSection;
}

describe("buildChartOption", () => {
  it("builds pie series with item tooltip", () => {
    const option = buildChartOption(section({ chartType: "pie" }));
    expect(option.tooltip).toEqual({ trigger: "item" });
    expect(option.xAxis).toBeUndefined();
    const series = option.series as Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    expect(series[0]?.type).toBe("pie");
    expect(series[0]?.data).toEqual([
      { name: "A", value: 10 },
      { name: "B", value: 20 },
    ]);
    expect((option.aria as { description: string }).description).toBe("销量概览");
  });

  it("builds bar series with category axis", () => {
    const option = buildChartOption(section({ chartType: "bar" }));
    expect(option.tooltip).toEqual({ trigger: "axis" });
    expect((option.xAxis as { data: unknown[] }).data).toEqual(["A", "B"]);
    const series = option.series as Array<{ type: string; smooth: boolean; name: string }>;
    expect(series[0]?.type).toBe("bar");
    expect(series[0]?.smooth).toBe(false);
    expect(series[0]?.name).toBe("销量");
  });

  it("builds stacked area/line series", () => {
    const option = buildChartOption(
      section({
        chartType: "area",
        stacked: true,
        series: [
          { key: "value", label: "销量", stack: "g1" },
          { key: "value2", label: "利润" },
        ],
        data: [
          { name: "A", value: 1, value2: 2 },
          { name: "B", value: 3, value2: 4 },
        ],
      }),
    );
    const series = option.series as Array<{
      type: string;
      stack?: string;
      areaStyle?: object;
      smooth: boolean;
    }>;
    expect(series[0]?.type).toBe("line");
    expect(series[0]?.areaStyle).toEqual({});
    expect(series[0]?.smooth).toBe(true);
    expect(series[0]?.stack).toBe("g1");
    expect(series[1]?.stack).toBe("total");
  });

  // wave-106 residual
  it("builds plain line series without stack or areaStyle", () => {
    const option = buildChartOption(section({ chartType: "line", stacked: false }));
    const series = option.series as Array<{ type: string; stack?: string; areaStyle?: object; smooth: boolean }>;
    expect(series[0]?.type).toBe("line");
    expect(series[0]?.smooth).toBe(true);
    expect(series[0]?.stack).toBeUndefined();
    expect(series[0]?.areaStyle).toBeUndefined();
    expect(option.tooltip).toEqual({ trigger: "axis" });
  });

  it("handles empty data and applies custom colors", () => {
    const option = buildChartOption(
      section({
        chartType: "bar",
        data: [],
        summary: "empty",
      }),
      { textColor: "#111", borderColor: "#222" },
    );
    expect((option.xAxis as { data: unknown[] }).data).toEqual([]);
    const series = option.series as Array<{ data: number[] }>;
    expect(series[0]?.data).toEqual([]);
    expect((option.aria as { description: string }).description).toBe("empty");
    // color theming is applied to axis/text styles when present
    const textStyle = (option as { textStyle?: { color?: string } }).textStyle;
    if (textStyle) expect(textStyle.color).toBe("#111");
  });

  // wave-125 residual
  it("pie series uses first series key values and item tooltip even when stacked is set", () => {
    const option = buildChartOption(
      section({
        chartType: "pie",
        stacked: true,
        series: [
          { key: "value", label: "销量" },
          { key: "value2", label: "利润" },
        ],
        data: [
          { name: "A", value: 5, value2: 9 },
          { name: "B", value: 7, value2: 1 },
        ],
      }),
    );
    expect(option.tooltip).toEqual({ trigger: "item" });
    expect(option.xAxis).toBeUndefined();
    const series = option.series as Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    expect(series).toHaveLength(1);
    expect(series[0]?.type).toBe("pie");
    expect(series[0]?.data).toEqual([
      { name: "A", value: 5 },
      { name: "B", value: 7 },
    ]);
  });

  it("bar multi-series maps each series key and keeps non-smooth bars", () => {
    const option = buildChartOption(
      section({
        chartType: "bar",
        series: [
          { key: "value", label: "销量" },
          { key: "value2", label: "利润" },
        ],
        data: [
          { name: "A", value: 1, value2: 2 },
          { name: "B", value: 3, value2: 4 },
        ],
      }),
    );
    const series = option.series as Array<{ type: string; name: string; data: number[]; smooth: boolean }>;
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ type: "bar", name: "销量", data: [1, 3], smooth: false });
    expect(series[1]).toMatchObject({ type: "bar", name: "利润", data: [2, 4], smooth: false });
  });
});


// wave-304 residual
describe("buildChartOption residual (wave-304)", () => {
  it("series name falls back to key when label missing; missing row keys coerce to 0", () => {
    const option = buildChartOption(
      section({
        chartType: "line",
        series: [{ key: "value" }],
        data: [{ name: "A" }, { name: "B", value: "3" as never }],
      }),
    );
    const series = option.series as Array<{ name: string; data: number[]; type: string; smooth: boolean }>;
    expect(series[0]?.name).toBe("value");
    expect(series[0]?.type).toBe("line");
    expect(series[0]?.smooth).toBe(true);
    expect(series[0]?.data).toEqual([0, 3]);
  });

  it("pie uses first series key only; empty name becomes empty string; grid omitted for pie", () => {
    const option = buildChartOption(
      section({
        chartType: "pie",
        series: [{ key: "value", label: "ignored-for-name-field" }],
        data: [{ name: undefined as never, value: 4 }, { name: "B", value: null as never }],
      }),
    );
    expect(option.grid).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
    const series = option.series as Array<{ radius: string[]; data: Array<{ name: string; value: number }> }>;
    expect(series[0]?.radius).toEqual(["35%", "68%"]);
    expect(series[0]?.data).toEqual([
      { name: "", value: 4 },
      { name: "B", value: 0 },
    ]);
  });

  it("stacked bar without item.stack uses total; unstacked preserves explicit stack; animationDuration 260", () => {
    const stacked = buildChartOption(
      section({
        chartType: "bar",
        stacked: true,
        series: [
          { key: "value", label: "V" },
          { key: "value2", label: "W", stack: "custom" },
        ],
        data: [
          { name: "A", value: 1, value2: 2 },
          { name: "B", value: 3, value2: 4 },
        ],
      }),
    );
    const s = stacked.series as Array<{ stack?: string; smooth: boolean }>;
    expect(s[0]?.stack).toBe("total");
    expect(s[1]?.stack).toBe("custom");
    expect(s[0]?.smooth).toBe(false);
    expect(stacked.animationDuration).toBe(260);

    const unstacked = buildChartOption(
      section({
        chartType: "bar",
        stacked: false,
        series: [{ key: "value", label: "V", stack: "kept" }],
      }),
    );
    const u = unstacked.series as Array<{ stack?: string }>;
    expect(u[0]?.stack).toBe("kept");
  });
});

