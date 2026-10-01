/* eslint-disable @typescript-eslint/no-explicit-any -- bulk JSONL rows are untyped Admin API JSON */
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { gql } from "./admin.server";
import { enqueue, enqueueRecompute, QUEUES } from "./jobs.server";
import { gidToNumber, toCents } from "./money";
import { readSettings } from "./settings";
import { BULK_RUN, BULK_STATUS, CATALOG_BULK, ORDER_QUERY, ORDERS_BULK, bulkText } from "./shopify/queries";
import { mapOrder, type MappedOrder, type ShopifyLine, type ShopifyOrder } from "./shopify/mapOrder";
import { refreshZones } from "./zones.server";

const BATCH = 200;

async function admin(shop: string) {
  return (await unauthenticated.admin(shop)).admin;
}

export async function startCatalogBulk(shop: string): Promise<void> {
  await runBulk(shop, "catalog", bulkText(CATALOG_BULK));
}

export async function startOrdersBulk(shop: string): Promise<void> {
  await runBulk(shop, "orders", bulkText(ORDERS_BULK));
}

async function runBulk(shop: string, kind: "catalog" | "orders", query: string): Promise<void> {
  const data = await gql(await admin(shop), BULK_RUN, { query });
  const id = data.bulkOperationRunQuery.bulkOperation.id as string;
  await db.shop.update({ where: { id: shop }, data: { importStatus: "running", importKind: kind, importBulkId: id } });
  // The bulk_operations/finish webhook normally wakes us; this poll is the safety net.
  await enqueue(QUEUES.bulkFinished, { shop, id }, { startAfter: 60, singletonKey: `poll:${id}` });
}

/** Called by the webhook and by the poll. Safe to call twice: only the current bulk id is processed. */
export async function handleBulkFinished(shop: string, id: string): Promise<void> {
  const row = await db.shop.findUnique({ where: { id: shop } });
  if (!row || row.importBulkId !== id || row.importStatus !== "running") return;
  const data = await gql(await admin(shop), BULK_STATUS, { id });
  const op = data.node;
  if (!op) return;
  if (op.status === "RUNNING" || op.status === "CREATED") {
    await enqueue(QUEUES.bulkFinished, { shop, id }, { startAfter: 30, singletonKey: `poll:${id}:${Date.now()}` });
    return;
  }
  if (op.status !== "COMPLETED") {
    await db.shop.update({ where: { id: shop }, data: { importStatus: "failed", importError: `Shopify export ${op.status}${op.errorCode ? ` (${op.errorCode})` : ""}` } });
    return;
  }
  // Claim it so a duplicate webhook/poll doesn't process the file twice.
  const claimed = await db.shop.updateMany({ where: { id: shop, importBulkId: id }, data: { importBulkId: null } });
  if (!claimed.count) return;

  const url: string | null = op.url ?? op.partialDataUrl ?? null;
  if (row.importKind === "catalog") {
    if (url) await importCatalogFile(shop, url);
    await startOrdersBulk(shop);
  } else {
    const stats = url ? await importOrdersFile(shop, url) : { orders: 0, oldest: null as Date | null };
    await refreshZones(shop);
    await db.shop.update({
      where: { id: shop },
      data: { importStatus: "done", importKind: null, importedAt: new Date(), historyFrom: stats.oldest },
    });
    const from = (stats.oldest ?? new Date()).toISOString().slice(0, 10);
    await enqueueRecompute(shop, from, new Date().toISOString().slice(0, 10));
  }
}

