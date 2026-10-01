import db from "../db.server";
import { addDays } from "./dates";

/**
 * Customer economics from the hashed customer id on each order (no personal data).
 *  - CAC: ad spend ÷ customers whose first order fell in the period.
 *  - LTV: what an average customer has brought in so far (net sales and net profit),
 *    and per cohort at 30/60/90/180/365 days after their first order.
 */
import { COHORT_WINDOWS as WINDOWS } from "./metrics";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const num = (v: unknown) => Number(v ?? 0);

export type CustomerSummary = {
  newCustomers: number;
  returningCustomers: number;
  adSpend: number;
  cac: number | null;
  ltvRevenue: number | null;
  ltvProfit: number | null;
  ltvToCac: number | null;
  repeatRate: number | null;
  ordersPerCustomer: number | null;
};

export async function customerSummary(shop: string, from: string, to: string): Promise<CustomerSummary> {
  const [row] = await db.$queryRaw<Record<string, unknown>[]>`
    WITH firsts AS (
      SELECT "customerHash" AS h, MIN(day) AS first_day FROM "Order"
      WHERE shop = ${shop} AND "customerHash" IS NOT NULL AND outcome <> 'cancelled' AND test = false GROUP BY 1
    ), in_range AS (
      SELECT DISTINCT "customerHash" AS h FROM "Order"
      WHERE shop = ${shop} AND "customerHash" IS NOT NULL AND outcome <> 'cancelled' AND test = false AND day BETWEEN ${d(from)} AND ${d(to)}
    ), lifetime AS (
      SELECT "customerHash" AS h, SUM("revenueCents") AS rev, SUM("profitCents") AS profit, COUNT(*) AS orders FROM "Order"
      WHERE shop = ${shop} AND "customerHash" IS NOT NULL AND outcome <> 'cancelled' AND test = false GROUP BY 1
    )
    SELECT
      COUNT(*) FILTER (WHERE f.first_day BETWEEN ${d(from)} AND ${d(to)}) AS new_customers,
      COUNT(*) FILTER (WHERE f.first_day < ${d(from)}) AS returning_customers,
      AVG(l.rev) FILTER (WHERE f.first_day BETWEEN ${d(from)} AND ${d(to)}) AS ltv_rev,
      AVG(l.profit) FILTER (WHERE f.first_day BETWEEN ${d(from)} AND ${d(to)}) AS ltv_profit,
      AVG(l.orders) FILTER (WHERE f.first_day BETWEEN ${d(from)} AND ${d(to)}) AS orders_per,
      COUNT(*) FILTER (WHERE f.first_day BETWEEN ${d(from)} AND ${d(to)} AND l.orders > 1) AS repeaters
    FROM in_range r JOIN firsts f ON f.h = r.h JOIN lifetime l ON l.h = r.h`;
  const [ads] = await db.$queryRaw<{ spend: bigint | null }[]>`
    SELECT SUM("spendShopCents") AS spend FROM "AdInsightDaily" WHERE shop = ${shop} AND date BETWEEN ${d(from)} AND ${d(to)}`;
  const newCustomers = num(row?.new_customers);
  const adSpend = num(ads?.spend) / 100;
  const cac = adSpend && newCustomers ? adSpend / newCustomers : null;
  const ltvProfit = row?.ltv_profit == null ? null : num(row.ltv_profit) / 100;
  return {
    newCustomers,
    returningCustomers: num(row?.returning_customers),
    adSpend,
    cac,
    ltvRevenue: row?.ltv_rev == null ? null : num(row.ltv_rev) / 100,
    ltvProfit,
    ltvToCac: cac && ltvProfit !== null ? ltvProfit / cac : null,
    repeatRate: newCustomers ? (num(row?.repeaters) / newCustomers) * 100 : null,
    ordersPerCustomer: row?.orders_per == null ? null : num(row.orders_per),
  };
}

export type Cohort = {
  month: string;
  customers: number;
  cac: number | null;
  repeatRate: number;
  /** Net sales / net profit per customer within N days of their first order (null = not reached yet). */
  revenue: Record<number, number | null>;
  profit: Record<number, number | null>;
  paybackDays: number | null;
};

export async function cohorts(shop: string, today: string, months = 12): Promise<Cohort[]> {
  const since = `${addDays(today, -31 * months).slice(0, 7)}-01`;
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH firsts AS (
      SELECT "customerHash" AS h, MIN("processedAt") AS first_at FROM "Order"
      WHERE shop = ${shop} AND "customerHash" IS NOT NULL AND outcome <> 'cancelled' AND test = false GROUP BY 1
    )
    SELECT to_char(date_trunc('month', f.first_at), 'YYYY-MM') AS month,
      COUNT(DISTINCT f.h) AS customers,
      COUNT(DISTINCT o."customerHash") FILTER (WHERE o."processedAt" > f.first_at) AS repeaters,
      SUM(o."revenueCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '30 days') AS r30,
      SUM(o."revenueCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '60 days') AS r60,
      SUM(o."revenueCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '90 days') AS r90,
      SUM(o."revenueCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '180 days') AS r180,
      SUM(o."revenueCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '365 days') AS r365,
      SUM(o."profitCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '30 days') AS p30,
      SUM(o."profitCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '60 days') AS p60,
      SUM(o."profitCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '90 days') AS p90,
      SUM(o."profitCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '180 days') AS p180,
      SUM(o."profitCents") FILTER (WHERE o."processedAt" <= f.first_at + interval '365 days') AS p365
    FROM firsts f
    JOIN "Order" o ON o.shop = ${shop} AND o."customerHash" = f.h AND o.outcome <> 'cancelled' AND o.test = false
    WHERE f.first_at >= ${d(since)}
    GROUP BY 1 ORDER BY 1 DESC`;
  const spend = await db.$queryRaw<{ month: string; spend: bigint }[]>`
    SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS month, SUM("spendShopCents") AS spend
    FROM "AdInsightDaily" WHERE shop = ${shop} AND date >= ${d(since)} GROUP BY 1`;
  const spendBy = new Map(spend.map((s) => [s.month, num(s.spend) / 100]));

  return rows.map((r) => {
    const month = String(r.month);
    const customers = num(r.customers);
    // A window only counts once every customer in the cohort has had that many days.
    const lastFirst = addDays(`${month}-01`, 31);
    const reached = (days: number) => addDays(lastFirst, days) <= today;
    const revenue: Record<number, number | null> = {};
    const profit: Record<number, number | null> = {};
    for (const w of WINDOWS) {
      revenue[w] = reached(w) ? num(r[`r${w}`]) / 100 / customers : null;
      profit[w] = reached(w) ? num(r[`p${w}`]) / 100 / customers : null;
    }
    const spent = spendBy.get(month) ?? 0;
    const cac = spent && customers ? spent / customers : null;
    const paybackDays = cac === null ? null : (WINDOWS.find((w) => (profit[w] ?? -Infinity) >= cac) ?? null);
    return { month, customers, cac, repeatRate: customers ? (num(r.repeaters) / customers) * 100 : 0, revenue, profit, paybackDays };
  });
}

export { COHORT_WINDOWS } from "./metrics";
