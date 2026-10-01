/** Per-shop settings, stored as JSON on Shop.settings. Shared by the server and the UI. */
import type { AdIds } from "./ads/guides";

export type GatewayFee = { gateway: string; pct: number; flatCents: number };

export type ShopSettings = {
  /** Count taxes as revenue (off: taxes are passed on to the government). */
  includeTaxes: boolean;
  /** Count the shipping the customer paid as revenue. */
  includeShippingRevenue: boolean;
  excludeTestOrders: boolean;
  /** Payment gateway names that mean cash on delivery (matched case-insensitively, "contains"). */
  codGateways: string[];
  /** Default COD collection fee when a zone has none. */
  codFeePct: number;
  codFeeCents: number;
  /** Order tags that mean "refused / returned" (common for COD stores that tag instead of refunding). */
  returnedTags: string[];
  /** A returned COD order's revenue counts as 0 (the customer never paid). */
  returnedCodZeroRevenue: boolean;
  /** Refunded units go back to stock, so their cost is not a loss. */
  refundedItemsRestocked: boolean;
  /** Fee rules for gateways that Shopify doesn't report real fees for. */
  gatewayFees: GatewayFee[];
  /** Days a click can lead to an order and still be credited to the ad. */
  attributionWindowDays: number;
  /** How ad spend reaches orders. */
  adCostModel: "attributed_spread" | "attributed_only" | "blended";
  /** The merchant's own account ids, so guide links open their logged-in ad accounts. */
  adIds: AdIds;
  /** Guide steps the merchant ticked as done. */
  guideDone: string[];
};

export const DEFAULT_SETTINGS: ShopSettings = {
  includeTaxes: false,
  includeShippingRevenue: true,
  excludeTestOrders: true,
  codGateways: ["cash on delivery", "cod", "الدفع عند الاستلام"],
  codFeePct: 0,
  codFeeCents: 0,
  returnedTags: ["returned", "refused", "rto", "مرتجع"],
  returnedCodZeroRevenue: true,
  refundedItemsRestocked: true,
  gatewayFees: [],
  attributionWindowDays: 7,
  adCostModel: "attributed_spread",
  adIds: {},
  guideDone: [],
};

export function readSettings(raw: unknown): ShopSettings {
  const value = raw && typeof raw === "object" ? (raw as Partial<ShopSettings>) : {};
  return { ...DEFAULT_SETTINGS, ...value };
}

export function isCodGateway(settings: ShopSettings, gateways: string[]): boolean {
  const names = gateways.map((g) => g.toLowerCase());
  return settings.codGateways.some((cod) => {
    const needle = cod.toLowerCase().trim();
    if (!needle) return false;
    // "cod" alone would match "Code"; require it as a whole word.
    if (needle.length <= 3) return names.some((n) => new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(n));
    return names.some((n) => n.includes(needle));
  });
}
