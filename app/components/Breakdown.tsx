import { formatValue } from "./charts";
import styles from "./Breakdown.module.css";

export type BreakdownLine = {
  label: string;
  value: number;
  /** How the line combines: "+" adds, "-" subtracts, "=" is a subtotal. */
  sign: "+" | "-" | "=";
  previous?: number | null;
  hint?: string;
  strong?: boolean;
};

/** A Shopify-style money breakdown: each line, its sign, and the change vs. the comparison period. */
export function Breakdown({ lines, currency }: { lines: BreakdownLine[]; currency: string }) {
  return (
    <div className={styles.list} role="table">
      {lines.map((l) => {
        const change = l.previous != null && l.previous !== 0 ? ((l.value - l.previous) / Math.abs(l.previous)) * 100 : null;
        const shown = l.sign === "-" && l.value !== 0 ? -Math.abs(l.value) : l.value;
        return (
          <div key={l.label} role="row" className={`${styles.row} ${l.sign === "=" ? styles.total : ""} ${l.strong ? styles.strong : ""}`}>
            <span role="cell" className={styles.label} title={l.hint}>
              {l.label}
              {l.hint ? <span className={styles.hint}>{l.hint}</span> : null}
            </span>
            <span role="cell" className={styles.change}>
              {change !== null && Number.isFinite(change) ? `${change >= 0 ? "↗" : "↘"} ${Math.abs(change).toFixed(0)}%` : ""}
            </span>
            <span role="cell" className={`${styles.value} ${shown < 0 ? styles.negative : ""}`}>{formatValue(shown, "money", currency)}</span>
          </div>
        );
      })}
    </div>
  );
}
