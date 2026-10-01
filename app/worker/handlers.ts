import { enqueueRecompute, getBoss, QUEUES } from "../lib/jobs.server";
import { handleBulkFinished, recordShopifyCost, startCatalogBulk, syncOrder } from "../lib/import.server";
import { recomputeRange } from "../lib/recompute.server";
import { refreshZones } from "../lib/zones.server";
import db from "../db.server";
import { syncAdAccounts } from "../lib/ads/sync.server";

type ShopJob = { shop: string };

/** Register every job handler on the queue. Used by the worker process and by dev's inline worker. */
export async function startWorkers(): Promise<void> {
  const boss = await getBoss();
  // Poll every 5s: fewer queries on the small database pool; webhooks are not time-critical.
  const opts = { pollingIntervalSeconds: 5 };

  await boss.work<ShopJob>(QUEUES.importCatalog, opts, async ([job]) => {
    await startCatalogBulk(job.data.shop);
  });

  await boss.work<ShopJob & { id: string }>(QUEUES.bulkFinished, opts, async ([job]) => {
    try {
      await handleBulkFinished(job.data.shop, job.data.id);
    } catch (e) {
      await db.shop.update({ where: { id: job.data.shop }, data: { importStatus: "failed", importError: e instanceof Error ? e.message : String(e) } });
      throw e;
    }
  });

  await boss.work<ShopJob & { orderId: string; deleted?: boolean }>(QUEUES.syncOrder, opts, async ([job]) => {
    const day = await syncOrder(job.data.shop, job.data.orderId);
    if (day) {
      await refreshZones(job.data.shop);
      await enqueueRecompute(job.data.shop, day, day);
    }
  });

  await boss.work<ShopJob & { from: string; to: string }>(QUEUES.recompute, { ...opts, batchSize: 1 }, async ([job]) => {
    const started = new Date();
    const log = await db.syncLog.create({ data: { shop: job.data.shop, kind: "recompute", status: "running", startedAt: started } });
    try {
      const stats = await recomputeRange(job.data.shop, job.data.from, job.data.to);
      await db.syncLog.update({ where: { id: log.id }, data: { status: "done", stats, finishedAt: new Date() } });
    } catch (e) {
      await db.syncLog.update({ where: { id: log.id }, data: { status: "failed", message: e instanceof Error ? e.message : String(e), finishedAt: new Date() } });
      throw e;
    }
  });

  await boss.work<ShopJob>(QUEUES.refreshZones, opts, async ([job]) => {
    await refreshZones(job.data.shop);
  });

  // inventory_items/update: a new unit cost applies from now on; recalculate today's orders.
  await boss.work<ShopJob & { inventoryItemId: string; cost: string | null }>(QUEUES.syncCost, opts, async ([job]) => {
    const { shop, inventoryItemId, cost } = job.data;
    if (cost === null || cost === undefined) return;
    const variant = await db.variant.findFirst({ where: { shop, inventoryItemId: BigInt(inventoryItemId) } });
    if (!variant) return;
    const cents = Math.round(Number(cost) * 100);
    await db.variant.update({ where: { shop_id: { shop, id: variant.id } }, data: { shopifyCostCents: cents } });
    if (await recordShopifyCost(shop, variant.id, cents)) {
      const today = new Date().toISOString().slice(0, 10);
      await enqueueRecompute(shop, today, today);
    }
  });

  await boss.work<{ shop?: string; accountId?: string }>(QUEUES.adsSync, opts, async ([job]) => {
    await syncAdAccounts(job.data.shop, job.data.accountId);
  });
  // Every 6 hours: refresh connected ad accounts.
  await boss.schedule(QUEUES.adsSync, "15 */6 * * *", {});
}
