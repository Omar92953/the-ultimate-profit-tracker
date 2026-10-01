import "../env.server";
import { PgBoss } from "pg-boss";

/**
 * Background jobs on Postgres (pg-boss), so there's no Redis to run.
 * - Web process: only sends jobs.
 * - Worker process (`npm run worker`, a Render background worker in production) runs them.
 * - In development the web process also runs them (INLINE_WORKER), so `shopify app dev` is enough.
 */
export const QUEUES = {
  importCatalog: "import-catalog",
  importOrders: "import-orders",
  bulkFinished: "bulk-finished",
  syncOrder: "sync-order",
  recompute: "recompute",
  refreshZones: "refresh-zones",
  syncCost: "sync-cost",
  adsSync: "ads-sync",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

declare global {
  // eslint-disable-next-line no-var
  var profitBoss: Promise<PgBoss> | undefined;
}

function connectionString(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See docs/hosting.md.");
  return url;
}

export function getBoss(): Promise<PgBoss> {
  if (!global.profitBoss) {
    global.profitBoss = (async () => {
      // Small pool that survives a remote pooler (Supabase): keep-alive, recycle idle connections
      // before the pooler drops them, and wait longer for a free slot instead of failing.
      const boss = new PgBoss({
        connectionString: connectionString(),
        schema: "pgboss",
        max: 3,
        connectionTimeoutMillis: 30_000,
        ...({ keepAlive: true, idleTimeoutMillis: 10_000 } as object),
      });
      boss.on("error", (e) => console.error("[jobs]", e));
      await boss.start();
      for (const name of Object.values(QUEUES)) await boss.createQueue(name);
      return boss;
    })();
    global.profitBoss.catch(() => (global.profitBoss = undefined));
  }
  return global.profitBoss;
}

type SendOpts = { singletonKey?: string; startAfter?: number; retryLimit?: number };

/** Queue a job. A singletonKey collapses duplicates (e.g. many webhooks for one order). */
export async function enqueue(name: QueueName, data: object, opts: SendOpts = {}): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, data, { retryLimit: 3, retryDelay: 30, retryBackoff: true, ...opts });
}

/** Recalculate a shop's profit for a date range, debounced so a burst of webhooks runs once. */
export async function enqueueRecompute(shop: string, from: string, to: string): Promise<void> {
  const boss = await getBoss();
  await boss.sendDebounced(QUEUES.recompute, { shop, from, to }, { singletonKey: `${shop}:${from.slice(0, 7)}:${to.slice(0, 7)}` }, 20, shop);
}
