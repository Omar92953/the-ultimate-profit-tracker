import { describe, expect, it } from "vitest";
import { computeProfit } from "../app/lib/profit/compute";
import { allocateAdSpend } from "../app/lib/profit/ads";
import type { CalcRule } from "../app/lib/profit/rules";
import type { AdRow, CalcOrder, ZoneCost } from "../app/lib/profit/types";
import { DEFAULT_SETTINGS, isCodGateway, type ShopSettings } from "../app/lib/settings";
import { allocate } from "../app/lib/money";

const settings: ShopSettings = { ...DEFAULT_SETTINGS, codFeePct: 1, codFeeCents: 0 };

function order(id: string, patch: Partial<CalcOrder> = {}): CalcOrder {
  return {
    id,
    name: `#${id}`,
    day: "2026-10-01",
    outcome: "delivered",
    isCod: false,
    gateways: ["manual"],
    channel: "web",
    countryCode: "EG",
    zoneId: "cairo",
    carrier: null,
    itemCount: 1,
    weightGrams: 500,
    isNewCustomer: true,
    adPlatform: null,
    adCampaignId: null,
    adId: null,
    grossSalesCents: 100000, // LE 1,000
    discountsCents: 0,
    returnsCents: 0,
    shippingChargedCents: 5000,
    shippingRefundCents: 0,
    taxesCents: 0,
    totalCents: 105000,
    shopifyFeesCents: null,
    lines: [{ id: `${id}-1`, productId: "p1", variantId: "v1", title: "Hoodie", quantity: 1, refundedQty: 0, unitPriceCents: 100000, discountCents: 0, unitCostCents: 40000 }],
    ...patch,
  };
}

const cairo: ZoneCost = { id: "cairo", label: "Egypt · Cairo", deliveryCents: 6000, perItemCents: 1000, perKgCents: null, returnCents: 4000, codFeePct: null, codFeeCents: null };
const zones = new Map([["cairo", cairo]]);
const facts = new Map([["p1", { tags: ["winter"], vendor: "Backrooms", productType: "Hoodie", collections: ["c1"] }]]);

const run = (orders: CalcOrder[], extra: { rules?: CalcRule[]; adRows?: AdRow[]; settings?: ShopSettings } = {}) =>
  computeProfit({ orders, zones, rules: extra.rules ?? [], adRows: extra.adRows ?? [], facts, settings: extra.settings ?? settings });

describe("money", () => {
  it("allocates without losing a cent", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1000);
    expect(allocate(500, [0, 0])).toEqual([250, 250]);
  });
  it("detects COD gateways without matching 'code'", () => {
    expect(isCodGateway(settings, ["Cash on Delivery (COD)"])).toBe(true);
    expect(isCodGateway(settings, ["COD"])).toBe(true);
    expect(isCodGateway(settings, ["Discount code gateway"])).toBe(false);
  });
});

describe("a delivered order", () => {
  it("has revenue, COGS, zone shipping and no fees", () => {
    const [r] = run([order("1")]).results;
    expect(r.revenueCents).toBe(105000);
    expect(r.cogsCents).toBe(40000);
    expect(r.shippingCents).toBe(6000);
    expect(r.feesCents).toBe(0);
    expect(r.profitCents).toBe(105000 - 40000 - 6000);
  });
  it("adds per-item shipping after the first item", () => {
    const [r] = run([order("1", { itemCount: 3 })]).results;
    expect(r.shippingCents).toBe(6000 + 2 * 1000);
  });
  it("flags missing COGS instead of counting it as zero cost silently", () => {
    const o = order("1");
    o.lines[0].unitCostCents = null;
    const [r] = run([o]).results;
    expect(r.missingCost).toBe(true);
    expect(r.cogsCents).toBe(0);
  });
  it("uses real Shopify fees when present, else the gateway rule", () => {
    expect(run([order("1", { shopifyFeesCents: 3200 })]).results[0].feesCents).toBe(3200);
    const withRule = { ...settings, gatewayFees: [{ gateway: "paymob", pct: 2.75, flatCents: 300 }] };
    const [r] = run([order("1", { gateways: ["Paymob"] })], { settings: withRule }).results;
    expect(r.feesCents).toBe(Math.round(105000 * 0.0275) + 300);
  });
});

describe("cash on delivery", () => {
  it("charges the COD collection fee on delivered orders", () => {
    const [r] = run([order("1", { isCod: true })]).results;
    expect(r.feesCents).toBe(1050); // 1% of 1,050
  });
  it("a refused COD order: revenue 0, goods back in stock, delivery + return shipping, no COD fee", () => {
    const [r] = run([order("1", { isCod: true, outcome: "returned" })]).results;
    expect(r.revenueCents).toBe(0);
    expect(r.cogsCents).toBe(0);
    expect(r.shippingCents).toBe(6000 + 4000);
    expect(r.feesCents).toBe(0);
    expect(r.profitCents).toBe(-10000);
  });
  it("a cancelled order costs nothing", () => {
    const [r] = run([order("1", { outcome: "cancelled" })]).results;
    expect(r.profitCents).toBe(0);
    expect(r.costs).toHaveLength(0);
  });
});

