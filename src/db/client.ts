import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";

import * as schema from "./schema";

neonConfig.fetchConnectionCache = true;

let cached: ReturnType<typeof createDb> | undefined;

function createDb() {
  const sql = neon(env.databaseUrl());
  return drizzle(sql, { schema, casing: "snake_case", logger: false });
}

/**
 * Drizzle クライアント。シングルトン (serverless で最適化).
 */
export function getDb() {
  cached ??= createDb();
  return cached;
}

export type Db = ReturnType<typeof createDb>;
export { schema };
