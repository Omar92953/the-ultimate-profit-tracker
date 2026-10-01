import db from "../db.server";
import { series, products, zonesBreakdown } from "./analytics.server";
import { cohorts, COHORT_WINDOWS } from "./customers.server";
import { toCsv } from "./csv";

export const REPORTS = [
  { id: "daily", title: "Daily profit & loss", description: "One row per day: orders, net sales, every cost and net profit." },
  { id: "orders", title: "Orders with full cost breakdown", description: "Every order with its product, shipping, fee, ad and extra costs, profit and ad source." },
  { id: "products", title: "Products", description: "Units, net sales, product cost, gross and net profit per product." },
  { id: "ads", title: "Ads", description: "Spend, platform-reported purchases, matched Shopify orders, real cost per purchase and ROAS per ad." },
  { id: "zones", title: "Shipping zones", description: "Orders, return rate, shipping cost and profit per zone." },
  { id: "customers", title: "Customer cohorts", description: "Customers, CAC and profit per customer at 30–365 days, by first-order month." },
  { id: "costs", title: "Product costs", description: "Every variant with its SKU and current cost (also the import template)." },
] as const;
export type ReportId = (typeof REPORTS)[number]["id"];

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const m = (cents: number | bigint | null | undefined) => (cents == null ? null : Number(cents) / 100);

export async function buildReport(shop: string, report: ReportId, from: string, to: string, today: string): Promise<{ filename: string; csv: string }> {
  const suffix = `${from}_to_${to}`;
  switch (report) {
    case "daily": {
      const rows = await series(shop, from, to);
      return {
        filename: `daily-pnl_${suffix}.csv`,
        csv: toCsv(rows, [
          { header: "Date", value: (r) => r.key },
          { header: "Orders", value: (r) => r.orders },
          { header: "Net sales", value: (r) => r.revenue },
          { header: "Product costs", value: (r) => r.cogs },
          { header: "Shipping", value: (r) => r.shipping },
          { header: "Ad spend", value: (r) => r.adSpend },
          { header: "Net profit", value: (r) => r.profit },
          { header: "Margin %", value: (r) => (r.revenue ? (r.profit / r.revenue) * 100 : null) },
        ]),
      };
    }
    case "orders": {
      const rows = await db.order.findMany({
        where: { shop, day: { gte: d(from), lte: d(to) } },
        orderBy: { processedAt: "asc" },
        include: { costs: { select: { type: true, amountCents: true } } },
      });
      const sumType = (r: (typeof rows)[number], types: string[]) => m(r.costs.filter((c) => types.includes(c.type)).reduce((s, c) => s + c.amountCents, 0));
      return {
        filename: `orders_${suffix}.csv`,
        csv: toCsv(rows, [
          { header: "Order", value: (r) => r.name },
          { header: "Date", value: (r) => r.day.toISOString().slice(0, 10) },
          { header: "Status", value: (r) => r.outcome },
          { header: "COD", value: (r) => (r.isCod ? "yes" : "no") },
          { header: "Country", value: (r) => r.countryCode },
          { header: "Province", value: (r) => r.province },
          { header: "Items", value: (r) => r.itemCount },
          { header: "Gross sales", value: (r) => m(r.grossSalesCents) },
          { header: "Discounts", value: (r) => m(r.discountsCents) },
          { header: "Returns", value: (r) => m(r.returnsCents) },
          { header: "Net sales", value: (r) => m(r.revenueCents) },
          { header: "Product costs", value: (r) => m(r.cogsCents) },
          { header: "Delivery", value: (r) => sumType(r, ["shipping"]) },
          { header: "Return shipping", value: (r) => sumType(r, ["return_shipping"]) },
          { header: "Payment & COD fees", value: (r) => m(r.feesCents) },
          { header: "Ad cost", value: (r) => m(r.adCents) },
          { header: "Extra costs", value: (r) => m(r.otherCents) },
          { header: "Net profit", value: (r) => m(r.profitCents) },
          { header: "Ad platform", value: (r) => r.adPlatform },
          { header: "Campaign", value: (r) => r.adCampaignId ?? r.utmCampaign },
          { header: "Ad", value: (r) => r.adId ?? r.utmContent },
          { header: "UTM source", value: (r) => r.utmSource },
          { header: "Missing product cost", value: (r) => (r.missingCost ? "yes" : "") },
        ]),
      };
    }
    case "products": {
      const rows = await products(shop, from, to, 5000);
      return {
        filename: `products_${suffix}.csv`,
        csv: toCsv(rows, [
          { header: "Product", value: (r) => r.title },
          { header: "Units", value: (r) => r.units },
          { header: "Orders", value: (r) => r.orders },
          { header: "Net sales", value: (r) => r.revenue },
          { header: "Product cost", value: (r) => r.cogs },
          { header: "Gross profit", value: (r) => r.grossProfit },
          { header: "Shipping, fees, ads & extra", value: (r) => r.orderCosts },
          { header: "Net profit", value: (r) => r.netProfit },
          { header: "Margin %", value: (r) => r.margin },
        ]),
      };
    }
    case "ads": {
      const rows = await adsReport(shop, from, to);
      return {
        filename: `ads_${suffix}.csv`,
        csv: toCsv(rows, [
          { header: "Platform", value: (r) => r.platform },
          { header: "Campaign", value: (r) => r.campaignName },
          { header: "Ad", value: (r) => r.adName },
          { header: "Spend", value: (r) => r.spend },
          { header: "Impressions", value: (r) => r.impressions },
          { header: "Clicks", value: (r) => r.clicks },
          { header: "Platform purchases", value: (r) => r.purchases },
          { header: "Platform CPA", value: (r) => (r.purchases ? r.spend / r.purchases : null) },
          { header: "Shopify orders", value: (r) => r.orders },
          { header: "Real CPA", value: (r) => (r.orders ? r.spend / r.orders : null) },
          { header: "Net sales", value: (r) => r.revenue },
          { header: "Real ROAS", value: (r) => (r.spend ? r.revenue / r.spend : null) },
          { header: "Net profit", value: (r) => r.profit },
        ]),
      };
    }
    case "zones": {
      const rows = await zonesBreakdown(shop, from, to);
      return {
        filename: `shipping-zones_${suffix}.csv`,
        csv: toCsv(rows, [
          { header: "Zone", value: (r) => r.label },
          { header: "Orders", value: (r) => r.orders },
          { header: "Returned", value: (r) => r.returned },
          { header: "Return rate %", value: (r) => (r.orders ? (r.returned / r.orders) * 100 : null) },
          { header: "Net sales", value: (r) => r.revenue },
          { header: "Shipping cost", value: (r) => r.shipping },
          { header: "Net profit", value: (r) => r.profit },
        ]),
      };
    }
    case "customers": {
      const rows = await cohorts(shop, today, 24);
      return {
        filename: `customer-cohorts_${today}.csv`,
        csv: toCsv(rows, [
          { header: "First order month", value: (r) => r.month },
          { header: "Customers", value: (r) => r.customers },
          { header: "CAC", value: (r) => r.cac },
          ...COHORT_WINDOWS.map((w) => ({ header: `Profit per customer ${w}d`, value: (r: (typeof rows)[number]) => r.profit[w] })),
          ...COHORT_WINDOWS.map((w) => ({ header: `Sales per customer ${w}d`, value: (r: (typeof rows)[number]) => r.revenue[w] })),
          { header: "Repeat rate %", value: (r) => r.repeatRate },
        ]),
      };
    }
    case "costs": {
      const variants = await db.variant.findMany({ where: { shop }, orderBy: [{ productId: "asc" }, { id: "asc" }] });
      const productsById = new Map((await db.product.findMany({ where: { shop }, select: { id: true, title: true } })).map((p) => [String(p.id), p.title]));
      const latest = await db.variantCost.findMany({ where: { shop }, orderBy: { effectiveFrom: "desc" }, distinct: ["variantId"] });
      const cost = new Map(latest.map((c) => [String(c.variantId), c.costCents]));
      return {
        filename: "product-costs.csv",
        csv: toCsv(variants, [
          { header: "variant_id", value: (v) => String(v.id) },
          { header: "sku", value: (v) => v.sku },
          { header: "product", value: (v) => productsById.get(String(v.productId)) },
          { header: "variant", value: (v) => v.title },
          { header: "cost", value: (v) => m(cost.get(String(v.id))) },
        ]),
      };
    }
  }
}

