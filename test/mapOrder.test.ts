import { describe, expect, it } from "vitest";
import { dayIn, mapOrder, readAttribution, readOutcome, zoneKey, type ShopifyOrder } from "../app/lib/shopify/mapOrder";
import { DEFAULT_SETTINGS } from "../app/lib/settings";

const money = (amount: string) => ({ shopMoney: { amount } });

const base: ShopifyOrder = {
  id: "gid://shopify/Order/5001",
  name: "#1001",
  createdAt: "2026-09-30T22:30:00Z",
  processedAt: "2026-09-30T22:30:00Z",
  tags: [],
  paymentGatewayNames: ["Cash on Delivery (COD)"],
  displayFinancialStatus: "PENDING",
  totalWeight: "750",
  customer: { id: "gid://shopify/Customer/9" },
  shippingAddress: { countryCodeV2: "EG", province: "Cairo", provinceCode: "C", city: "Nasr City", zip: null },
  totalDiscountsSet: money("100.00"),
  totalShippingPriceSet: money("50.00"),
  totalTaxSet: money("0.00"),
  totalPriceSet: money("950.00"),
  totalRefundedSet: money("0.00"),
  totalRefundedShippingSet: money("0.00"),
  fulfillments: [],
  transactions: [],
  customerJourneySummary: null,
};

const lines = [
  {
    id: "gid://shopify/LineItem/1",
    quantity: 2,
    currentQuantity: 2,
    title: "Hoodie",
    product: { id: "gid://shopify/Product/11" },
    variant: { id: "gid://shopify/ProductVariant/111" },
    originalUnitPriceSet: money("500.00"),
    totalDiscountSet: money("100.00"),
  },
];

describe("attribution", () => {
  it("reads Meta ids from the recommended URL parameters", () => {
    const a = readAttribution({
      lastVisit: {
        landingPage: "https://shop.com/products/x?utm_source=facebook&utm_medium=paid&utm_campaign=120200000001&utm_content=120200000099&utm_term=120200000055&fbclid=abc",
        utmParameters: { source: "facebook", medium: "paid", campaign: "120200000001", content: "120200000099", term: "120200000055" },
      },
    });
    expect(a).toMatchObject({ adPlatform: "meta", adCampaignId: "120200000001", adSetId: "120200000055", adId: "120200000099", fbclid: "abc", attribution: "utm" });
  });
  it("detects TikTok from ttclid alone and keeps names for later matching", () => {
    const a = readAttribution({ lastVisit: { landingPage: "/?ttclid=zz&utm_campaign=Winter%20Sale" } });
    expect(a.adPlatform).toBe("tiktok");
    expect(a.adCampaignId).toBeNull();
    expect(a.utmCampaign).toBe("Winter Sale");
    expect(a.attribution).toBe("utm");
  });
  it("detects Google from gclid; organic visits have no platform", () => {
    expect(readAttribution({ lastVisit: { landingPage: "/?gclid=1" } }).adPlatform).toBe("google");
    expect(readAttribution({ lastVisit: { landingPage: "/", referrerUrl: "https://google.com" } })).toMatchObject({ adPlatform: null, attribution: "none" });
  });
});

describe("outcome", () => {
  it("open until shipped; COD delivered once paid", () => {
    expect(readOutcome(base, true, DEFAULT_SETTINGS)).toBe("open");
    expect(readOutcome({ ...base, fulfillments: [{ status: "SUCCESS", displayStatus: "IN_TRANSIT" }] }, true, DEFAULT_SETTINGS)).toBe("open");
    expect(readOutcome({ ...base, displayFinancialStatus: "PAID", fulfillments: [{ status: "SUCCESS", displayStatus: "FULFILLED" }] }, true, DEFAULT_SETTINGS)).toBe("delivered");
  });
  it("refused COD orders count as returned (tag, courier status, or cancelled after shipping)", () => {
    expect(readOutcome({ ...base, tags: ["Refused"] }, true, DEFAULT_SETTINGS)).toBe("returned");
    expect(readOutcome({ ...base, fulfillments: [{ status: "SUCCESS", displayStatus: "NOT_DELIVERED" }] }, true, DEFAULT_SETTINGS)).toBe("returned");
    expect(readOutcome({ ...base, cancelledAt: "2026-10-03T00:00:00Z", fulfillments: [{ status: "SUCCESS", displayStatus: "FULFILLED" }] }, true, DEFAULT_SETTINGS)).toBe("returned");
  });
  it("cancelled before shipping is cancelled", () => {
    expect(readOutcome({ ...base, cancelledAt: "2026-10-01T00:00:00Z" }, true, DEFAULT_SETTINGS)).toBe("cancelled");
  });
});

describe("mapOrder", () => {
  it("maps money, zone fields, the shop-timezone day and a hashed customer", () => {
    const { order, lines: mapped } = mapOrder("s.myshopify.com", "Africa/Cairo", base, lines, DEFAULT_SETTINGS);
    expect(order.id).toBe(5001n);
    expect(order.day.toISOString().slice(0, 10)).toBe("2026-10-01"); // 22:30 UTC is 01:30 in Cairo
    expect(order.isCod).toBe(true);
    expect(order.grossSalesCents).toBe(100000);
    expect(order.discountsCents).toBe(10000);
    expect(order.shippingChargedCents).toBe(5000);
    expect(order.itemCount).toBe(2);
    expect(order.weightGrams).toBe(750);
    expect(order.customerHash).toHaveLength(32);
    expect(order.customerHash).not.toContain("9");
    expect(mapped[0]).toMatchObject({ productId: 11n, variantId: 111n, unitPriceCents: 50000, refundedQty: 0 });
  });
  it("computes returned value from refunded quantities, net of the line discount", () => {
    const { order } = mapOrder("s", "UTC", base, [{ ...lines[0], currentQuantity: 1 }], DEFAULT_SETTINGS);
    expect(order.returnsCents).toBe(50000 - 5000);
  });
  it("builds zone keys and days safely", () => {
    expect(zoneKey("eg", "Cairo")).toBe("EG|Cairo");
    expect(zoneKey("EG", "Cairo", "Nasr City")).toBe("EG|Cairo|nasr city");
    expect(zoneKey(null, "x")).toBeNull();
    expect(dayIn("Not/AZone", "2026-10-01T10:00:00Z")).toBe("2026-10-01");
  });
});