async function* jsonl(url: string): AsyncGenerator<any> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download Shopify export (${res.status})`);
  const rl = createInterface({ input: Readable.fromWeb(res.body as unknown as NodeReadableStream), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

const typeOf = (gid: string) => gid.split("/")[3];

// ---------------- catalog ----------------

async function importCatalogFile(shop: string, url: string): Promise<void> {
  type P = { id: bigint; title: string; vendor: string | null; productType: string | null; tags: string[]; collections: bigint[] };
  type V = { id: bigint; productId: bigint; title: string | null; sku: string | null; inventoryItemId: bigint | null; cost: number | null; weight: number | null };
  let products: P[] = [];
  let variants: V[] = [];
  const byId = new Map<string, P>();

  const flush = async () => {
    await writeCatalog(shop, products, variants);
    products = [];
    variants = [];
    byId.clear();
  };

  for await (const row of jsonl(url)) {
    const kind = typeOf(row.id);
    if (kind === "Product") {
      if (products.length >= BATCH) await flush();
      const p: P = { id: gidToNumber(row.id)!, title: row.title, vendor: row.vendor ?? null, productType: row.productType ?? null, tags: row.tags ?? [], collections: [] };
      products.push(p);
      byId.set(row.id, p);
    } else if (kind === "Collection") {
      byId.get(row.__parentId)?.collections.push(gidToNumber(row.id)!);
    } else if (kind === "ProductVariant") {
      const inv = row.inventoryItem;
      const w = inv?.measurement?.weight;
      variants.push({
        id: gidToNumber(row.id)!,
        productId: gidToNumber(row.__parentId)!,
        title: row.title ?? null,
        sku: row.sku ?? null,
        inventoryItemId: gidToNumber(inv?.id),
        cost: inv?.unitCost?.amount != null ? toCents(inv.unitCost.amount) : null,
        weight: w ? toGrams(w.value, w.unit) : null,
      });
    }
  }
  await flush();
}

export function toGrams(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value == null) return null;
  const factor: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 };
  return Math.round(value * (factor[unit ?? "GRAMS"] ?? 1));
}

async function writeCatalog(
  shop: string,
  products: { id: bigint; title: string; vendor: string | null; productType: string | null; tags: string[]; collections: bigint[] }[],
  variants: { id: bigint; productId: bigint; title: string | null; sku: string | null; inventoryItemId: bigint | null; cost: number | null; weight: number | null }[],
): Promise<void> {
  if (!products.length && !variants.length) return;
  await db.$transaction(
    products.map((p) =>
      db.product.upsert({
        where: { shop_id: { shop, id: p.id } },
        create: { shop, ...p },
        update: { title: p.title, vendor: p.vendor, productType: p.productType, tags: p.tags, collections: p.collections },
      }),
    ),
  );
  await db.$transaction(
    variants.map((v) =>
      db.variant.upsert({
        where: { shop_id: { shop, id: v.id } },
        create: { shop, id: v.id, productId: v.productId, title: v.title, sku: v.sku, inventoryItemId: v.inventoryItemId, shopifyCostCents: v.cost, weightGrams: v.weight },
        update: { productId: v.productId, title: v.title, sku: v.sku, inventoryItemId: v.inventoryItemId, shopifyCostCents: v.cost, weightGrams: v.weight },
      }),
    ),
  );
  for (const v of variants) if (v.cost !== null) await recordShopifyCost(shop, v.id, v.cost);
}

/**
 * Keep cost history: the first cost we ever see applies to all past orders; a later change
 * applies from now on. Manual costs entered in the app win over Shopify's (newer row wins).
 */
export async function recordShopifyCost(shop: string, variantId: bigint, costCents: number): Promise<boolean> {
  const latest = await db.variantCost.findFirst({ where: { shop, variantId }, orderBy: { effectiveFrom: "desc" } });
  if (latest && latest.costCents === costCents) return false;
  if (latest && latest.source !== "shopify") return false; // the merchant set it in the app
  await db.variantCost.create({
    data: { shop, variantId, costCents, source: "shopify", effectiveFrom: latest ? new Date() : new Date(0) },
  });
  return true;
}

// ---------------- orders ----------------

async function importOrdersFile(shop: string, url: string): Promise<{ orders: number; oldest: Date | null }> {
  const row = await db.shop.findUniqueOrThrow({ where: { id: shop } });
  const settings = readSettings(row.settings);
  let current: { order: ShopifyOrder; lines: ShopifyLine[] } | null = null;
  let batch: MappedOrder[] = [];
  let count = 0;
  let oldest: Date | null = null;

  const finish = () => {
    if (!current) return;
    const mapped = mapOrder(shop, row.timezone, current.order, current.lines, settings);
    batch.push(mapped);
    count++;
    if (!oldest || mapped.order.processedAt < oldest) oldest = mapped.order.processedAt;
    current = null;
  };

  for await (const item of jsonl(url)) {
    const kind = typeOf(item.id);
    if (kind === "Order") {
      finish();
      if (batch.length >= BATCH) {
        await writeOrders(batch);
        batch = [];
      }
      current = { order: item, lines: [] };
    } else if (kind === "LineItem" && current && item.__parentId === current.order.id) {
      current.lines.push(item);
    }
  }
  finish();
  await writeOrders(batch);
  return { orders: count, oldest };
}

export async function writeOrders(batch: MappedOrder[]): Promise<void> {
  if (!batch.length) return;
  const shop = batch[0].order.shop;
  const ids = batch.map((b) => b.order.id);
  await db.$transaction([
    ...batch.map(({ order }) => {
      const { shop: s, id, ...data } = order;
      return db.order.upsert({ where: { shop_id: { shop: s, id } }, create: order, update: data });
    }),
    db.orderLine.deleteMany({ where: { shop, orderId: { in: ids } } }),
    db.orderLine.createMany({ data: batch.flatMap((b) => b.lines), skipDuplicates: true }),
  ]);
}

/** Webhook path: fetch one order fresh from Shopify and store it. Returns its day for recompute. */
export async function syncOrder(shop: string, orderGid: string): Promise<string | null> {
  const row = await db.shop.findUnique({ where: { id: shop } });
  if (!row) return null;
  const data = await gql(await admin(shop), ORDER_QUERY, { id: orderGid });
  const o = data.order as (ShopifyOrder & { lineItems: { edges: { node: ShopifyLine }[] } }) | null;
  if (!o) {
    await deleteOrder(shop, orderGid);
    return null;
  }
  const mapped = mapOrder(shop, row.timezone, o, o.lineItems.edges.map((e) => e.node), readSettings(row.settings));
  await writeOrders([mapped]);
  return mapped.order.day.toISOString().slice(0, 10);
}

export async function deleteOrder(shop: string, orderGid: string): Promise<void> {
  const id = gidToNumber(orderGid);
  if (id === null) return;
  await db.order.deleteMany({ where: { shop, id } });
}
