import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router";
import styles from "./ui.module.css";

/** Equal-height card grid. `cols` = cards per row on wide screens (2 on tablets, 1 on phones). */
export function CardGrid({ cols = 3, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className={styles.grid} style={{ "--cols": cols } as CSSProperties}>
      {children}
    </div>
  );
}

export function Card(props: { title: ReactNode; badge?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{props.title}</h3>
        {props.badge}
      </div>
      {props.children}
      {props.actions ? <div className={styles.cardActions}>{props.actions}</div> : null}
    </div>
  );
}

export function CardText({ children }: { children: ReactNode }) {
  return <p className={styles.cardText}>{children}</p>;
}

export function Pill({ tone = "muted", children }: { tone?: "ok" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <h2 className={styles.groupTitle}>{children}</h2>;
}

/** The row above analytics pages: date range picker plus a short note. */
export function Toolbar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className={styles.toolbar}>
      {children}
      {note ? <span className={styles.toolbarNote}>{note}</span> : null}
    </div>
  );
}

/** Link tabs. `match` decides which is active (pathname + optional ?tab=). */
export function Tabs({ items }: { items: { label: string; to: string }[] }) {
  const { pathname, search } = useLocation();
  const here = new URLSearchParams(search).get("tab");
  return (
    <nav className={styles.tabs} aria-label="Sections">
      {items.map((t) => {
        const [path, query] = t.to.split("?");
        const tab = new URLSearchParams(query ?? "").get("tab");
        const active = pathname === path && (tab ?? null) === (here ?? null);
        return (
          <Link key={t.to} to={t.to} className={`${styles.tab} ${active ? styles.tabActive : ""}`} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Checklist({ items }: { items: { text: string; action: ReactNode }[] }) {
  return (
    <div className={styles.checklist}>
      {items.map((i) => (
        <div key={i.text} className={styles.checkRow}>
          <span className={styles.checkText}>
            <span className={styles.dot} />
            {i.text}
          </span>
          {i.action}
        </div>
      ))}
    </div>
  );
}

export const COST_TABS = [
  { label: "Product costs", to: "/app/costs" },
  { label: "Shipping", to: "/app/zones" },
  { label: "Payment fees", to: "/app/costs?tab=fees" },
  { label: "Extra costs", to: "/app/costs?tab=extra" },
];

/** Segmented buttons (e.g. which metric a chart shows). */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={styles.tabs} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={`${styles.tab} ${styles.segButton} ${o.value === props.value ? styles.tabActive : ""}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Three equal cards that explain a cost type: what it is, how the app uses it, and a worked example. */
export function Explainer(props: { what: ReactNode; how: ReactNode; example: ReactNode }) {
  return (
    <CardGrid cols={3}>
      <Card title="What it is">
        <CardText>{props.what}</CardText>
      </Card>
      <Card title="How the app uses it">
        <CardText>{props.how}</CardText>
      </Card>
      <Card title="Example">
        <CardText>{props.example}</CardText>
      </Card>
    </CardGrid>
  );
}

export const COST_HELP = {
  products: {
    what: "What you pay your supplier for one item (cost of goods). Shopify calls it “Cost per item”.",
    how: "Every order costs the items it kept × their cost on the order date. Refused or returned items go back to stock, so they cost nothing. “All orders” fixes a wrong cost everywhere; “From today” keeps past orders at the old price.",
    example: "A hoodie costs you 400. An order with 2 hoodies has a product cost of 800. If 1 is returned, it becomes 400.",
  },
  shipping: {
    what: "What your courier really charges you per order in each area, not what the customer paid. Areas are found automatically from your orders.",
    how: "Each order gets its zone's delivery cost (plus extra per item or kg if you set them). A refused or returned COD order also gets the return cost. The Dashboard compares this with the shipping customers paid.",
    example: "Cairo: delivery 60, return 40. A delivered order costs 60. A refused COD order costs 100 and earns nothing.",
  },
  fees: {
    what: "The part of each payment your provider keeps (e.g. Paymob, Fawry), and the collection fee your courier keeps on cash on delivery.",
    how: "Fee % × order total + fixed fee, on every paid order. Cash on delivery uses the COD fee (a zone can have its own). Refused COD orders have no collection fee.",
    example: "Paymob 2.75% + 3 on a 1,000 order = 30.50. COD 1% on a 1,000 order = 10.",
  },
  extra: {
    what: "Any other cost of running the store: fulfilment, packaging, salaries, apps, an influencer, rent.",
    how: "Choose how it's charged (per order, per item, % of sales or profit, or a monthly total shared across orders) and which orders it belongs to (products, zones, COD, ads, new customers…).",
    example: "Salaries 10,000 a month shared by order value: a 1,000 order in a month with 250,000 sales carries 40.",
  },
};
