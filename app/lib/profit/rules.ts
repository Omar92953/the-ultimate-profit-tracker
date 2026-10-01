import { allocate } from "../money";
import type { CalcLine, CalcOrder, CostLine, ProductFacts } from "./types";

/**
 * Extra cost rules: "what" (kind + amount), "when" (dates / period) and "applies to" (filters).
 * Every filter is optional; an empty filter list means "any". All set filters must match.
 */
export type RuleFilters = {
  // Product filters also narrow *which items* count for per-item and %-of-revenue rules.
  productIds?: string[];
  collectionIds?: string[];
  tags?: string[];
  vendors?: string[];
  productTypes?: string[];
  // Order filters.
  zoneIds?: string[];
  countryCodes?: string[];
  carriers?: string[];
  payment?: "cod" | "online";
  channels?: string[];
  adPlatforms?: string[];
  adCampaignIds?: string[];
  adIds?: string[];
  customer?: "new" | "returning";
  outcomes?: string[];
};

export type RuleKind = "per_order" | "per_item" | "pct_revenue" | "pct_gross_profit" | "period_amount";

export type CalcRule = {
  id: string;
  name: string;
  kind: RuleKind;
  /** Cents for money kinds, percent for pct kinds. */
  amount: number;
  period: "daily" | "weekly" | "monthly" | null;
  distribute: "even" | "revenue" | "items" | null;
  startsOn: string | null; // YYYY-MM-DD
  endsOn: string | null;
  filters: RuleFilters;
};

const has = (list?: unknown[]) => !!list && list.length > 0;
const lower = (list?: string[]) => (list ?? []).map((s) => s.toLowerCase());

export function hasProductFilter(f: RuleFilters): boolean {
  return has(f.productIds) || has(f.collectionIds) || has(f.tags) || has(f.vendors) || has(f.productTypes);
}

export function lineMatches(line: CalcLine, f: RuleFilters, facts: ProductFacts): boolean {
  if (!hasProductFilter(f)) return true;
  if (!line.productId) return false;
  const p = facts.get(line.productId);
  if (has(f.productIds) && !f.productIds!.includes(line.productId)) return false;
  if (!p) return !has(f.collectionIds) && !has(f.tags) && !has(f.vendors) && !has(f.productTypes);
  if (has(f.collectionIds) && !p.collections.some((c) => f.collectionIds!.includes(c))) return false;
  if (has(f.tags)) {
    const tags = lower(p.tags);
    if (!lower(f.tags).some((t) => tags.includes(t))) return false;
  }
  if (has(f.vendors) && !lower(f.vendors).includes((p.vendor ?? "").toLowerCase())) return false;
  if (has(f.productTypes) && !lower(f.productTypes).includes((p.productType ?? "").toLowerCase())) return false;
  return true;
}

export function orderMatches(order: CalcOrder, f: RuleFilters, facts: ProductFacts): boolean {
  if (has(f.zoneIds) && !(order.zoneId && f.zoneIds!.includes(order.zoneId))) return false;
  if (has(f.countryCodes) && !(order.countryCode && f.countryCodes!.includes(order.countryCode))) return false;
  if (has(f.carriers) && !lower(f.carriers).includes((order.carrier ?? "").toLowerCase())) return false;
  if (f.payment === "cod" && !order.isCod) return false;
  if (f.payment === "online" && order.isCod) return false;
  if (has(f.channels) && !lower(f.channels).includes((order.channel ?? "").toLowerCase())) return false;
  if (has(f.adPlatforms) && !(order.adPlatform && f.adPlatforms!.includes(order.adPlatform))) return false;
  if (has(f.adCampaignIds) && !(order.adCampaignId && f.adCampaignIds!.includes(order.adCampaignId))) return false;
  if (has(f.adIds) && !(order.adId && f.adIds!.includes(order.adId))) return false;
  if (f.customer === "new" && order.isNewCustomer !== true) return false;
  if (f.customer === "returning" && order.isNewCustomer !== false) return false;
  if (has(f.outcomes) && !f.outcomes!.includes(order.outcome)) return false;
  if (hasProductFilter(f) && !order.lines.some((l) => lineMatches(l, f, facts))) return false;
  return true;
}

export function ruleActiveOn(rule: CalcRule, day: string): boolean {
  if (rule.startsOn && day < rule.startsOn) return false;
  if (rule.endsOn && day > rule.endsOn) return false;
  return true;
}

