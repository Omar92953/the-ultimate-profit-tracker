import { describe, expect, it } from "vitest";
import { detectPlatform, guessMapping, parseCsv, readReport, toDay } from "../app/lib/ads/report";
import { parseMetaInsight } from "../app/lib/ads/meta";

const META_EN = `Reporting starts,Reporting ends,Campaign name,Ad set name,Ad name,Day,Amount spent (USD),Impressions,Link clicks,Purchases,Purchases conversion value,Cost per purchase
2026-09-20,2026-09-21,Winter Sale,Broad 25-45,Hoodie video,2026-09-20,12.50,3400,51,2,118.00,6.25
2026-09-20,2026-09-21,Winter Sale,Broad 25-45,Hoodie video,2026-09-21,"1,010.00",3100,40,1,59.00,10
2026-09-20,2026-09-21,Winter Sale,Broad 25-45,Hoodie video,2026-09-21,5.00,100,2,0,0,
,,Total,,,,1027.50,6600,93,3,177.00,`;

const META_AR_NO_DAY = `بداية التقارير,نهاية التقارير,اسم الحملة,اسم مجموعة الإعلانات,اسم الإعلان,المبلغ الذي تم إنفاقه (EGP),مرات الظهور,عمليات الشراء,قيمة تحويل عمليات الشراء
2026-09-01,2026-09-03,حملة الشتاء,الكل,فيديو,300,3000,3,1500`;

const GOOGLE = `Day,Campaign,Ad group,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value
2026-09-20,Search - Brand,Brand terms,USD,4.20,800,60,1.00,59.00`;

const TIKTOK = `By Day,Campaign name,Ad group name,Ad name,Cost,Impressions,Clicks (destination),Complete payment,Total complete payment value
2026-09-20,TT Winter,Interest,UGC 1,8.00,5000,70,1,59`;

describe("reading exported ad reports", () => {
  it("Meta English export with a Day breakdown: maps every column, adds split rows, skips the total", () => {
    const table = parseCsv(META_EN);
    const map = guessMapping(table[0]);
    expect(map).toMatchObject({ start: 0, end: 1, campaign: 2, adSet: 3, ad: 4, date: 5, spend: 6, impressions: 7, clicks: 8, purchases: 9, purchaseValue: 10 });
    expect(detectPlatform(table[0])).toBe("meta");
    const r = readReport(table, map, "EGP");
    expect(r.rows).toHaveLength(2);
    const day21 = r.rows.find((x) => x.date === "2026-09-21")!;
    expect(day21.spendCents).toBe(101000 + 500);
    expect(day21.currency).toBe("USD"); // from "Amount spent (USD)"
    expect(day21.adId).toBe("name:Winter Sale/Hoodie video");
    expect(r.rows.find((x) => x.date === "2026-09-20")!.purchaseValueCents).toBe(11800);
  });

  it("Meta Arabic export without a day column: spreads the period evenly", () => {
    const table = parseCsv(META_AR_NO_DAY);
    const r = readReport(table, guessMapping(table[0]), "USD");
    expect(r.rows.map((x) => x.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(r.rows.every((x) => x.spendCents === 10000 && x.currency === "EGP")).toBe(true);
    expect(r.spreadRows).toBe(1);
  });

  it("Google Ads and TikTok exports", () => {
    const g = parseCsv(GOOGLE);
    expect(detectPlatform(g[0])).toBe("google");
    const gr = readReport(g, guessMapping(g[0]), "EGP");
    expect(gr.rows[0]).toMatchObject({ date: "2026-09-20", spendCents: 420, currency: "USD", impressions: 800, clicks: 60, purchases: 1, purchaseValueCents: 5900, adSetName: "Brand terms" });

    const t = parseCsv(TIKTOK);
    expect(detectPlatform(t[0])).toBe("tiktok");
    const tr = readReport(t, guessMapping(t[0]), "USD");
    expect(tr.rows[0]).toMatchObject({ date: "2026-09-20", spendCents: 800, purchases: 1, purchaseValueCents: 5900, adName: "UGC 1" });
  });

  it("explains what's missing instead of guessing", () => {
    const table = parseCsv("Campaign name,Impressions\nA,10");
    expect(readReport(table, guessMapping(table[0]), "USD").missing).toEqual(["spend", "date"]);
  });

  it("understands common date formats (day first when ambiguous)", () => {
    expect(toDay("2026-09-21")).toBe("2026-09-21");
    expect(toDay("21/09/2026")).toBe("2026-09-21");
    expect(toDay("09/21/2026")).toBe("2026-09-21");
    expect(toDay("05/09/2026")).toBe("2026-09-05");
    expect(toDay("Sep 21, 2026")).toBe("2026-09-21");
  });
});

describe("Meta API insights", () => {
  it("takes one purchase type only (no double counting) and converts money to cents", () => {
    const day = parseMetaInsight(
      {
        date_start: "2026-09-20",
        campaign_id: "1",
        ad_id: "9",
        ad_name: "Video",
        spend: "12.34",
        impressions: "1000",
        clicks: "20",
        account_currency: "USD",
        actions: [
          { action_type: "purchase", value: "2" },
          { action_type: "omni_purchase", value: "3" },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        ],
        action_values: [{ action_type: "omni_purchase", value: "150.5" }],
      },
      "EGP",
    );
    expect(day).toMatchObject({ adId: "9", spendCents: 1234, purchases: 3, purchaseValueCents: 15050, currency: "USD", impressions: 1000 });
  });
});
