import db from "../db.server";
import { zoneKey } from "./shopify/mapOrder";
import type { ZoneCost } from "./profit/types";

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function zoneLabel(country: string, province: string | null, city?: string | null): string {
  return [countryName(country), province || null, city || null].filter(Boolean).join(" · ");
}

/**
 * Detect zones from real orders (country + province), count orders per zone and link every
 * order to its most specific zone: a city zone (if the merchant split a province) beats the
 * province zone. New zones arrive unpriced so the merchant is prompted to enter real costs.
 */
export async function refreshZones(shop: string): Promise<{ created: number }> {
  const groups = await db.order.groupBy({
    by: ["countryCode", "province"],
    where: { shop, countryCode: { not: null } },
    _count: { _all: true },
  });
  let created = 0;
  for (const g of groups) {
    const key = zoneKey(g.countryCode, g.province)!;
    const existing = await db.shippingZone.findUnique({ where: { shop_key: { shop, key } } });
    if (!existing) created++;
    await db.shippingZone.upsert({
      where: { shop_key: { shop, key } },
      create: { shop, key, countryCode: g.countryCode!, province: g.province, label: zoneLabel(g.countryCode!, g.province), orderCount: g._count._all },
      update: { orderCount: g._count._all },
    });
  }
  await linkOrdersToZones(shop);
  return { created };
}

export async function linkOrdersToZones(shop: string): Promise<void> {
  // Province zones first, then city zones overwrite the orders they cover.
  await db.$executeRaw`
    UPDATE "Order" o SET "zoneId" = z.id
    FROM "ShippingZone" z
    WHERE o.shop = ${shop} AND z.shop = ${shop} AND z.city IS NULL
      AND z."countryCode" = o."countryCode" AND COALESCE(z.province, '') = COALESCE(o.province, '')`;
  await db.$executeRaw`
    UPDATE "Order" o SET "zoneId" = z.id
    FROM "ShippingZone" z
    WHERE o.shop = ${shop} AND z.shop = ${shop} AND z.city IS NOT NULL
      AND z."countryCode" = o."countryCode" AND COALESCE(z.province, '') = COALESCE(o.province, '')
      AND lower(trim(o.city)) = z.city`;
  const cities = await db.shippingZone.findMany({ where: { shop, city: { not: null } } });
  for (const z of cities) {
    const n = await db.order.count({ where: { shop, zoneId: z.id } });
    if (n !== z.orderCount) await db.shippingZone.update({ where: { id: z.id }, data: { orderCount: n } });
  }
}

/** Cities seen in a province's orders, for "split this province by city". */
export async function citiesIn(shop: string, countryCode: string, province: string | null) {
  const rows = await db.order.groupBy({
    by: ["city"],
    where: { shop, countryCode, province, city: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { city: "desc" } },
    take: 100,
  });
  return rows.map((r) => ({ city: r.city!, orders: r._count._all }));
}

export async function zoneCosts(shop: string): Promise<Map<string, ZoneCost>> {
  const zones = await db.shippingZone.findMany({ where: { shop } });
  return new Map(
    zones.map((z) => [
      z.id,
      {
        id: z.id,
        label: z.label,
        deliveryCents: z.deliveryCents,
        perItemCents: z.perItemCents,
        perKgCents: z.perKgCents,
        returnCents: z.returnCents,
        codFeePct: z.codFeePct === null ? null : Number(z.codFeePct),
        codFeeCents: z.codFeeCents,
      },
    ]),
  );
}
