import path from "node:path";

/**
 * The SQLite file DATABASE_URL points at, as an absolute path.
 *
 * Prisma ≤6 resolved a relative `file:./dev.db` against the prisma/ folder
 * (next to schema.prisma), so existing installs keep their database at
 * prisma/dev.db. Prisma 7 and the better-sqlite3 adapter would resolve it
 * against the working directory instead — silently opening a new, empty
 * database. Both prisma.config.ts and the runtime client go through this
 * so the old location keeps working.
 */
export function sqliteFilePath(url = process.env.DATABASE_URL ?? "file:./dev.db"): string {
  const raw = url.replace(/^file:/, "");
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), "prisma", raw);
}

export function sqliteFileUrl(url?: string): string {
  return `file:${sqliteFilePath(url)}`;
}
