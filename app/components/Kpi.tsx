import { formatValue, Spark, type Point, type ValueKind } from "./charts";
import styles from "./Kpi.module.css";

/**
 * A metric card like Shopify Analytics: label, value, change vs. the comparison period and a
 * sparkline. `goodWhenDown` flips the colour for costs (spend going down is good news).
 */
export function Kpi(props: {
  label: string;
  value: number | null;
  previous?: number | null;
  change?: number | null;
  kind: ValueKind;
  currency: string;
  points?: Point[];
  comparePoints?: Point[] | null;
  goodWhenDown?: boolean;
  help?: string;
}) {
  const change = props.change ?? null;
  const good = change === null ? null : props.goodWhenDown ? change <= 0 : change >= 0;
  return (
    <div className={styles.card} title={props.help}>
      <div className={styles.label}>{props.label}</div>
      <div className={styles.row}>
        <span className={styles.value}>{props.value === null ? "–" : formatValue(props.value, props.kind, props.currency)}</span>
        {change !== null && Number.isFinite(change) ? (
          <span className={`${styles.change} ${good ? styles.up : styles.down}`}>
            {change >= 0 ? "↗" : "↘"} {Math.abs(change).toFixed(0)}%
          </span>
        ) : null}
      </div>
      {props.points?.length ? (
        <div className={styles.spark}>
          <Spark points={props.points} compare={props.comparePoints} />
        </div>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
