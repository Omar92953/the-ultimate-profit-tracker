/** Plain data the profit engine works on. No Prisma or Shopify types, so it's easy to test. */

export type Outcome = "open" | "delivered" | "returned" | "cancelled";

export type CalcLine = {
  id: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  quantity: number;
  refundedQty: number;
  unitPriceCents: number;
  discountCents: number;
  unitCostCents: number | null;
};

export type ZoneCost = {
  id: string;
  label: string;
  deliveryCents: number | null;
  perItemCents: number | null;
  perKgCents: number | null;
  returnCents: number | null;
  codFeePct: number | null;
  codFeeCents: number | null;
};

export type CalcOrder = {
  id: string;
  name: string;
  day: string; // YYYY-MM-DD in the shop's timezone
  outcome: Outcome;
  isCod: boolean;
  gateways: string[];
  channel: string | null;
  countryCode: string | null;
  zoneId: string | null;
  carrier: string | null;
  itemCount: number;
  weightGrams: number;
  isNewCustomer: boolean | null;
  adPlatform: string | null;
  adCampaignId: string | null;
  adId: string | null;
  grossSalesCents: number;
  discountsCents: number;
  returnsCents: number;
  shippingChargedCents: number;
  shippingRefundCents: number;
  taxesCents: number;
  totalCents: number;
  shopifyFeesCents: number | null;
  lines: CalcLine[];
};

/** Catalog facts the rule filters need, keyed by product id. */
export type ProductFacts = Map<string, { tags: string[]; vendor: string | null; productType: string | null; collections: string[] }>;

export type CostLine = {
  type: "cogs" | "shipping" | "return_shipping" | "payment_fee" | "cod_fee" | "ad" | "rule";
  label: string;
  amountCents: number;
  source: string;
  refId?: string | null;
  note?: string | null;
};

export type OrderResult = {
  orderId: string;
  revenueCents: number;
  costs: CostLine[];
  cogsCents: number;
  shippingCents: number;
  feesCents: number;
  adCents: number;
  otherCents: number;
  profitCents: number;
  missingCost: boolean;
};

export type AdRow = {
  platform: string;
  date: string;
  campaignId: string;
  campaignName: string | null;
  adId: string;
  adName: string | null;
  spendShopCents: number;
};