/** The period bucket a day falls into, e.g. "2026-10" for monthly. */
export function periodKey(day: string, period: CalcRule["period"]): string {
  if (period === "monthly") return day.slice(0, 7);
  if (period === "weekly") {
    const d = new Date(`${day}T00:00:00Z`);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return day;
}

type Ctx = { revenue: Map<string, number>; cogs: Map<string, number> };

function matchedItems(order: CalcOrder, f: RuleFilters, facts: ProductFacts): number {
  return order.lines.filter((l) => lineMatches(l, f, facts)).reduce((s, l) => s + Math.max(0, l.quantity - l.refundedQty), 0);
}

function matchedRevenue(order: CalcOrder, f: RuleFilters, facts: ProductFacts, orderRevenue: number): number {
  if (!hasProductFilter(f)) return orderRevenue;
  const all = order.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity - l.discountCents, 0);
  if (all <= 0) return 0;
  const part = order.lines.filter((l) => lineMatches(l, f, facts)).reduce((s, l) => s + l.unitPriceCents * l.quantity - l.discountCents, 0);
  return Math.round((orderRevenue * part) / all);
}

/**
 * Apply every rule to the given orders. For period rules, `orders` must contain every order of
 * each affected period (the recompute job loads whole months for this reason).
 */
export function applyRules(orders: CalcOrder[], rules: CalcRule[], facts: ProductFacts, ctx: Ctx): Map<string, CostLine[]> {
  const out = new Map<string, CostLine[]>();
  const push = (id: string, line: CostLine) => {
    if (!line.amountCents) return;
    const list = out.get(id) ?? [];
    list.push(line);
    out.set(id, list);
  };
  const live = orders.filter((o) => o.outcome !== "cancelled");

  for (const rule of rules) {
    const matching = live.filter((o) => ruleActiveOn(rule, o.day) && orderMatches(o, rule.filters, facts));
    if (rule.kind === "period_amount") {
      const buckets = new Map<string, CalcOrder[]>();
      for (const o of matching) {
        const key = periodKey(o.day, rule.period ?? "monthly");
        buckets.set(key, [...(buckets.get(key) ?? []), o]);
      }
      for (const [key, group] of buckets) {
        const weights = group.map((o) =>
          rule.distribute === "revenue" ? Math.max(0, ctx.revenue.get(o.id) ?? 0) : rule.distribute === "items" ? matchedItems(o, rule.filters, facts) : 1,
        );
        const parts = allocate(Math.round(rule.amount), weights);
        group.forEach((o, i) => push(o.id, { type: "rule", label: rule.name, amountCents: parts[i], source: "rule", refId: rule.id, note: `${key} total ÷ ${group.length} orders` }));
      }
      continue;
    }
    for (const o of matching) {
      const revenue = ctx.revenue.get(o.id) ?? 0;
      let amount = 0;
      let note: string | null = null;
      if (rule.kind === "per_order") amount = Math.round(rule.amount);
      else if (rule.kind === "per_item") {
        const n = matchedItems(o, rule.filters, facts);
        amount = Math.round(rule.amount * n);
        note = `${n} item(s)`;
      } else if (rule.kind === "pct_revenue") {
        amount = Math.round((matchedRevenue(o, rule.filters, facts, revenue) * rule.amount) / 100);
        note = `${rule.amount}% of revenue`;
      } else if (rule.kind === "pct_gross_profit") {
        const gp = revenue - (ctx.cogs.get(o.id) ?? 0);
        amount = gp > 0 ? Math.round((gp * rule.amount) / 100) : 0;
        note = `${rule.amount}% of gross profit`;
      }
      push(o.id, { type: "rule", label: rule.name, amountCents: amount, source: "rule", refId: rule.id, note });
    }
  }
  return out;
}

/** Ready-made rules the builder offers. Amounts are examples the merchant edits. */
export const RULE_TEMPLATES: { id: string; name: string; kind: RuleKind; amount: number; period?: CalcRule["period"]; distribute?: CalcRule["distribute"]; filters?: RuleFilters; hint: string }[] = [
  { id: "fulfillment", name: "Fulfilment fee", kind: "per_order", amount: 1000, hint: "Warehouse / 3PL pick & pack per order" },
  { id: "packaging", name: "Packaging", kind: "per_item", amount: 300, hint: "Box, bag or wrapping per item" },
  { id: "returns_handling", name: "Returns handling", kind: "per_order", amount: 1500, filters: { outcomes: ["returned"] }, hint: "Extra cost on refused / returned orders" },
  { id: "apps", name: "Apps & software", kind: "period_amount", amount: 300000, period: "monthly", distribute: "even", hint: "Monthly subscriptions spread over the month's orders" },
  { id: "salaries", name: "Salaries", kind: "period_amount", amount: 1000000, period: "monthly", distribute: "revenue", hint: "Team costs spread by order value" },
  { id: "influencer", name: "Influencer payment", kind: "period_amount", amount: 500000, period: "monthly", distribute: "even", hint: "Assign to the campaign or products it promoted" },
  { id: "royalty", name: "Royalty / commission", kind: "pct_revenue", amount: 5, hint: "A % of sales, e.g. for licensed or consigned products" },
];
