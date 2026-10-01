import type { ActionFunctionArgs } from "react-router";
import { verify } from "../lib/crypto.server";
import { googleRowsToAdDays, type GoogleRow } from "../lib/ads/google";
import { saveAdDays } from "../lib/ads/store.server";
import { enqueueRecompute } from "../lib/jobs.server";
import db from "../db.server";

/** POST from the merchant's Google Ads Script. The key in the URL says which shop it is for. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const key = new URL(request.url).searchParams.get("key");
  const claim = verify<{ shop: string; p: string }>(key);
  if (!claim || claim.p !== "google") return Response.json({ error: "Invalid key" }, { status: 401 });
  const shop = await db.shop.findUnique({ where: { id: claim.shop } });
  if (!shop || shop.uninstalledAt) return Response.json({ error: "Store not found" }, { status: 404 });
  const body = (await request.json()) as { account?: string; rows?: GoogleRow[] };
  const rows = googleRowsToAdDays(body.rows ?? []);
  const accountId = String(body.account ?? "google");
  await db.adAccount.upsert({
    where: { shop_platform_externalId: { shop: shop.id, platform: "google", externalId: accountId } },
    create: { shop: shop.id, platform: "google", externalId: accountId, name: `Google Ads ${accountId}`, currency: rows[0]?.currency ?? null, status: "active", lastSyncedAt: new Date() },
    update: { lastSyncedAt: new Date(), lastError: null, currency: rows[0]?.currency ?? undefined },
  });
  const result = await saveAdDays(shop.id, "google", accountId, rows, shop.currency);
  if (result.from && result.to) await enqueueRecompute(shop.id, result.from, result.to);
  return Response.json({ ok: true, saved: result.saved });
};
