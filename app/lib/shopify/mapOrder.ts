import { createHash } from "node:crypto";
import { gidToNumber, toCents } from "../money";
import { isCodGateway, type ShopSettings } from "../settings";
import type { Outcome } from "../profit/types";

/** Loose shape of an order as the Admin API returns it (ORDER_FIELDS + LINE_FIELDS). */
type Money = { shopMoney?: { amount?: string | null } | null } | null | undefined;
type Visit = {
  landingPage?: string | null;
  referrerUrl?: string | null;
  utmParameters?: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null } | null;
} | null;
export type ShopifyLine = {
  id: string;
  quantity: number;
  currentQuantity?: number | null;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  product?: { id: string } | null;
  variant?: { id: string } | null;
  originalUnitPriceSet?: Money;
  totalDiscountSet?: Money;
};
export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  test?: boolean;
  tags?: string[];
  sourceName?: string | null;
  paymentGatewayNames?: string[];
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  returnStatus?: string | null;
  totalWeight?: string | number | null;
  customer?: { id: string } | null;
  shippingAddress?: { countryCodeV2?: string | null; province?: string | null; provinceCode?: string | null; city?: string | null; zip?: string | null } | null;
  totalDiscountsSet?: Money;
  totalShippingPriceSet?: Money;
  totalTaxSet?: Money;
  totalPriceSet?: Money;
  totalRefundedSet?: Money;
  totalRefundedShippingSet?: Money;
  fulfillments?: { status?: string | null; displayStatus?: string | null; trackingInfo?: { company?: string | null }[] | null }[] | null;
  transactions?: { kind?: string | null; status?: string | null; gateway?: string | null; amountSet?: Money; fees?: { amount?: { amount?: string | null } | null }[] | null }[] | null;
  customerJourneySummary?: { customerOrderIndex?: number | null; lastVisit?: Visit; firstVisit?: Visit } | null;
  lineItems?: { edges?: { node: ShopifyLine }[] } | ShopifyLine[];
};

const m = (x: Money) => toCents(x?.shopMoney?.amount ?? 0);

export function dayIn(timezone: string, iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function hashCustomer(shop: string, customerGid: string | null | undefined): string | null {
  if (!customerGid) return null;
  return createHash("sha256").update(`${shop}:${customerGid}`).digest("hex").slice(0, 32);
}

const META = ["facebook", "fb", "instagram", "ig", "meta", "an", "messenger"];
const GOOGLE = ["google", "youtube", "adwords", "gads"];
const TIKTOK = ["tiktok", "tt"];

export type Attribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingPage: string | null;
  referrer: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  adPlatform: string | null;
  adCampaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  attribution: "utm" | "click_id" | "none";
};

const numericId = (v: string | null | undefined) => (v && /^\d{5,}$/.test(v.trim()) ? v.trim() : null);

/**
 * Who sent this order. Reads UTMs and click ids from the last visit (then the first).
 * Ad and campaign ids come from UTMs when the merchant uses the recommended URL parameters
 * (e.g. Meta: utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}});
 * campaign *names* are matched to ad data later, during the profit calculation.
 */
export function readAttribution(journey: ShopifyOrder["customerJourneySummary"]): Attribution {
  const visits = [journey?.lastVisit, journey?.firstVisit].filter(Boolean) as NonNullable<Visit>[];
  const pick = (f: (v: NonNullable<Visit>, q: URLSearchParams) => string | null | undefined) => {
    for (const v of visits) {
      const q = params(v.landingPage);
      const value = f(v, q);
      if (value) return value;
    }
    return null;
  };
  const utmSource = pick((v, q) => v.utmParameters?.source ?? q.get("utm_source"));
  const utmMedium = pick((v, q) => v.utmParameters?.medium ?? q.get("utm_medium"));
  const utmCampaign = pick((v, q) => v.utmParameters?.campaign ?? q.get("utm_campaign"));
  const utmContent = pick((v, q) => v.utmParameters?.content ?? q.get("utm_content"));
  const utmTerm = pick((v, q) => v.utmParameters?.term ?? q.get("utm_term"));
  const fbclid = pick((_, q) => q.get("fbclid"));
  const gclid = pick((_, q) => q.get("gclid") ?? q.get("gbraid") ?? q.get("wbraid"));
  const ttclid = pick((_, q) => q.get("ttclid"));
  const explicitCampaign = pick((_, q) => q.get("campaign_id") ?? q.get("utm_id") ?? q.get("campaignid"));
  const explicitAd = pick((_, q) => q.get("ad_id") ?? q.get("adid") ?? q.get("creative"));
  const explicitSet = pick((_, q) => q.get("adset_id") ?? q.get("adgroup_id") ?? q.get("adgroupid"));

  const source = (utmSource ?? "").toLowerCase();
  let adPlatform: string | null = null;
  if (fbclid || META.includes(source)) adPlatform = "meta";
  else if (ttclid || TIKTOK.includes(source)) adPlatform = "tiktok";
  else if (gclid || GOOGLE.includes(source)) adPlatform = "google";

  const paid = adPlatform !== null;
  return {
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    landingPage: visits[0]?.landingPage ?? null,
    referrer: visits[0]?.referrerUrl ?? null,
    fbclid,
    gclid,
    ttclid,
    adPlatform,
    adCampaignId: paid ? (numericId(explicitCampaign) ?? numericId(utmCampaign)) : null,
    adSetId: paid ? (numericId(explicitSet) ?? numericId(utmTerm)) : null,
    adId: paid ? (numericId(explicitAd) ?? numericId(utmContent)) : null,
    attribution: utmSource || utmCampaign || utmContent ? "utm" : fbclid || gclid || ttclid ? "click_id" : "none",
  };
}

