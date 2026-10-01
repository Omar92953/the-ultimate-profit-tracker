import type { ShopSettings } from "../settings";
import type { CalcOrder, CostLine, ZoneCost } from "./types";

/** Revenue the store keeps from an order, per the shop's settings. */
export function orderRevenue(order: CalcOrder, settings: ShopSettings): number {
  if (order.outcome === "cancelled") return 0;
  if (order.outcome === "returned" && order.isCod && settings.returnedCodZeroRevenue) return 0;
  let revenue = order.grossSalesCents - order.discountsCents - order.returnsCents;
  if (settings.includeShippingRevenue) revenue += order.shippingChargedCents - order.shippingRefundCents;
  if (settings.includeTaxes) revenue += order.taxesCents;
  return revenue;
}

/** Cost of the goods that stayed sold. Refused/returned goods come back to stock. */
export function orderCogs(order: CalcOrder, settings: ShopSettings): { lines: CostLine[]; missing: boolean } {
  if (order.outcome === "cancelled") return { lines: [], missing: false };
  const returnedToStock = order.outcome === "returned" && settings.refundedItemsRestocked;
  let missing = false;
  const lines: CostLine[] = [];
  for (const line of order.lines) {
    const kept = returnedToStock ? 0 : line.quantity - (settings.refundedItemsRestocked ? line.refundedQty : 0);
    if (kept <= 0) continue;
    if (line.unitCostCents === null) {
      missing = true;
      continue;
    }
    lines.push({
      type: "cogs",
      label: `${line.title} × ${kept}`,
      amountCents: kept * line.unitCostCents,
      source: "variant",
      refId: line.variantId,
    });
  }
  return { lines, missing };
}

/** What the courier really charges, from the merchant's zone prices (not what Shopify charged). */
export function orderShipping(order: CalcOrder, zone: ZoneCost | null): CostLine[] {
  if (order.outcome === "cancelled" || !zone || zone.deliveryCents === null) return [];
  let cost = zone.deliveryCents;
  const notes: string[] = [];
  if (zone.perItemCents && order.itemCount > 1) {
    cost += zone.perItemCents * (order.itemCount - 1);
    notes.push(`+${order.itemCount - 1} extra item(s)`);
  }
  if (zone.perKgCents && order.weightGrams > 1000) {
    const extraKg = Math.ceil(order.weightGrams / 1000) - 1;
    cost += zone.perKgCents * extraKg;
    notes.push(`+${extraKg} extra kg`);
  }
  const lines: CostLine[] = [
    { type: "shipping", label: `Delivery · ${zone.label}`, amountCents: cost, source: "zone", refId: zone.id, note: notes.join(", ") || null },
  ];
  if (order.outcome === "returned" && zone.returnCents) {
    lines.push({ type: "return_shipping", label: `Return · ${zone.label}`, amountCents: zone.returnCents, source: "zone", refId: zone.id });
  }
  return lines;
}

/** Payment costs: real fees when Shopify reports them, COD collection fee, or the gateway's rule. */
export function orderFees(order: CalcOrder, zone: ZoneCost | null, settings: ShopSettings): CostLine[] {
  if (order.outcome === "cancelled") return [];
  if (order.shopifyFeesCents !== null && order.shopifyFeesCents > 0) {
    return [{ type: "payment_fee", label: "Payment fees", amountCents: order.shopifyFeesCents, source: "shopify" }];
  }
  if (order.isCod) {
    // A refused COD order is never collected, so there's no collection fee.
    if (order.outcome === "returned") return [];
    const pct = zone?.codFeePct ?? settings.codFeePct;
    const flat = zone?.codFeeCents ?? settings.codFeeCents;
    const amount = Math.round((order.totalCents * (pct || 0)) / 100) + (flat || 0);
    return amount > 0
      ? [{ type: "cod_fee", label: "COD collection fee", amountCents: amount, source: zone?.codFeePct != null || zone?.codFeeCents != null ? "zone" : "settings", refId: zone?.id ?? null }]
      : [];
  }
  const names = order.gateways.map((g) => g.toLowerCase());
  const rule = settings.gatewayFees.find((f) => names.some((n) => n.includes(f.gateway.toLowerCase())));
  if (!rule) return [];
  const amount = Math.round((order.totalCents * rule.pct) / 100) + rule.flatCents;
  return amount > 0 ? [{ type: "payment_fee", label: `${rule.gateway} fees`, amountCents: amount, source: "gateway" }] : [];
}
