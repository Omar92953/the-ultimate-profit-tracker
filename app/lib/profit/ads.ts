import { allocate } from "../money";
import type { AdRow, CalcOrder, CostLine } from "./types";

export type AdModel = "attributed_spread" | "attributed_only" | "blended";

export type AdAllocation = {
  perOrder: Map<string, CostLine[]>;
  /** Spend that no order could carry (no orders that day, or "attributed only"). */
  unallocatedCents: number;
};

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok" };
const platformName = (p: string) => PLATFORM_LABEL[p] ?? p;

/**
 * Spread one day's ad spend over that day's orders.
 *
 * attributed_spread (default):
 *  1. An ad's spend is split equally over the orders attributed to that ad.
 *  2. Spend of ads without orders falls back to orders attributed to the same campaign
 *     (when the order only knows the campaign).
 *  3. Whatever is left is split equally over the day's orders that no ad claimed,
 *     so every unit of spend lands on an order: each order carries its own cost per purchase.
 * attributed_only: steps 1–2; the rest is reported as unallocated.
 * blended: all spend split equally over all orders.
 *
 * Cancelled orders never carry ad cost. Refused COD orders do: the ad did produce them.
 */
export function allocateAdSpend(orders: CalcOrder[], rows: AdRow[], model: AdModel): AdAllocation {
  const perOrder = new Map<string, CostLine[]>();
  const push = (orderId: string, line: CostLine) => {
    const list = perOrder.get(orderId) ?? [];
    list.push(line);
    perOrder.set(orderId, list);
  };
  const eligible = orders.filter((o) => o.outcome !== "cancelled");
  const total = rows.reduce((s, r) => s + r.spendShopCents, 0);
  if (!total) return { perOrder, unallocatedCents: 0 };

  if (model === "blended") {
    if (!eligible.length) return { perOrder, unallocatedCents: total };
    const parts = allocate(total, eligible.map(() => 1));
    eligible.forEach((o, i) => parts[i] && push(o.id, { type: "ad", label: "Ad spend (blended)", amountCents: parts[i], source: "blended" }));
    return { perOrder, unallocatedCents: 0 };
  }

  const claimed = new Set<string>();
  let leftover = 0;
  const leftoverByPlatform = new Map<string, number>();

  // 1. Ad level.
  const campaignLeft = new Map<string, { platform: string; name: string | null; cents: number }>();
  for (const row of rows) {
    const matched = eligible.filter((o) => o.adPlatform === row.platform && o.adId === row.adId);
    if (matched.length) {
      const parts = allocate(row.spendShopCents, matched.map(() => 1));
      matched.forEach((o, i) => {
        claimed.add(o.id);
        if (parts[i]) push(o.id, { type: "ad", label: `${platformName(row.platform)} · ${row.adName ?? row.adId}`, amountCents: parts[i], source: row.platform, refId: row.adId, note: matched.length > 1 ? `Ad spend ÷ ${matched.length} orders` : null });
      });
    } else {
      const key = `${row.platform}|${row.campaignId}`;
      const c = campaignLeft.get(key) ?? { platform: row.platform, name: row.campaignName, cents: 0 };
      c.cents += row.spendShopCents;
      campaignLeft.set(key, c);
    }
  }

  // 2. Campaign level, for orders that only know their campaign.
  for (const [key, c] of campaignLeft) {
    const campaignId = key.split("|")[1];
    const matched = eligible.filter((o) => !claimed.has(o.id) && o.adPlatform === c.platform && o.adCampaignId === campaignId && !o.adId);
    if (!matched.length) {
      leftover += c.cents;
      leftoverByPlatform.set(c.platform, (leftoverByPlatform.get(c.platform) ?? 0) + c.cents);
      continue;
    }
    const parts = allocate(c.cents, matched.map(() => 1));
    matched.forEach((o, i) => {
      claimed.add(o.id);
      if (parts[i]) push(o.id, { type: "ad", label: `${platformName(c.platform)} · ${c.name ?? campaignId}`, amountCents: parts[i], source: c.platform, refId: campaignId, note: "Campaign spend (order had no ad id)" });
    });
  }

  if (model === "attributed_only" || !leftover) return { perOrder, unallocatedCents: model === "attributed_only" ? leftover : 0 };

  // 3. Spread the rest over orders no ad claimed (or, failing that, over every order).
  let targets = eligible.filter((o) => !claimed.has(o.id));
  if (!targets.length) targets = eligible;
  if (!targets.length) return { perOrder, unallocatedCents: leftover };
  for (const [platform, cents] of leftoverByPlatform) {
    const parts = allocate(cents, targets.map(() => 1));
    targets.forEach((o, i) => parts[i] && push(o.id, { type: "ad", label: `${platformName(platform)} · unattributed spend`, amountCents: parts[i], source: "spread", refId: platform, note: `Spend no order could be matched to, ÷ ${targets.length} orders` }));
  }
  return { perOrder, unallocatedCents: 0 };
}
