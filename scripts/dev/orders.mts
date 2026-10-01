import "../../app/env.server";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL + "?connection_limit=1" } } });
const orders = await db.order.findMany({ orderBy: { name: "asc" }, select: { name: true, day: true, outcome: true, isCod: true, gateways: true, province: true, zoneId: true, revenueCents: true, cogsCents: true, shippingCents: true, feesCents: true, adCents: true, profitCents: true, missingCost: true, computedAt: true, customerHash: true } });
for (const o of orders) console.log([o.name, o.day.toISOString().slice(0, 10), o.outcome, o.isCod ? "COD" : o.gateways.join("/"), o.province, o.zoneId ? "zone✓" : "no-zone", `rev ${o.revenueCents / 100}`, `cogs ${o.cogsCents / 100}`, `ship ${o.shippingCents / 100}`, `fees ${o.feesCents / 100}`, `ads ${(o as { adCents?: number }).adCents! / 100}`, `profit ${o.profitCents / 100}`, o.missingCost ? "missingCost" : "", o.computedAt ? "computed" : "NOT computed"].join(" | "));
console.log("zones:", (await db.shippingZone.findMany({ select: { label: true, orderCount: true, configured: true } })).map((z) => `${z.label} (${z.orderCount})`).join(", "));
await db.$disconnect();
