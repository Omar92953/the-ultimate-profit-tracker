/**
 * Reading ad reports exported from Meta Ads Manager, TikTok Ads Manager or Google Ads (CSV).
 * Columns are found by name (English and Arabic), so the merchant never maps anything by hand
 * unless a column can't be found. Pure functions: unit-tested.
 */
import type { AdDay } from "./meta";

export type Platform = "meta" | "tiktok" | "google";
export type Field = "date" | "start" | "end" | "campaign" | "campaignId" | "adSet" | "adSetId" | "ad" | "adId" | "spend" | "impressions" | "clicks" | "purchases" | "purchaseValue" | "currency";

/** Lowercased header fragments per field, most specific first. */
const MATCHERS: Record<Field, string[]> = {
  date: ["day", "date", "اليوم", "التاريخ", "by day", "stat time"],
  start: ["reporting starts", "بداية التقارير", "start date"],
  end: ["reporting ends", "نهاية التقارير", "end date"],
  campaignId: ["campaign id", "معرف الحملة"],
  campaign: ["campaign name", "campaign", "اسم الحملة", "الحملة"],
  adSetId: ["ad set id", "ad group id", "adgroup id", "معرف مجموعة الإعلانات"],
  adSet: ["ad set name", "ad group name", "ad group", "adgroup name", "اسم مجموعة الإعلانات", "مجموعة الإعلانات"],
  adId: ["ad id", "معرف الإعلان"],
  ad: ["ad name", "اسم الإعلان", "الإعلان", "ad"],
  spend: ["amount spent", "cost", "spend", "total cost", "المبلغ الذي تم إنفاقه", "المبلغ المنفق", "التكلفة"],
  impressions: ["impressions", "impr.", "مرات الظهور"],
  clicks: ["link clicks", "clicks (all)", "clicks", "النقرات على الرابط", "النقرات"],
  purchases: ["purchases", "complete payment", "conversions", "عمليات الشراء", "التحويلات"],
  purchaseValue: ["purchases conversion value", "purchase value", "total complete payment value", "conv. value", "conversion value", "قيمة تحويل عمليات الشراء", "قيمة التحويل"],
  currency: ["currency", "العملة"],
};

/** Columns that must not be mistaken for each other ("ad" vs "ad set name", "clicks" vs "cost per click"). */
const EXCLUDE: Partial<Record<Field, string[]>> = {
  ad: ["ad set", "ad group", "adgroup", "ad id", "مجموعة"],
  adId: ["ad set id", "ad group id"],
  campaign: ["campaign id"],
  adSet: ["ad set id", "ad group id"],
  spend: ["per", "لكل", "budget"],
  clicks: ["per", "rate", "ctr", "cost", "لكل", "معدل"],
  purchases: ["value", "per", "cost", "rate", "قيمة", "لكل"],
  impressions: ["per", "cpm", "share", "لكل"],
  date: ["starts", "ends", "بداية", "نهاية"],
};

