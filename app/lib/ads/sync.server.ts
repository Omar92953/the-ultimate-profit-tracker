import db from "../../db.server";
import { addDays, todayIn } from "../dates";
import { enqueueRecompute } from "../jobs.server";
import { syncMetaAccount } from "./meta.server";

/**
 * Pull fresh numbers for every connected (API) ad account. Platforms keep revising recent days,
 * so each run re-reads the last 7 days; a first sync goes back as far as the store's orders (max 1 year).
 */
export async function syncAdAccounts(shop?: string, accountId?: string): Promise<void> {
  const accounts = await db.adAccount.findMany({
    where: { platform: "meta", status: "active", accessToken: { not: null }, ...(shop ? { shop } : {}), ...(accountId ? { id: accountId } : {}) },
  });
  for (const a of accounts) {
    const shopRow = await db.shop.findUnique({ where: { id: a.shop } });
    if (!shopRow || shopRow.uninstalledAt) continue;
    const today = todayIn(shopRow.timezone);
    const earliest = shopRow.historyFrom ? shopRow.historyFrom.toISOString().slice(0, 10) : addDays(today, -90);
    const from = a.lastSyncedAt ? addDays(today, -7) : earliest > addDays(today, -365) ? earliest : addDays(today, -365);
    try {
      const r = await syncMetaAccount(a.id, from, today);
      if (r.from && r.to) await enqueueRecompute(a.shop, r.from, r.to);
    } catch (e) {
      await db.adAccount.update({ where: { id: a.id }, data: { lastError: e instanceof Error ? e.message : String(e), status: /token|session|OAuth|expired/i.test(String(e)) ? "error" : a.status } });
    }
  }
}
