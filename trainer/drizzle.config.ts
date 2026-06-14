import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: "../.env" });
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Boten delar samma Postgres och äger egna tabeller (conversations, memories,
  // jargon_phrases m.fl.). Begränsa drizzle till trainer-tabellerna så push
  // aldrig försöker rename:a eller droppa bot-tabellerna.
  tablesFilter: [
    "user",
    "session",
    "entry",
    "track",
    "track_level",
    "track_progress",
    "tier",
    "tier_week",
    "tier_endboss",
    "campaign_progress",
    "grip_state",
    "calendar_event",
  ],
  strict: true,
  verbose: true,
});
