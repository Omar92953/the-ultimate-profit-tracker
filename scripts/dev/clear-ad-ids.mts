/** DEV ONLY: forget the linked ad account ids and guide progress for every dev shop. */
import "../../app/env.server";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL + "?connection_limit=1" } } });
for (const s of await db.shop.findMany()) {
  const settings = { ...(s.settings as object), adIds: {}, guideDone: [] };
  await db.shop.update({ where: { id: s.id }, data: { settings } });
  console.log("cleared", s.id);
}
await db.$disconnect();
