import db from "../db.server";
import { gql, type AdminClient } from "./admin.server";
import { SHOP_QUERY } from "./shopify/queries";
import { enqueue, QUEUES } from "./jobs.server";
import { readSettings, type ShopSettings } from "./settings";

/** Called after every install / re-auth: keep shop facts fresh and start the first import once. */
export async function onShopAuthenticated(admin: AdminClient, shop: string): Promise<void> {
  const data = await gql(admin, SHOP_QUERY);
  const info = data.shop;
  const existing = await db.shop.findUnique({ where: { id: shop } });
  await db.shop.upsert({
    where: { id: shop },
    create: {
      id: shop,
      name: info.name,
      currency: info.currencyCode,
      timezone: info.ianaTimezone || "UTC",
      moneyFormat: info.currencyFormats?.moneyFormat ?? null,
    },
    update: {
      name: info.name,
      currency: info.currencyCode,
      timezone: info.ianaTimezone || "UTC",
      moneyFormat: info.currencyFormats?.moneyFormat ?? null,
      uninstalledAt: null,
    },
  });

  // Every store starts as its own workspace (multi-store links are added from Settings).
  const workspace = await db.workspace.upsert({
    where: { ownerShop: shop },
    create: { ownerShop: shop, name: info.name, reportCurrency: info.currencyCode },
    update: {},
  });
  await db.workspaceStore.upsert({
    where: { workspaceId_shop: { workspaceId: workspace.id, shop } },
    create: { workspaceId: workspace.id, shop, label: info.name },
    update: { status: "active", revokedAt: null },
  });

  if (!existing || existing.importStatus === "idle" || existing.importStatus === "failed") {
    await startImport(shop);
  }
}

/** Catalog first (costs are needed to price orders), then orders. */
export async function startImport(shop: string): Promise<void> {
  await db.shop.update({ where: { id: shop }, data: { importStatus: "running", importKind: "catalog", importError: null } });
  await enqueue(QUEUES.importCatalog, { shop }, { singletonKey: `catalog:${shop}` });
}

export async function getShop(shop: string) {
  const row = await db.shop.findUnique({ where: { id: shop } });
  if (!row) throw new Response("Shop not set up yet", { status: 404 });
  return { ...row, settingsParsed: readSettings(row.settings) as ShopSettings };
}

export async function saveSettings(shop: string, patch: Partial<ShopSettings>): Promise<ShopSettings> {
  const row = await db.shop.findUniqueOrThrow({ where: { id: shop } });
  const next = { ...readSettings(row.settings), ...patch };
  await db.shop.update({ where: { id: shop }, data: { settings: next } });
  return next;
}
