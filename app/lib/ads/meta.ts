/**
 * Turning Meta Marketing API insight rows into the app's daily ad rows.
 * Pure (no network), so it's unit-tested. Network calls live in meta.server.ts.
 */
export type MetaInsight = {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  account_currency?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  [key: string]: unknown;
};

export type AdDay = {
  date: string;
  campaignId: string;
  campaignName: string | null;
  adSetId: string | null;
  adSetName: string | null;
  adId: string;
  adName: string | null;
  currency: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValueCents: number;
  raw: Record<string, unknown>;
};

/** Meta reports purchases under several names; take the first that exists (no double counting). */
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];

function pick(list: { action_type: string; value: string }[] | undefined): number {
  if (!list?.length) return 0;
  for (const type of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function parseMetaInsight(row: MetaInsight, fallbackCurrency: string): AdDay {
  const adId = row.ad_id ?? row.adset_id ?? row.campaign_id ?? "unknown";
  return {
    date: row.date_start,
    campaignId: row.campaign_id ?? "unknown",
    campaignName: row.campaign_name ?? null,
    adSetId: row.adset_id ?? null,
    adSetName: row.adset_name ?? null,
    adId,
    adName: row.ad_name ?? null,
    currency: row.account_currency ?? fallbackCurrency,
    spendCents: Math.round(Number(row.spend ?? 0) * 100),
    impressions: Number(row.impressions ?? 0) || 0,
    clicks: Number(row.clicks ?? 0) || 0,
    purchases: pick(row.actions),
    purchaseValueCents: Math.round(pick(row.action_values) * 100),
    raw: row,
  };
}

/** Every metric we ask for: what the app calculates with, plus useful extras kept in `raw`. */
export const META_INSIGHT_FIELDS = [
  "date_start",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "account_currency",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
].join(",");
