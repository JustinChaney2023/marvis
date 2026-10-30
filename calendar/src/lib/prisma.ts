import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { sqliteFileUrl } from "./databaseUrl";

function createBaseClient() {
  // Prisma 7 talks to SQLite through a driver adapter instead of its own
  // engine. unixepoch-ms matches how Prisma ≤6 stored DateTime columns
  // (integers); the adapter's default (ISO text) would mix two formats in
  // one column, and SQLite orders every integer before every string — so
  // date-range queries would silently skip all pre-upgrade rows.
  const adapter = new PrismaBetterSqlite3({ url: sqliteFileUrl() }, { timestampFormat: "unixepoch-ms" });
  return new PrismaClient({ adapter });
}

/**
 * Before any Event delete, remember which of the doomed rows live on a
 * Google calendar, so the next sync deletes them there too (see
 * GoogleDeletion in schema.prisma). Done here, once, rather than at each
 * of the many places that delete events.
 */
async function recordGoogleDeletions(base: PrismaClient, where: Prisma.EventWhereInput | undefined) {
  const linked = await base.event.findMany({
    where: { AND: [where ?? {}, { googleEventId: { not: null }, googleAccountId: { not: null } }] },
    select: { googleAccountId: true, googleEventId: true },
  });
  for (const row of linked) {
    const key = { googleAccountId: row.googleAccountId!, googleEventId: row.googleEventId! };
    await base.googleDeletion.upsert({
      where: { googleAccountId_googleEventId: key },
      create: key,
      update: {},
    });
  }
}

function createClient() {
  const base = createBaseClient();
  return base.$extends({
    query: {
      event: {
        async delete({ args, query }) {
          await recordGoogleDeletions(base, args.where as Prisma.EventWhereInput);
          return query(args);
        },
        async deleteMany({ args, query }) {
          await recordGoogleDeletions(base, args.where);
          return query(args);
        },
      },
    },
  });
}

type SeasonPrisma = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: SeasonPrisma };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
