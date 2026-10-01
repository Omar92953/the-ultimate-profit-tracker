import { useSyncExternalStore, type ReactNode } from "react";
import { BarChart, DonutChart, LineChart, PolarisVizProvider, SparkLineChart, type DataSeries } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";
import styles from "./charts.module.css";

/**
 * Charts use @shopify/polaris-viz, the library behind Shopify Analytics, so they look and behave
 * like the merchant's own reports. They render in the browser only (they measure the DOM).
 */
export type ValueKind = "money" | "number" | "percent";

export function formatValue(value: number | string | null, kind: ValueKind, currency: string): string {
  if (value === null || value === "") return "–";
  const n = Number(value);
  if (kind === "percent") return `${n.toFixed(1)}%`;
  if (kind === "number") return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, notation: Math.abs(n) >= 100000 ? "compact" : "standard", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

const noop = () => () => {};
/** false during server render and hydration, true in the browser afterwards. */
function useMounted() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function ChartProvider({ children }: { children: ReactNode }) {
  return <PolarisVizProvider defaultTheme="Light">{children}</PolarisVizProvider>;
}

function Frame(props: { height: number; children: ReactNode }) {
  const mounted = useMounted();
  return (
    <div className={styles.frame} style={{ height: props.height }}>
      {mounted ? props.children : <div className={styles.skeleton} />}
    </div>
  );
}

export type Point = { key: string; value: number | null };

/** Line chart over time with an optional dashed comparison line (previous period / year). */
export function TrendChart(props: {
  name: string;
  points: Point[];
  compare?: { name: string; points: Point[] } | null;
  kind: ValueKind;
  currency: string;
  height?: number;
}) {
  const data: DataSeries[] = [{ name: props.name, data: props.points }];
  if (props.compare) data.push({ name: props.compare.name, data: props.compare.points.map((p, i) => ({ key: props.points[i]?.key ?? p.key, value: p.value })), isComparison: true });
  const fmt = (v: number | string | null) => formatValue(v, props.kind, props.currency);
  return (
    <Frame height={props.height ?? 260}>
      <LineChart
        data={data}
        showLegend={!!props.compare}
        yAxisOptions={{ labelFormatter: fmt }}
        xAxisOptions={{ labelFormatter: (v) => shortDay(String(v)) }}
        tooltipOptions={{ valueFormatter: fmt, titleFormatter: (v) => shortDay(String(v)) }}
      />
    </Frame>
  );
}

/** Horizontal or vertical bars, e.g. profit by product or spend by platform. */
export function BarsChart(props: { series: { name: string; points: Point[] }[]; kind: ValueKind; currency: string; horizontal?: boolean; stacked?: boolean; height?: number }) {
  const fmt = (v: number | string | null) => formatValue(v, props.kind, props.currency);
  return (
    <Frame height={props.height ?? 260}>
      <BarChart
        data={props.series.map((s) => ({ name: s.name, data: s.points }))}
        direction={props.horizontal ? "horizontal" : "vertical"}
        type={props.stacked ? "stacked" : "default"}
        showLegend={props.series.length > 1}
        xAxisOptions={{ labelFormatter: props.horizontal ? fmt : (v) => shortDay(String(v)) }}
        yAxisOptions={{ labelFormatter: props.horizontal ? undefined : fmt }}
        tooltipOptions={{ valueFormatter: fmt }}
      />
    </Frame>
  );
}

/** Share of a whole, e.g. where the money went (COGS, shipping, ads, fees…). */
export function Donut(props: { slices: { name: string; value: number }[]; kind: ValueKind; currency: string; height?: number }) {
  const fmt = (v: number | string | null) => formatValue(v, props.kind, props.currency);
  return (
    <Frame height={props.height ?? 240}>
      <DonutChart
        data={props.slices.filter((s) => s.value > 0).map((s) => ({ name: s.name, data: [{ key: s.name, value: s.value }] }))}
        showLegend
        showLegendValues
        legendPosition="right"
        labelFormatter={fmt}
        tooltipOptions={{ valueFormatter: fmt }}
      />
    </Frame>
  );
}

export function Spark(props: { points: Point[]; compare?: Point[] | null; height?: number }) {
  const data: DataSeries[] = [{ data: props.points }];
  if (props.compare) data.push({ data: props.compare, isComparison: true });
  return (
    <Frame height={props.height ?? 44}>
      <SparkLineChart data={data} />
    </Frame>
  );
}

function shortDay(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
}
