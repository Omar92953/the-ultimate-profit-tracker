import "../../app/env.server";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL + "?connection_limit=1" } } });
const [sessions, shops, orders, products, variants, zones, logs] = await Promise.all([
  db.session.count(), db.shop.findMany({ select: { id: true, currency: true, timezone: true, importStatus: true, importKind: true, importError: true, uninstalledAt: true } }),
  db.order.count(), db.product.count(), db.variant.count(), db.shippingZone.count(), db.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 3, select: { kind: true, status: true, message: true } }),
]);
console.log(JSON.stringify({ sessions, shops, orders, products, variants, zones, logs }, null, 1));
await db.$disconnect();
