import React, { useMemo, useState } from "react";
import type { GeneratedUiPrimitive, GeneratedUiSectionV2 } from "@shared";

interface GeneratedUiTableProps {
  section: Extract<GeneratedUiSectionV2, { kind: "table" }>;
}

function compareValues(left: GeneratedUiPrimitive, right: GeneratedUiPrimitive): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function formatValue(value: GeneratedUiPrimitive, format: "text" | "number" | "percent" | undefined): string {
  if (value === null) return "";
  if (format === "number" && typeof value === "number") return new Intl.NumberFormat().format(value);
  if (format === "percent" && typeof value === "number") return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}%`;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

export function GeneratedUiTable({ section }: GeneratedUiTableProps): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return section.rows;
    return [...section.rows].sort((a, b) => {
      const value = compareValues(a[sort.key] ?? null, b[sort.key] ?? null);
      return sort.direction === "asc" ? value : -value;
    });
  }, [section.rows, sort]);

  return (
    <div className="overflow-x-auto rounded-[6px] border border-[var(--mm-border)] bg-[var(--mm-bg-input)]">
      <table className="w-full min-w-[480px] border-collapse text-left text-xs">
        {section.caption ? <caption className="border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-left text-[11px] font-medium text-[var(--mm-text-secondary)]">{section.caption}</caption> : null}
        <thead>
          <tr className="border-b border-[var(--mm-border-strong)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-secondary)]">
            {section.columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th key={column.key} className="px-3 py-2.5 font-medium" style={{ textAlign: column.align ?? "left" }} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  {column.sortable ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-[var(--mm-text-primary)]"
                      onClick={() => setSort((current) => current?.key === column.key
                        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                        : { key: column.key, direction: "asc" })}
                    >
                      {column.label}
                      <span aria-hidden>{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  ) : column.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--mm-border)] transition-colors last:border-b-0 hover:bg-[var(--mm-bg-hover)]">
              {section.columns.map((column) => (
                <td key={column.key} className="max-w-[320px] px-3 py-2.5 align-top text-[var(--mm-text-primary)]" style={{ textAlign: column.align ?? "left" }}>
                  <span className="break-words">{formatValue(row[column.key] ?? null, column.format)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
