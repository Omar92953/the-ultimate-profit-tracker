/** DEV ONLY: import an ad report CSV for a shop exactly like the Ads page upload does, then recalculate. */
import "../../app/env.server";
import { readFileSync } from "node:fs";
import db from "../../app/db.server";
import { detectPlatform, guessMapping, parseCsv, readReport } from "../../app/lib/ads/report";
import { saveAdDays } from "../../app/lib/ads/store.server";
import { recomputeRange } from "../../app/lib/recompute.server";

const [file, shopArg] = process.argv.slice(2);
const shop = await db.shop.findFirstOrThrow({ where: shopArg ? { id: shopArg } : {} });
const table = parseCsv(readFileSync(file, "utf8"));
const platform = detectPlatform(table[0], file);
const result = readReport(table, guessMapping(table[0]), shop.currency);
if (result.missing.length) throw new Error(`Missing columns: ${result.missing.join(", ")}`);
await db.adAccount.upsert({
  where: { shop_platform_externalId: { shop: shop.id, platform, externalId: `upload:${platform}` } },
  create: { shop: shop.id, platform, externalId: `upload:${platform}`, name: "Uploaded reports", status: "active", lastSyncedAt: new Date() },
  update: { lastSyncedAt: new Date() },
});
const saved = await saveAdDays(shop.id, platform, `upload:${platform}`, result.rows, shop.currency);
console.log(platform, saved);
if (saved.from && saved.to) console.log("recomputed", await recomputeRange(shop.id, saved.from, saved.to));
await db.$disconnect();