export type AdRowReport = { platform: string; campaignId: string; campaignName: string; adId: string; adName: string; spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number; orders: number; revenue: number; profit: number };

/** Per ad: platform numbers next to what really happened in Shopify. */
export async function adsReport(shop: string, from: string, to: string): Promise<AdRowReport[]> {
  const ads = await db.adInsightDaily.groupBy({
    by: ["platform", "campaignId", "adId"],
    where: { shop, date: { gte: d(from), lte: d(to) } },
    _sum: { spendShopCents: true, impressions: true, clicks: true, purchases: true, purchaseValueCents: true },
    _max: { campaignName: true, adName: true },
  });
  const orders = await db.order.groupBy({
    by: ["adPlatform", "adId"],
    where: { shop, day: { gte: d(from), lte: d(to) }, adId: { not: null }, outcome: { not: "cancelled" } },
    _count: { _all: true },
    _sum: { revenueCents: true, profitCents: true },
  });
  const byAd = new Map(orders.map((o) => [`${o.adPlatform}|${o.adId}`, o]));
  return ads
    .map((a) => {
      const o = byAd.get(`${a.platform}|${a.adId}`);
      return {
        platform: a.platform,
        campaignId: a.campaignId,
        campaignName: a._max.campaignName ?? a.campaignId,
        adId: a.adId,
        adName: a._max.adName ?? a.adId,
        spend: Number(a._sum.spendShopCents ?? 0) / 100,
        impressions: Number(a._sum.impressions ?? 0),
        clicks: Number(a._sum.clicks ?? 0),
        purchases: Number(a._sum.purchases ?? 0),
        purchaseValue: Number(a._sum.purchaseValueCents ?? 0) / 100,
        orders: o?._count._all ?? 0,
        revenue: Number(o?._sum.revenueCents ?? 0) / 100,
        profit: Number(o?._sum.profitCents ?? 0) / 100,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}