describe("refunds", () => {
  it("a partial refund removes the returned revenue and, if restocked, its cost", () => {
    const o = order("1", { returnsCents: 50000, grossSalesCents: 200000 });
    o.lines = [{ ...o.lines[0], quantity: 2, refundedQty: 1, unitPriceCents: 100000 }];
    const [r] = run([o]).results;
    expect(r.revenueCents).toBe(200000 - 50000 + 5000);
    expect(r.cogsCents).toBe(40000);
  });
});

describe("ad spend", () => {
  const rows: AdRow[] = [
    { platform: "meta", date: "2026-10-01", campaignId: "c1", campaignName: "Winter", adId: "a1", adName: "Hoodie video", spendShopCents: 30000 },
    { platform: "meta", date: "2026-10-01", campaignId: "c1", campaignName: "Winter", adId: "a2", adName: "Carousel", spendShopCents: 9000 },
  ];
  const orders = [
    order("1", { adPlatform: "meta", adCampaignId: "c1", adId: "a1" }),
    order("2", { adPlatform: "meta", adCampaignId: "c1", adId: "a1" }),
    order("3"),
    order("4"),
  ];
  it("attributed + spread: ad spend ÷ its orders, the rest over unclaimed orders, nothing lost", () => {
    const { perOrder, unallocatedCents } = allocateAdSpend(orders, rows, "attributed_spread");
    const cost = (id: string) => (perOrder.get(id) ?? []).reduce((s, l) => s + l.amountCents, 0);
    expect(cost("1")).toBe(15000);
    expect(cost("2")).toBe(15000);
    expect(cost("3")).toBe(4500);
    expect(cost("4")).toBe(4500);
    expect(unallocatedCents).toBe(0);
  });
  it("attributed only: unmatched spend is reported, not spread", () => {
    const { perOrder, unallocatedCents } = allocateAdSpend(orders, rows, "attributed_only");
    expect(perOrder.has("3")).toBe(false);
    expect(unallocatedCents).toBe(9000);
  });
  it("campaign-only orders get the campaign's unclaimed spend", () => {
    const o = [order("1", { adPlatform: "meta", adCampaignId: "c1" })];
    const { perOrder } = allocateAdSpend(o, rows, "attributed_spread");
    expect(perOrder.get("1")!.reduce((s, l) => s + l.amountCents, 0)).toBe(39000);
  });
  it("cancelled orders never carry ad cost", () => {
    const { perOrder } = allocateAdSpend([order("1", { outcome: "cancelled" }), order("2")], rows, "blended");
    expect(perOrder.has("1")).toBe(false);
    expect(perOrder.get("2")!.reduce((s, l) => s + l.amountCents, 0)).toBe(39000);
  });
  it("flows into profit", () => {
    const { results } = run(orders, { adRows: rows });
    expect(results.reduce((s, r) => s + r.adCents, 0)).toBe(39000);
  });
});

describe("extra cost rules", () => {
  const rule = (patch: Partial<CalcRule>): CalcRule => ({
    id: "r",
    name: "Rule",
    kind: "per_order",
    amount: 1000,
    period: null,
    distribute: null,
    startsOn: null,
    endsOn: null,
    filters: {},
    ...patch,
  });
  it("per order, filtered by payment method", () => {
    const { results } = run([order("1", { isCod: true }), order("2")], { rules: [rule({ filters: { payment: "cod" } })] });
    expect(results[0].otherCents).toBe(1000);
    expect(results[1].otherCents).toBe(0);
  });
  it("per item counts only the matching products", () => {
    const o = order("1");
    o.lines.push({ id: "1-2", productId: "p2", variantId: "v2", title: "Cap", quantity: 2, refundedQty: 0, unitPriceCents: 20000, discountCents: 0, unitCostCents: 5000 });
    const { results } = run([o], { rules: [rule({ kind: "per_item", amount: 300, filters: { tags: ["winter"] } })] });
    expect(results[0].otherCents).toBe(300);
  });
  it("% of revenue and % of gross profit", () => {
    const { results } = run([order("1")], { rules: [rule({ kind: "pct_revenue", amount: 5 }), rule({ id: "r2", kind: "pct_gross_profit", amount: 10 })] });
    expect(results[0].otherCents).toBe(Math.round(105000 * 0.05) + Math.round((105000 - 40000) * 0.1));
  });
  it("a monthly amount is spread over that month's matching orders only", () => {
    const orders = [order("1"), order("2"), order("3", { day: "2026-11-02" })];
    const { results } = run(orders, { rules: [rule({ kind: "period_amount", amount: 300000, period: "monthly", distribute: "even" })] });
    expect(results.map((r) => r.otherCents)).toEqual([150000, 150000, 300000]);
  });
  it("respects start and end dates", () => {
    const { results } = run([order("1")], { rules: [rule({ startsOn: "2026-10-02" })] });
    expect(results[0].otherCents).toBe(0);
  });
  it("can target zones, ads and new customers", () => {
    const o = [order("1", { adPlatform: "tiktok", adId: "t1", isNewCustomer: false }), order("2", { zoneId: "alex" })];
    const { results } = run(o, {
      rules: [rule({ id: "a", filters: { adPlatforms: ["tiktok"] } }), rule({ id: "b", amount: 500, filters: { zoneIds: ["alex"] } }), rule({ id: "c", amount: 7, filters: { customer: "new" } })],
    });
    expect(results[0].otherCents).toBe(1000);
    expect(results[1].otherCents).toBe(500 + 7);
  });
});
