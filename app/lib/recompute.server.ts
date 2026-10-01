import db from "../db.server";
import { readSettings } from "./settings";
import { computeProfit } from "./profit/compute";
import type { CalcRule, RuleFilters } from "./profit/rules";
import type { AdRow, CalcOrder, Outcome, ProductFacts } from "./profit/types";
import { zoneCosts } from "./zones.server";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function monthsBetween(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (;;) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ start, end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` });
    if (start.slice(0, 7) >= endKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Recalculate every order between two days (whole months, so monthly cost rules divide correctly). */
export async function recomputeRange(shop: string, from: string, to: string): Promise<{ orders: number }> {
  let total = 0;
  for (const month of monthsBetween(from, to)) total += await recomputeMonth(shop, month.start, month.end);
  return { orders: total };
}

/** Everything the profit engine needs for the orders between two days. */
export async function loadCalc(shop: string, start: string, end: string) {
  const shopRow = await db.shop.findUnique({ where: { id: shop } });
  if (!shopRow) return null;
  const settings = readSettings(shopRow.settings);
  const range = { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) };

  const orders = await db.order.findMany({
    where: { shop, day: range, ...(settings.excludeTestOrders ? { test: false } : {}) },
    include: { lines: true },
  });
  // Unit cost in effect when each order was placed.
  const variantIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.variantId)).filter((v): v is bigint => v !== null))];
  const history = await db.variantCost.findMany({ where: { shop, variantId: { in: variantIds } }, orderBy: { effectiveFrom: "asc" } });
  const costsByVariant = new Map<string, { at: Date; cents: number }[]>();
  for (const h of history) {
    const key = String(h.variantId);
    costsByVariant.set(key, [...(costsByVariant.get(key) ?? []), { at: h.effectiveFrom, cents: h.costCents }]);
  }
  const costAt = (variantId: bigint | null, at: Date): number | null => {
    if (variantId === null) return null;
    const list = costsByVariant.get(String(variantId));
    if (!list?.length) return null;
    let found = list[0].cents; // before the first record, the first known cost applies
    for (const c of list) if (c.at <= at) found = c.cents;
    return found;
  };

  // New vs returning: is this the customer's first order we know of?
  const hashes = [...new Set(orders.map((o) => o.customerHash).filter((h): h is string => !!h))];
  const firsts = hashes.length
    ? await db.order.groupBy({ by: ["customerHash"], where: { shop, customerHash: { in: hashes }, cancelledAt: null }, _min: { processedAt: true } })
    : [];
  const firstOrderAt = new Map(firsts.map((f) => [f.customerHash!, f._min.processedAt!]));

  // Product facts for rule filters.
  const productIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)).filter((p): p is bigint => p !== null))];
  const products = await db.product.findMany({ where: { shop, id: { in: productIds } } });
  const facts: ProductFacts = new Map(products.map((p) => [String(p.id), { tags: p.tags, vendor: p.vendor, productType: p.productType, collections: p.collections.map(String) }]));

  // Ad data for these days, with campaign/ad name lookups for orders whose UTMs carry names.
  const insights = await db.adInsightDaily.findMany({ where: { shop, date: range } });
  const adRows: AdRow[] = insights.map((r) => ({
    platform: r.platform,
    date: iso(r.date),
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    adId: r.adId,
    adName: r.adName,
    spendShopCents: r.spendShopCents,
  }));
  const campaignByName = new Map<string, string>();
  const adByName = new Map<string, string>();
  for (const r of insights) {
    if (r.campaignName) campaignByName.set(`${r.platform}|${r.campaignName.toLowerCase()}`, r.campaignId);
    if (r.adName) adByName.set(`${r.platform}|${r.adName.toLowerCase()}`, r.adId);
  }

  const calc: CalcOrder[] = orders.map((o) => {
    const campaignId = o.adCampaignId ?? (o.adPlatform && o.utmCampaign ? (campaignByName.get(`${o.adPlatform}|${o.utmCampaign.toLowerCase()}`) ?? null) : null);
    const adId = o.adId ?? (o.adPlatform && o.utmContent ? (adByName.get(`${o.adPlatform}|${o.utmContent.toLowerCase()}`) ?? null) : null);
    const first = o.customerHash ? firstOrderAt.get(o.customerHash) : undefined;
    return {
      id: String(o.id),
      name: o.name,
      day: iso(o.day),
      outcome: o.outcome as Outcome,
      isCod: o.isCod,
      gateways: o.gateways,
      channel: o.channel,
      countryCode: o.countryCode,
      zoneId: o.zoneId,
      carrier: o.carrier,
      itemCount: o.itemCount,
      weightGrams: o.weightGrams,
      isNewCustomer: first ? first.getTime() === o.processedAt.getTime() : null,
      adPlatform: o.adPlatform,
      adCampaignId: campaignId,
      adId,
      grossSalesCents: o.grossSalesCents,
      discountsCents: o.discountsCents,
      returnsCents: o.returnsCents,
      shippingChargedCents: o.shippingChargedCents,
      shippingRefundCents: o.shippingRefundCents,
      taxesCents: o.taxesCents,
      totalCents: o.totalCents,
      shopifyFeesCents: o.shopifyFeesCents,
      lines: o.lines.map((l) => ({
        id: String(l.id),
        productId: l.productId === null ? null : String(l.productId),
        variantId: l.variantId === null ? null : String(l.variantId),
        title: l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title,
        quantity: l.quantity,
        refundedQty: l.refundedQty,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        unitCostCents: costAt(l.variantId, o.processedAt),
      })),
    };
  });

  return { settings, calc, facts, adRows };
}

export function toCalcRule(r: { id: string; name: string; kind: string; amount: unknown; period: string | null; distribute: string | null; startsOn: Date | null; endsOn: Date | null; filters: unknown }): CalcRule {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as CalcRule["kind"],
    amount: Number(r.amount),
    period: (r.period as CalcRule["period"]) ?? null,
    distribute: (r.distribute as CalcRule["distribute"]) ?? null,
    startsOn: r.startsOn ? iso(r.startsOn) : null,
    endsOn: r.endsOn ? iso(r.endsOn) : null,
    filters: (r.filters ?? {}) as RuleFilters,
  };
}

async function recomputeMonth(shop: string, start: string, end: string): Promise<number> {
  const ctx = await loadCalc(shop, start, end);
  if (!ctx || !ctx.calc.length) return 0;
  const { settings, calc, facts, adRows } = ctx;
  const ruleRows = await db.costRule.findMany({ where: { shop, active: true } });
  const rules: CalcRule[] = ruleRows.map(toCalcRule);
  const { results } = computeProfit({ orders: calc, zones: await zoneCosts(shop), rules, adRows, facts, settings });

  const now = new Date();
  const byId = new Map(calc.map((c) => [c.id, c]));
  for (let i = 0; i < results.length; i += 200) {
    const chunk = results.slice(i, i + 200);
    const ids = chunk.map((r) => BigInt(r.orderId));
    await db.$transaction([
      db.orderCost.deleteMany({ where: { shop, orderId: { in: ids } } }),
      db.orderCost.createMany({
        data: chunk.flatMap((r) =>
          r.costs.map((c) => ({ shop, orderId: BigInt(r.orderId), type: c.type, label: c.label, amountCents: c.amountCents, source: c.source, refId: c.refId ?? null, note: c.note ?? null })),
        ),
      }),
      ...chunk.map((r) => {
        const c = byId.get(r.orderId)!;
        return db.order.update({
          where: { shop_id: { shop, id: BigInt(r.orderId) } },
          data: {
            revenueCents: r.revenueCents,
            cogsCents: r.cogsCents,
            shippingCents: r.shippingCents,
            feesCents: r.feesCents,
            adCents: r.adCents,
            otherCents: r.otherCents,
            profitCents: r.profitCents,
            missingCost: r.missingCost,
            adCampaignId: c.adCampaignId,
            adId: c.adId,
            computedAt: now,
          },
        });
      }),
      ...chunk.flatMap((r) =>
        byId.get(r.orderId)!.lines.map((l) =>
          db.orderLine.update({ where: { shop_id: { shop, id: BigInt(l.id) } }, data: { unitCostCents: l.unitCostCents } }),
        ),
      ),
    ]);
  }
  return results.length;
}
