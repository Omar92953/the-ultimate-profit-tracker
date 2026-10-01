import { Prisma } from "@prisma/client";
import db from "../db.server";
import { addDays, bucketFor, daysBetween } from "./dates";

/**
 * Aggregates for dashboards and reports. All money is returned in whole currency units
 * (not cents) so charts and CSVs read naturally. Test orders are excluded when the setting says so.
 */
export type Totals = {
  orders: number;
  cancelled: number;
  returned: number;
  newCustomers: number;
  customers: number;
  revenue: number;
  grossSales: number;
  discounts: number;
  returns: number;
  cogs: number;
  shipping: number;
  fees: number;
  adAllocated: number;
  other: number;
  profit: number;
  adSpend: number;
  missingCostOrders: number;
  /** Shipping the customers paid (Shopify's "shipping charges"). */
  shippingCharged: number;
  taxes: number;
};

export type Derived = Totals & {
  /** Shopify's definitions: net sales = gross − discounts − returns; total = net + shipping + taxes. */
  shopifyNetSales: number;
  totalSales: number;
  shippingResult: number;
  unallocatedAd: number;
  margin: number | null;
  aov: number | null;
  profitPerOrder: number | null;
  roas: number | null;
  cpa: number | null;
  cac: number | null;
  returnRate: number | null;
  grossProfit: number;
};

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => n(v) / 100;

function testFilter(excludeTest: boolean) {
  return excludeTest ? Prisma.sql`AND o.test = false` : Prisma.empty;
}

export async function totals(shop: string, from: string, to: string, excludeTest = true): Promise<Derived> {
  const [row] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT
      COUNT(*) FILTER (WHERE o.outcome <> 'cancelled') AS orders,
      COUNT(*) FILTER (WHERE o.outcome = 'cancelled') AS cancelled,
      COUNT(*) FILTER (WHERE o.outcome = 'returned') AS returned,
      COUNT(DISTINCT o."customerHash") FILTER (WHERE o.outcome <> 'cancelled') AS customers,
      SUM(o."revenueCents") AS revenue,
      SUM(o."grossSalesCents") FILTER (WHERE o.outcome <> 'cancelled') AS gross,
      SUM(o."discountsCents") FILTER (WHERE o.outcome <> 'cancelled') AS discounts,
      SUM(o."returnsCents") FILTER (WHERE o.outcome <> 'cancelled') AS returns,
      SUM(o."shippingChargedCents" - o."shippingRefundCents") FILTER (WHERE o.outcome <> 'cancelled') AS shipping_charged,
      SUM(o."taxesCents") FILTER (WHERE o.outcome <> 'cancelled') AS taxes,
      SUM(o."cogsCents") AS cogs,
      SUM(o."shippingCents") AS shipping,
      SUM(o."feesCents") AS fees,
      SUM(o."adCents") AS ad,
      SUM(o."otherCents") AS other,
      SUM(o."profitCents") AS profit,
      COUNT(*) FILTER (WHERE o."missingCost") AS missing
    FROM "Order" o
    WHERE o.shop = ${shop} AND o.day BETWEEN ${d(from)} AND ${d(to)} ${testFilter(excludeTest)}`;

  // A customer is new in the range if their first-ever order falls inside it.
  const [fresh] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT o."customerHash", MIN(o.day) AS first_day
      FROM "Order" o
      WHERE o.shop = ${shop} AND o."customerHash" IS NOT NULL AND o.outcome <> 'cancelled' ${testFilter(excludeTest)}
      GROUP BY o."customerHash"
    ) c WHERE c.first_day BETWEEN ${d(from)} AND ${d(to)}`;

  const [ads] = await db.$queryRaw<{ spend: bigint | null }[]>`
    SELECT SUM("spendShopCents") AS spend FROM "AdInsightDaily" WHERE shop = ${shop} AND date BETWEEN ${d(from)} AND ${d(to)}`;

  const t: Totals = {
    orders: n(row.orders),
    cancelled: n(row.cancelled),
    returned: n(row.returned),
    customers: n(row.customers),
    newCustomers: n(fresh?.n),
    revenue: money(row.revenue),
    grossSales: money(row.gross),
    discounts: money(row.discounts),
    returns: money(row.returns),
    cogs: money(row.cogs),
    shipping: money(row.shipping),
    fees: money(row.fees),
    adAllocated: money(row.ad),
    other: money(row.other),
    profit: money(row.profit),
    adSpend: money(ads?.spend),
    missingCostOrders: n(row.missing),
    shippingCharged: money(row.shipping_charged),
    taxes: money(row.taxes),
  };
  return derive(t);
}

