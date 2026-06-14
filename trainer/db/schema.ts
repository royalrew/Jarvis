import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

/**
 * Datalager för "Vägen till flaggan".
 *
 * Single-user för MVP: en rad i `user` (se db/seed.ts → USER_ID).
 * `userId` finns ändå på all per-användardata så multi-tenant kan läggas
 * på senare utan migrering av befintliga rader.
 */

export const modeEnum = pgEnum("mode", ["reps", "hold"]);
export const gripEnum = pgEnum("grip", ["bred", "smal"]);

// ── Användare ────────────────────────────────────────────────────────────
export const user = pgTable("user", {
  id: text("id").primaryKey(),
});

// ── Logg: pass + övningar ────────────────────────────────────────────────
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  date: date("date").notNull(), // YYYY-MM-DD
});

export const entry = pgTable("entry", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mode: modeEnum("mode").notNull(),
  sets: integer("sets").array().notNull(), // reps eller sekunder per set
  weight: integer("weight"), // extravikt i kg (t.ex. viktväst eller bälte)
});

// ── Nivåer: skill tree ───────────────────────────────────────────────────
export const track = pgTable("track", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goalLabel: text("goal_label").notNull(),
  sortIdx: integer("sort_idx").notNull().default(0),
});

export const trackLevel = pgTable("track_level", {
  id: text("id").primaryKey(),
  trackId: text("track_id")
    .notNull()
    .references(() => track.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(), // 1 = nybörjarentré
  name: text("name").notNull(),
  target: text("target").notNull(), // t.ex. "5 reps" / "10s"
  elite: boolean("elite").notNull().default(false),
});

export const trackProgress = pgTable(
  "track_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => track.id, { onDelete: "cascade" }),
    reached: integer("reached").notNull().default(0), // högsta klarade idx (0 = ingen)
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);

// ── Kampanj: tiers, veckor, end bosses ───────────────────────────────────
export const tier = pgTable("tier", {
  id: text("id").primaryKey(),
  idx: integer("idx").notNull(), // ordning Nybörjare→Elit
  name: text("name").notNull(),
  theme: text("theme").notNull(),
});

export const tierWeek = pgTable("tier_week", {
  id: text("id").primaryKey(),
  tierId: text("tier_id")
    .notNull()
    .references(() => tier.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  boss: text("boss").notNull(),
  focus: text("focus").notNull(),
  criteria: text("criteria").notNull(),
});

export const tierEndboss = pgTable("tier_endboss", {
  id: text("id").primaryKey(),
  tierId: text("tier_id")
    .notNull()
    .references(() => tier.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  criteria: text("criteria").array().notNull(),
});

// itemId pekar på tier_week.id ELLER tier_endboss.id (kampanj-item).
export const campaignProgress = pgTable(
  "campaign_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    cleared: boolean("cleared").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

// ── Passmallar: bestående grepp-rotation ─────────────────────────────────
export const gripState = pgTable("grip_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  push: gripEnum("push").notNull().default("bred"),
  pull: gripEnum("pull").notNull().default("bred"),
});

export const calendarEvent = pgTable("calendar_event", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  location: text("location"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  createdAt: text("created_at").notNull().default("now"),
  updatedAt: text("updated_at").notNull().default("now"),
});

// ── Relations ────────────────────────────────────────────────────────────
export const sessionRelations = relations(session, ({ many }) => ({
  entries: many(entry),
}));

export const entryRelations = relations(entry, ({ one }) => ({
  session: one(session, { fields: [entry.sessionId], references: [session.id] }),
}));

export const trackRelations = relations(track, ({ many }) => ({
  levels: many(trackLevel),
}));

export const trackLevelRelations = relations(trackLevel, ({ one }) => ({
  track: one(track, { fields: [trackLevel.trackId], references: [track.id] }),
}));

export const tierRelations = relations(tier, ({ many, one }) => ({
  weeks: many(tierWeek),
  endboss: one(tierEndboss, { fields: [tier.id], references: [tierEndboss.tierId] }),
}));

export const tierWeekRelations = relations(tierWeek, ({ one }) => ({
  tier: one(tier, { fields: [tierWeek.tierId], references: [tier.id] }),
}));

export type Grip = (typeof gripEnum.enumValues)[number];
export type Mode = (typeof modeEnum.enumValues)[number];
