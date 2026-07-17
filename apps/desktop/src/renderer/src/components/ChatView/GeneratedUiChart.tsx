import React, { useEffect, useRef } from "react";
import type { GeneratedUiSectionV2 } from "@shared";

interface GeneratedUiChartProps {
  section: Extract<GeneratedUiSectionV2, { kind: "chart" }>;
}

export default function GeneratedUiChart({ section }: GeneratedUiChartProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("echarts/core").then(async ({ init, use }) => {
      const [{ BarChart, LineChart, PieChart }, { GridComponent, LegendComponent, TooltipComponent, AriaComponent }, { CanvasRenderer }] = await Promise.all([
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      if (disposed) return;
      use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, CanvasRenderer]);
      const styles = getComputedStyle(root);
      const textColor = styles.getPropertyValue("--mm-text-secondary").trim() || "#666";
      const borderColor = styles.getPropertyValue("--mm-border").trim() || "#ddd";
      const chart = init(root, undefined, { renderer: "canvas" });
      const labels = section.data.map((row) => row[section.xKey]);
      const series = section.chartType === "pie"
        ? [{
            type: "pie" as const,
            radius: ["35%", "68%"],
            data: section.data.map((row) => ({ name: String(row[section.xKey] ?? ""), value: Number(row[section.series[0]?.key ?? ""] ?? 0) })),
          }]
        : section.series.map((item) => ({
            name: item.label ?? item.key,
            type: section.chartType === "bar" ? "bar" as const : "line" as const,
            data: section.data.map((row) => Number(row[item.key] ?? 0)),
            stack: section.stacked ? (item.stack ?? "total") : item.stack,
            areaStyle: section.chartType === "area" ? {} : undefined,
            smooth: section.chartType !== "bar",
          }));
      chart.setOption({
        animationDuration: 260,
        aria: { enabled: true, description: section.summary },
        color: ["#0a68c4", "#16a085", "#d97706", "#dc5a5a", "#6b7280"],
        textStyle: { color: textColor, fontFamily: "inherit" },
        tooltip: { trigger: section.chartType === "pie" ? "item" : "axis" },
        legend: { bottom: 0, textStyle: { color: textColor } },
        grid: section.chartType === "pie" ? undefined : { left: 42, right: 18, top: 16, bottom: 42, containLabel: true },
        xAxis: section.chartType === "pie" ? undefined : { type: "category", data: labels, axisLabel: { color: textColor }, axisLine: { lineStyle: { color: borderColor } } },
        yAxis: section.chartType === "pie" ? undefined : { type: "value", axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor } } },
        series,
      });
      let resizeFrame: number | null = null;
      const panelLayer = root.closest<HTMLElement>("[data-main-panel]");
      const scheduleResize = (): void => {
        if (panelLayer?.dataset.active === "false" || root.clientWidth === 0 || root.clientHeight === 0) return;
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          if (panelLayer?.dataset.active !== "false") chart.resize();
        });
      };
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleResize);
      const panelObserver = panelLayer && typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (panelLayer.dataset.active === "true") scheduleResize();
          })
        : null;
      observer?.observe(root);
      panelObserver?.observe(panelLayer!, { attributes: true, attributeFilter: ["data-active"] });
      cleanup = () => {
        observer?.disconnect();
        panelObserver?.disconnect();
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        chart.dispose();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [section]);

  return (
    <figure className="m-0 rounded-[6px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] p-3" aria-label={section.summary}>
      <div ref={rootRef} className="h-[280px] w-full" />
      <figcaption className="mt-2 border-t border-[var(--mm-border)] pt-2 text-[11px] leading-4 text-[var(--mm-text-secondary)]">{section.summary}</figcaption>
    </figure>
  );
}