export function derive(t: Totals): Derived {
  const div = (a: number, b: number) => (b ? a / b : null);
  // Ad spend that no order carried (attributed-only model, or days without orders) still costs money.
  const unallocated = Math.max(0, t.adSpend - t.adAllocated);
  const profit = t.profit - unallocated;
  const shopifyNetSales = t.grossSales - t.discounts - t.returns;
  return {
    ...t,
    shopifyNetSales,
    totalSales: shopifyNetSales + t.shippingCharged + t.taxes,
    shippingResult: t.shippingCharged - t.shipping,
    unallocatedAd: unallocated,
    profit,
    grossProfit: t.revenue - t.cogs,
    margin: t.revenue ? (profit / t.revenue) * 100 : null,
    aov: div(t.revenue, t.orders),
    profitPerOrder: div(profit, t.orders),
    roas: div(t.revenue, t.adSpend),
    cpa: t.adSpend ? div(t.adSpend, t.orders) : null,
    cac: t.adSpend ? div(t.adSpend, t.newCustomers) : null,
    returnRate: t.orders ? (t.returned / t.orders) * 100 : null,
  };
}

export type SeriesPoint = { key: string; revenue: number; profit: number; adSpend: number; orders: number; cogs: number; shipping: number };

/** Values per day/week/month with every bucket present (zeros where there were no orders). */
export async function series(shop: string, from: string, to: string, excludeTest = true): Promise<SeriesPoint[]> {
  const bucket = bucketFor(from, to);
  const keys = bucketKeys(from, to, bucket);
  const trunc = Prisma.raw(`'${bucket}'`);
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT to_char(date_trunc(${trunc}, o.day), 'YYYY-MM-DD') AS k,
      SUM(o."revenueCents") AS revenue, SUM(o."profitCents") AS profit,
      COUNT(*) FILTER (WHERE o.outcome <> 'cancelled') AS orders,
      SUM(o."cogsCents") AS cogs, SUM(o."shippingCents") AS shipping
    FROM "Order" o
    WHERE o.shop = ${shop} AND o.day BETWEEN ${d(from)} AND ${d(to)} ${testFilter(excludeTest)}
    GROUP BY 1`;
  const ads = await db.$queryRaw<{ k: string; spend: bigint }[]>`
    SELECT to_char(date_trunc(${trunc}, date), 'YYYY-MM-DD') AS k, SUM("spendShopCents") AS spend
    FROM "AdInsightDaily" WHERE shop = ${shop} AND date BETWEEN ${d(from)} AND ${d(to)} GROUP BY 1`;
  const byKey = new Map(rows.map((r) => [String(r.k), r]));
  const adByKey = new Map(ads.map((r) => [r.k, money(r.spend)]));
  return keys.map((k) => {
    const r = byKey.get(k);
    return {
      key: bucket === "month" ? k.slice(0, 7) : k,
      revenue: money(r?.revenue),
      profit: money(r?.profit),
      orders: n(r?.orders),
      cogs: money(r?.cogs),
      shipping: money(r?.shipping),
      adSpend: adByKey.get(k) ?? 0,
    };
  });
}

function bucketKeys(from: string, to: string, bucket: "day" | "week" | "month"): string[] {
  const keys: string[] = [];
  if (bucket === "day") {
    for (let i = 0; i < daysBetween(from, to); i++) keys.push(addDays(from, i));
    return keys;
  }
  if (bucket === "week") {
    const start = d(from);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday, like date_trunc
    for (let cur = start.toISOString().slice(0, 10); cur <= to; cur = addDays(cur, 7)) keys.push(cur);
    return keys;
  }
  let cur = `${from.slice(0, 7)}-01`;
  while (cur <= to) {
    keys.push(cur);
    const [y, m] = [Number(cur.slice(0, 4)), Number(cur.slice(5, 7))];
    cur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return keys;
}

export type ProductRow = {
  productId: string;
  title: string;
  units: number;
  orders: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  /** Shipping, fees, ads and extra costs of its orders, shared by line value. */
  orderCosts: number;
  netProfit: number;
  margin: number | null;
  missingCost: boolean;
};

/** Product performance on delivered / open orders, with each order's costs shared across its lines. */
export async function products(shop: string, from: string, to: string, limit = 50, excludeTest = true): Promise<ProductRow[]> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    WITH lines AS (
      SELECT l."productId", l.title, l."orderId", l.quantity - l."refundedQty" AS units,
        (l."unitPriceCents" * l.quantity - l."discountCents") * GREATEST(l.quantity - l."refundedQty", 0) / NULLIF(l.quantity, 0) AS rev,
        COALESCE(l."unitCostCents", 0) * GREATEST(l.quantity - l."refundedQty", 0) AS cogs,
        l."unitCostCents" IS NULL AS missing,
        o."shippingCents" + o."feesCents" + o."adCents" + o."otherCents" AS order_costs
      FROM "OrderLine" l JOIN "Order" o ON o.shop = l.shop AND o.id = l."orderId"
      WHERE l.shop = ${shop} AND o.day BETWEEN ${d(from)} AND ${d(to)} AND o.outcome NOT IN ('cancelled', 'returned') ${testFilter(excludeTest)}
    ), shared AS (
      SELECT *, order_costs * rev / NULLIF(SUM(rev) OVER (PARTITION BY "orderId"), 0) AS share FROM lines
    )
    SELECT "productId"::text AS id, MAX(title) AS title, SUM(units) AS units, COUNT(DISTINCT "orderId") AS orders,
      SUM(rev) AS revenue, SUM(cogs) AS cogs, SUM(COALESCE(share, 0)) AS costs, BOOL_OR(missing) AS missing
    FROM shared GROUP BY "productId" ORDER BY revenue DESC NULLS LAST LIMIT ${limit}`;
  return rows.map((r) => {
    const revenue = money(r.revenue);
    const cogs = money(r.cogs);
    const orderCosts = money(r.costs);
    const netProfit = revenue - cogs - orderCosts;
    return {
      productId: String(r.id),
      title: String(r.title),
      units: n(r.units),
      orders: n(r.orders),
      revenue,
      cogs,
      grossProfit: revenue - cogs,
      orderCosts,
      netProfit,
      margin: revenue ? (netProfit / revenue) * 100 : null,
      missingCost: !!r.missing,
    };
  });
}

