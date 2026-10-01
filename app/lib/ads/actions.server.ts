import db from "../../db.server";
import { enqueue, enqueueRecompute, QUEUES } from "../jobs.server";
import { connectMetaWithToken } from "./meta.server";
import { detectPlatform, guessMapping, parseCsv, readReport, type Platform } from "./report";
import { saveAdDays } from "./store.server";

export type AdActionResult = { ok: boolean; message: string };

/** Upload of an exported ad report (Ads page and the step-by-step guides). */
export async function uploadAdReport(shop: string, csv: string, fileName: string, chosen: string): Promise<AdActionResult> {
  const shopRow = await db.shop.findUniqueOrThrow({ where: { id: shop } });
  const table = parseCsv(csv);
  if (table.length < 2) return { ok: false, message: "The file is empty. Export the report as CSV and try again." };
  const platform = (chosen && chosen !== "auto" ? chosen : detectPlatform(table[0], fileName)) as Platform;
  const result = readReport(table, guessMapping(table[0]), shopRow.currency);
  if (result.missing.length) {
    const names: Record<string, string> = { spend: "amount spent / cost", date: "day (or reporting starts/ends)", ad: "campaign or ad name" };
    return { ok: false, message: `This report has no ${result.missing.map((m) => names[m] ?? m).join(", ")} column. Follow the export step again.` };
  }
  const accountId = `upload:${platform}`;
  await db.adAccount.upsert({
    where: { shop_platform_externalId: { shop, platform, externalId: accountId } },
    create: { shop, platform, externalId: accountId, name: "Uploaded reports", status: "active", lastSyncedAt: new Date() },
    update: { lastSyncedAt: new Date() },
  });
  const saved = await saveAdDays(shop, platform, accountId, result.rows, shopRow.currency);
  if (saved.from && saved.to) await enqueueRecompute(shop, saved.from, saved.to);
  const spend = result.rows.reduce((s, r) => s + r.spendCents, 0) / 100;
  return {
    ok: true,
    message: `Imported ${saved.saved} ${platform} ad-day rows (${saved.from} → ${saved.to}), ${spend.toFixed(2)} ${result.rows[0]?.currency ?? ""} spend.${result.spreadRows ? " Some rows covered several days and were spread evenly; export by Day for exact numbers." : ""}`,
  };
}

export async function connectMetaKey(shop: string, token: string): Promise<AdActionResult> {
  const n = await connectMetaWithToken(shop, token);
  await enqueue(QUEUES.adsSync, { shop });
  return { ok: true, message: `Connected ${n} ad account(s). Importing your numbers now.` };
}
