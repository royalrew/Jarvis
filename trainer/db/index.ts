import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

loadEnv({ path: "../.env" });
loadEnv({ path: ".env.local" });

/**
 * Enkel single-user-app: en fast användare för MVP.
 * Byts mot session/auth-uppslag när multi-tenant läggs på.
 */
export const USER_ID = "me";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL saknas – lägg den i root-.env");
}

// Återanvänd connection över hot-reload i dev (annars läcker connections).
const globalForDb = globalThis as unknown as {
  _trainerSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb._trainerSql ?? postgres(connectionString, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb._trainerSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
