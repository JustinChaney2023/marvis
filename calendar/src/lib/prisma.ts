import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { sqliteFileUrl } from "./databaseUrl";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Prisma 7 talks to SQLite through a driver adapter instead of its own
  // engine. unixepoch-ms matches how Prisma ≤6 stored DateTime columns
  // (integers); the adapter's default (ISO text) would mix two formats in
  // one column, and SQLite orders every integer before every string — so
  // date-range queries would silently skip all pre-upgrade rows.
  const adapter = new PrismaBetterSqlite3({ url: sqliteFileUrl() }, { timestampFormat: "unixepoch-ms" });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