export type ZoneRow = { zoneId: string | null; label: string; orders: number; returned: number; revenue: number; shipping: number; profit: number };

export async function zonesBreakdown(shop: string, from: string, to: string, excludeTest = true): Promise<ZoneRow[]> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT o."zoneId" AS id, COALESCE(MAX(z.label), 'Unknown') AS label,
      COUNT(*) FILTER (WHERE o.outcome <> 'cancelled') AS orders,
      COUNT(*) FILTER (WHERE o.outcome = 'returned') AS returned,
      SUM(o."revenueCents") AS revenue, SUM(o."shippingCents") AS shipping, SUM(o."profitCents") AS profit
    FROM "Order" o LEFT JOIN "ShippingZone" z ON z.id = o."zoneId"
    WHERE o.shop = ${shop} AND o.day BETWEEN ${d(from)} AND ${d(to)} ${testFilter(excludeTest)}
    GROUP BY o."zoneId" ORDER BY orders DESC LIMIT 50`;
  return rows.map((r) => ({
    zoneId: r.id ? String(r.id) : null,
    label: String(r.label),
    orders: n(r.orders),
    returned: n(r.returned),
    revenue: money(r.revenue),
    shipping: money(r.shipping),
    profit: money(r.profit),
  }));
}

export { pctChange } from "./metrics";