function params(url: string | null | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  try {
    return new URL(url, "https://shop.example").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** Whether the order was delivered, refused/returned, cancelled or is still on its way. */
export function readOutcome(o: ShopifyOrder, isCod: boolean, settings: ShopSettings): Outcome {
  const tags = (o.tags ?? []).map((t) => t.toLowerCase().trim());
  const fulfillments = o.fulfillments ?? [];
  const shipped = fulfillments.some((f) => f.status === "SUCCESS" || !!f.displayStatus);
  const statuses = fulfillments.map((f) => f.displayStatus ?? "");
  const refundedAll = o.displayFinancialStatus === "REFUNDED";

  if (settings.returnedTags.some((t) => tags.includes(t.toLowerCase()))) return "returned";
  if (statuses.includes("NOT_DELIVERED") || statuses.includes("FAILURE")) return "returned";
  if (o.cancelledAt) return shipped ? "returned" : "cancelled";
  if (o.returnStatus === "RETURNED" && refundedAll) return "returned";
  if (isCod && shipped && refundedAll) return "returned";
  if (statuses.includes("DELIVERED")) return "delivered";
  if (shipped && !isCod) return "delivered";
  if (shipped && isCod && o.displayFinancialStatus === "PAID") return "delivered";
  return "open";
}

export function zoneKey(country: string | null | undefined, province: string | null | undefined, city?: string | null): string | null {
  if (!country) return null;
  return [country.toUpperCase(), (province ?? "").trim(), city ? city.trim().toLowerCase() : null].filter((x) => x !== null).join("|");
}

export type MappedOrder = ReturnType<typeof mapOrder>;

export function mapOrder(shop: string, timezone: string, o: ShopifyOrder, lines: ShopifyLine[], settings: ShopSettings) {
  const id = gidToNumber(o.id)!;
  const gateways = o.paymentGatewayNames ?? [];
  const isCod = isCodGateway(settings, gateways);
  const outcome = readOutcome(o, isCod, settings);
  const fees = (o.transactions ?? [])
    .filter((t) => t.status === "SUCCESS")
    .flatMap((t) => t.fees ?? [])
    .reduce((s, f) => s + toCents(f.amount?.amount ?? 0), 0);
  const carrier = (o.fulfillments ?? []).flatMap((f) => f.trackingInfo ?? []).find((t) => t.company)?.company ?? null;

  const mappedLines = lines.map((l) => {
    const unit = toCents(l.originalUnitPriceSet?.shopMoney?.amount ?? 0);
    const discount = toCents(l.totalDiscountSet?.shopMoney?.amount ?? 0);
    const current = l.currentQuantity ?? l.quantity;
    return {
      shop,
      id: gidToNumber(l.id)!,
      orderId: id,
      productId: gidToNumber(l.product?.id),
      variantId: gidToNumber(l.variant?.id),
      title: l.title,
      variantTitle: l.variantTitle ?? null,
      sku: l.sku ?? null,
      quantity: l.quantity,
      refundedQty: Math.max(0, l.quantity - current),
      unitPriceCents: unit,
      discountCents: discount,
    };
  });

  const gross = mappedLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const returns = mappedLines.reduce((s, l) => {
    if (!l.refundedQty || !l.quantity) return s;
    return s + Math.round(l.refundedQty * (l.unitPriceCents - l.discountCents / l.quantity));
  }, 0);
  const address = o.shippingAddress;

  return {
    order: {
      shop,
      id,
      name: o.name,
      createdAt: new Date(o.createdAt),
      processedAt: new Date(o.processedAt),
      day: new Date(`${dayIn(timezone, o.processedAt)}T00:00:00Z`),
      test: !!o.test,
      cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
      cancelReason: o.cancelReason ?? null,
      financialStatus: o.displayFinancialStatus ?? null,
      fulfillmentStatus: o.displayFulfillmentStatus ?? null,
      returnStatus: o.returnStatus ?? null,
      outcome,
      channel: o.sourceName ?? null,
      gateways,
      isCod,
      countryCode: address?.countryCodeV2 ?? null,
      province: address?.province ?? null,
      provinceCode: address?.provinceCode ?? null,
      city: address?.city ?? null,
      zip: address?.zip ?? null,
      carrier,
      weightGrams: Math.round(Number(o.totalWeight ?? 0)) || 0,
      itemCount: mappedLines.reduce((s, l) => s + l.quantity, 0),
      customerHash: hashCustomer(shop, o.customer?.id),
      customerOrderIndex: o.customerJourneySummary?.customerOrderIndex ?? null,
      grossSalesCents: gross,
      discountsCents: m(o.totalDiscountsSet),
      returnsCents: returns,
      shippingChargedCents: m(o.totalShippingPriceSet),
      shippingRefundCents: m(o.totalRefundedShippingSet),
      taxesCents: m(o.totalTaxSet),
      totalCents: m(o.totalPriceSet),
      refundedCents: m(o.totalRefundedSet),
      shopifyFeesCents: fees > 0 ? fees : null,
      ...readAttribution(o.customerJourneySummary),
    },
    lines: mappedLines,
  };
}