export type Mapping = Partial<Record<Field, number>>;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  const sep = detectSeparator(src);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function detectSeparator(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((s) => [s, first.split(s).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function guessMapping(headers: string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const used = new Set<number>();
  const mapping: Mapping = {};
  // Most specific fields first so e.g. "Purchases conversion value" isn't taken as "Purchases".
  const order: Field[] = ["purchaseValue", "campaignId", "adSetId", "adId", "start", "end", "date", "campaign", "adSet", "ad", "spend", "impressions", "clicks", "purchases", "currency"];
  for (const field of order) {
    for (const needle of MATCHERS[field]) {
      const idx = lower.findIndex((h, i) => !used.has(i) && (h === needle || h.startsWith(needle) || (needle.length > 3 && h.includes(needle))) && !(EXCLUDE[field] ?? []).some((x) => h.includes(x)));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export function detectPlatform(headers: string[], fileName = ""): Platform {
  const all = `${headers.join(" | ")} ${fileName}`.toLowerCase();
  if (all.includes("amount spent") || all.includes("reporting starts") || all.includes("ad set") || all.includes("المبلغ الذي تم إنفاقه") || all.includes("facebook") || all.includes("meta")) return "meta";
  if (all.includes("impr.") || all.includes("conv. value") || all.includes("currency code") || all.includes("google")) return "google";
  if (all.includes("complete payment") || all.includes("ad group name") || all.includes("tiktok")) return "tiktok";
  return "meta";
}

/** Currency from a header like "Amount spent (USD)" or "Cost (EGP)". */
export function currencyFromHeader(header: string | undefined): string | null {
  const m = header ? /\(([A-Z]{3})\)/.exec(header) : null;
  return m ? m[1] : null;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const cleaned = v.replace(/[^\d.,-]/g, "");
  // "1,234.56" or "1.234,56"
  const normalised = /,\d{1,2}$/.test(cleaned) && cleaned.includes(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Dates as YYYY-MM-DD from "2026-09-21", "21/09/2026", "09/21/2026", "Sep 21, 2026". */
export function toDay(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]; // ambiguous → day first (Egypt)
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // "Sep 21, 2026": Date.parse gives local midnight, so read local parts (toISOString would shift the day).
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export type ReportResult = { rows: AdDay[]; skipped: number; missing: Field[]; spreadRows: number };

/**
 * Turn report rows into daily ad rows. A row covering several days (no "Day" breakdown) is
 * spread evenly over those days. Without ad/campaign ids, names are used as ids (and are
 * matched to orders' UTM names during the profit calculation).
 */
export function readReport(table: string[][], mapping: Mapping, currency: string): ReportResult {
  const [headers, ...body] = table;
  const missing: Field[] = [];
  if (mapping.spend === undefined) missing.push("spend");
  if (mapping.date === undefined && mapping.start === undefined) missing.push("date");
  if (mapping.ad === undefined && mapping.adId === undefined && mapping.campaign === undefined && mapping.campaignId === undefined) missing.push("ad");
  if (missing.length) return { rows: [], skipped: body.length, missing, spreadRows: 0 };

  const cur = currencyFromHeader(headers[mapping.spend!]) ?? currency;
  const at = (row: string[], f: Field) => (mapping[f] === undefined ? undefined : row[mapping[f]!]?.trim());
  const rows: AdDay[] = [];
  let skipped = 0;
  let spreadRows = 0;
  for (const row of body) {
    const label = (at(row, "campaign") ?? "").toLowerCase();
    if (label === "total" || label === "الإجمالي" || label.startsWith("total ")) continue;
    const single = toDay(at(row, "date"));
    const start = toDay(at(row, "start")) ?? single;
    const end = toDay(at(row, "end")) ?? single ?? start;
    if (!start || !end) {
      skipped++;
      continue;
    }
    const days = single ? [single] : daysBetween(start, end);
    if (days.length > 1) spreadRows++;
    const campaignName = at(row, "campaign") || null;
    const adName = at(row, "ad") || null;
    const adSetName = at(row, "adSet") || null;
    const campaignId = at(row, "campaignId") || (campaignName ? `name:${campaignName}` : "unknown");
    const adId = at(row, "adId") || (adName ? `name:${campaignName ?? ""}/${adName}` : campaignId);
    const share = (v: number) => v / days.length;
    const spend = num(at(row, "spend"));
    const rowCurrency = at(row, "currency")?.toUpperCase() || cur;
    for (const date of days) {
      rows.push({
        date,
        campaignId,
        campaignName,
        adSetId: at(row, "adSetId") || (adSetName ? `name:${adSetName}` : null),
        adSetName,
        adId,
        adName,
        currency: /^[A-Z]{3}$/.test(rowCurrency) ? rowCurrency : cur,
        spendCents: Math.round(share(spend) * 100),
        impressions: Math.round(share(num(at(row, "impressions")))),
        clicks: Math.round(share(num(at(row, "clicks")))),
        purchases: share(num(at(row, "purchases"))),
        purchaseValueCents: Math.round(share(num(at(row, "purchaseValue"))) * 100),
        raw: Object.fromEntries(headers.map((h, i) => [h, row[i]])),
      });
    }
  }
  return { rows: mergeSameAdDay(rows), skipped, missing, spreadRows };
}

/** One row per ad per day: add up rows the export split (e.g. by placement or age). */
function mergeSameAdDay(rows: AdDay[]): AdDay[] {
  const byKey = new Map<string, AdDay>();
  for (const r of rows) {
    const key = `${r.date}|${r.adId}`;
    const e = byKey.get(key);
    if (!e) {
      byKey.set(key, { ...r });
      continue;
    }
    e.spendCents += r.spendCents;
    e.impressions += r.impressions;
    e.clicks += r.clicks;
    e.purchases += r.purchases;
    e.purchaseValueCents += r.purchaseValueCents;
  }
  return [...byKey.values()];
}
