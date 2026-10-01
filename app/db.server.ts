import "./env.server";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

/**
 * Supabase's session pooler allows few connections (15 on the free plan), and Prisma would open
 * one per CPU core. Cap it: web and worker each use DB_CONNECTION_LIMIT (default 4) plus the job
 * queue's 2, so both processes together stay well under the limit.
 */
function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", process.env.DB_CONNECTION_LIMIT ?? "4");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
    return url.toString();
  } catch {
    return raw;
  }
}

function create() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = create();
  }
}

const prisma = global.prismaGlobal ?? create();

export default prisma;
