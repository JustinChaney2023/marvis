import "dotenv/config";
import { defineConfig } from "prisma/config";
import { sqliteFileUrl } from "./src/lib/databaseUrl";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Absolute, so a relative DATABASE_URL keeps meaning prisma/<file> as it
  // did before Prisma 7 (see src/lib/databaseUrl.ts).
  datasource: { url: sqliteFileUrl() },
});
