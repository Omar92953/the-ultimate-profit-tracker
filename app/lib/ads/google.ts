/**
 * Google Ads, without a developer token: the merchant pastes a Google Ads Script that posts
 * their daily numbers to the app. This file builds the script and reads what it sends.
 */
import type { AdDay } from "./meta";

export type GoogleRow = {
  level: "ad" | "campaign";
  date: string;
  currency: string;
  campaignId: string;
  campaignName: string;
  adGroupId?: string;
  adGroupName?: string;
  adId?: string;
  adName?: string;
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionsValue: number;
};

/**
 * Ad-level rows where Google has them; campaign-level rows only for campaigns with no ads
 * (e.g. Performance Max), so nothing is counted twice.
 */
export function googleRowsToAdDays(rows: GoogleRow[]): AdDay[] {
  const withAds = new Set(rows.filter((r) => r.level === "ad").map((r) => `${r.date}|${r.campaignId}`));
  return rows
    .filter((r) => r.level === "ad" || !withAds.has(`${r.date}|${r.campaignId}`))
    .map((r) => ({
      date: r.date,
      campaignId: String(r.campaignId),
      campaignName: r.campaignName ?? null,
      adSetId: r.adGroupId ? String(r.adGroupId) : null,
      adSetName: r.adGroupName ?? null,
      adId: r.level === "ad" && r.adId ? String(r.adId) : `campaign:${r.campaignId}`,
      adName: r.adName || (r.level === "campaign" ? r.campaignName : null) || null,
      currency: r.currency || "USD",
      spendCents: Math.round((Number(r.costMicros) || 0) / 10_000),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      purchases: Number(r.conversions) || 0,
      purchaseValueCents: Math.round((Number(r.conversionsValue) || 0) * 100),
      raw: r as unknown as Record<string, unknown>,
    }));
}

/** The script the merchant pastes into Google Ads → Tools → Bulk actions → Scripts. */
export function googleAdsScript(endpoint: string): string {
  return `/**
 * Ultimate Profit Tracker — sends your Google Ads numbers to the app once a day.
 * Paste into Google Ads → Tools → Bulk actions → Scripts → (+), authorise, then set Frequency: Daily.
 * It only READS your account. Remove the script at any time to stop.
 */
var ENDPOINT = "${endpoint}";
var DAYS = 30; // how many past days to send each run (Google updates recent days for a while)

function main() {
  var since = Utilities.formatDate(new Date(Date.now() - DAYS * 86400000), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
  var until = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
  var currency = AdsApp.currentAccount().getCurrencyCode();
  var rows = [];
  var ads = AdsApp.search(
    "SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, " +
    "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value " +
    "FROM ad_group_ad WHERE segments.date BETWEEN '" + since + "' AND '" + until + "' AND metrics.impressions > 0");
  while (ads.hasNext()) {
    var r = ads.next();
    rows.push({ level: "ad", date: r.segments.date, currency: currency, campaignId: r.campaign.id, campaignName: r.campaign.name,
      adGroupId: r.adGroup.id, adGroupName: r.adGroup.name, adId: r.adGroupAd.ad.id, adName: r.adGroupAd.ad.name || "",
      costMicros: Number(r.metrics.costMicros), impressions: Number(r.metrics.impressions), clicks: Number(r.metrics.clicks),
      conversions: Number(r.metrics.conversions), conversionsValue: Number(r.metrics.conversionsValue) });
  }
  var campaigns = AdsApp.search(
    "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value " +
    "FROM campaign WHERE segments.date BETWEEN '" + since + "' AND '" + until + "' AND metrics.impressions > 0");
  while (campaigns.hasNext()) {
    var c = campaigns.next();
    rows.push({ level: "campaign", date: c.segments.date, currency: currency, campaignId: c.campaign.id, campaignName: c.campaign.name,
      costMicros: Number(c.metrics.costMicros), impressions: Number(c.metrics.impressions), clicks: Number(c.metrics.clicks),
      conversions: Number(c.metrics.conversions), conversionsValue: Number(c.metrics.conversionsValue) });
  }
  var res = UrlFetchApp.fetch(ENDPOINT, { method: "post", contentType: "application/json", payload: JSON.stringify({ account: AdsApp.currentAccount().getCustomerId(), rows: rows }), muteHttpExceptions: true });
  Logger.log("Sent " + rows.length + " rows: " + res.getResponseCode() + " " + res.getContentText());
}
`;
}
