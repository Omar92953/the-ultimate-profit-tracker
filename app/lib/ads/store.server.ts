import db from "../../db.server";
import { rate } from "../fx.server";
import type { AdDay } from "./meta";

/**
 * Save daily ad rows (from an API sync or an uploaded report). Spend is converted to the shop
 * currency with that day's rate, and the rate is stored next to it. Same day + ad = replaced.
 */
export async function saveAdDays(shop: string, platform: string, accountId: string, rows: AdDay[], shopCurrency: string): Promise<{ saved: number; from: string | null; to: string | null }> {
  let from: string | null = null;
  let to: string | null = null;
  const rates = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.currency}|${r.date}`;
    if (!rates.has(key)) rates.set(key, await rate(r.currency, shopCurrency, r.date));
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await db.$transaction(
      chunk.map((r) => {
        const fx = rates.get(`${r.currency}|${r.date}`)!;
        const data = {
          shop,
          platform,
          accountId,
          date: new Date(`${r.date}T00:00:00Z`),
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          adSetId: r.adSetId,
          adSetName: r.adSetName,
          adId: r.adId,
          adName: r.adName,
          currency: r.currency,
          spendCents: r.spendCents,
          spendShopCents: Math.round(r.spendCents * fx),
          fxRate: fx,
          impressions: r.impressions,
          clicks: r.clicks,
          purchases: r.purchases,
          purchaseValueCents: Math.round(r.purchaseValueCents * fx),
          raw: r.raw as object,
        };
        return db.adInsightDaily.upsert({
          where: { shop_platform_date_adId: { shop, platform, date: data.date, adId: r.adId } },
          create: data,
          update: data,
        });
      }),
    );
  }
  for (const r of rows) {
    if (!from || r.date < from) from = r.date;
    if (!to || r.date > to) to = r.date;
  }
  return { saved: rows.length, from, to };
}
