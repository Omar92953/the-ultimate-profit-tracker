import type { ShopSettings } from "../settings";
import { allocateAdSpend } from "./ads";
import { orderCogs, orderFees, orderRevenue, orderShipping } from "./order";
import { applyRules, type CalcRule } from "./rules";
import type { AdRow, CalcOrder, CostLine, OrderResult, ProductFacts, ZoneCost } from "./types";

export type ComputeInput = {
  orders: CalcOrder[];
  zones: Map<string, ZoneCost>;
  rules: CalcRule[];
  adRows: AdRow[];
  facts: ProductFacts;
  settings: ShopSettings;
};

export type ComputeOutput = {
  results: OrderResult[];
  /** Ad spend per day that no order carried. */
  unallocatedAdCents: Map<string, number>;
};

const sum = (lines: CostLine[], types: CostLine["type"][]) =>
  lines.filter((l) => types.includes(l.type)).reduce((s, l) => s + l.amountCents, 0);

/** Profit for a batch of orders. Give it whole days (ads) and whole periods (period rules). */
export function computeProfit(input: ComputeInput): ComputeOutput {
  const { orders, zones, rules, adRows, facts, settings } = input;
  const base = new Map<string, { revenue: number; lines: CostLine[]; missing: boolean }>();
  const revenue = new Map<string, number>();
  const cogs = new Map<string, number>();

  for (const o of orders) {
    const zone = o.zoneId ? (zones.get(o.zoneId) ?? null) : null;
    const rev = orderRevenue(o, settings);
    const c = orderCogs(o, settings);
    const lines = [...c.lines, ...orderShipping(o, zone), ...orderFees(o, zone, settings)];
    base.set(o.id, { revenue: rev, lines, missing: c.missing });
    revenue.set(o.id, rev);
    cogs.set(o.id, sum(c.lines, ["cogs"]));
  }

  // Ads: one day at a time, since platforms report daily.
  const unallocatedAdCents = new Map<string, number>();
  const ordersByDay = new Map<string, CalcOrder[]>();
  for (const o of orders) ordersByDay.set(o.day, [...(ordersByDay.get(o.day) ?? []), o]);
  const rowsByDay = new Map<string, AdRow[]>();
  for (const r of adRows) rowsByDay.set(r.date, [...(rowsByDay.get(r.date) ?? []), r]);
  const adLines = new Map<string, CostLine[]>();
  for (const [day, rows] of rowsByDay) {
    const { perOrder, unallocatedCents } = allocateAdSpend(ordersByDay.get(day) ?? [], rows, settings.adCostModel);
    for (const [id, lines] of perOrder) adLines.set(id, [...(adLines.get(id) ?? []), ...lines]);
    if (unallocatedCents) unallocatedAdCents.set(day, unallocatedCents);
  }

  const ruleLines = applyRules(orders, rules, facts, { revenue, cogs });

  const results: OrderResult[] = orders.map((o) => {
    const b = base.get(o.id)!;
    const costs = [...b.lines, ...(adLines.get(o.id) ?? []), ...(ruleLines.get(o.id) ?? [])];
    const total = costs.reduce((s, l) => s + l.amountCents, 0);
    return {
      orderId: o.id,
      revenueCents: b.revenue,
      costs,
      cogsCents: sum(costs, ["cogs"]),
      shippingCents: sum(costs, ["shipping", "return_shipping"]),
      feesCents: sum(costs, ["payment_fee", "cod_fee"]),
      adCents: sum(costs, ["ad"]),
      otherCents: sum(costs, ["rule"]),
      profitCents: b.revenue - total,
      missingCost: b.missing,
    };
  });
  return { results, unallocatedAdCents };
}
