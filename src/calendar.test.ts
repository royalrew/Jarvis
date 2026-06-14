import assert from "node:assert";
import dotenv from "dotenv";
dotenv.config();

import { initDb } from "./db.js";
import { getCalendarEvents, addCalendarEvent, deleteCalendarEvent } from "./calendarDb.js";
import { classifyIntent } from "./intent.js";
import { handleSmartCalendar } from "./calendar.js";

async function testCalendarIntent() {
  console.log("Running calendar intent tests...");
  
  const r1 = await classifyIntent("boka möte med Sven imorgon kl 15:00");
  assert.strictEqual(r1.intent, "calendar");

  const r2 = await classifyIntent("ta bort mitt möte klockan 12");
  assert.strictEqual(r2.intent, "calendar");

  const r3 = await classifyIntent("vad har jag inbokat på tisdag?");
  assert.strictEqual(r3.intent, "calendar");

  const r4 = await classifyIntent("flytta lunchen med Erik till kl 13:00");
  assert.strictEqual(r4.intent, "calendar");

  console.log("✓ Calendar intent tests passed!");
}

async function testHandleSmartCalendar() {
  console.log("Running handleSmartCalendar integration tests...");

  // Clear existing test events to start fresh
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  const initialEvents = await getCalendarEvents(start.toISOString(), end.toISOString());
  for (const e of initialEvents) {
    if (e.title.includes("Testmöte med Sven") || e.title.includes("Sven")) {
      await deleteCalendarEvent(e.id);
    }
  }

  // 1. Add Event
  const reply1 = await handleSmartCalendar("boka Testmöte med Sven imorgon kl 15:00");
  console.log("Add reply:", reply1);
  assert.ok(reply1.includes("Bokat!"), `Unexpected reply: ${reply1}`);

  // Fetch from DB to verify it exists and get its ID
  const events = await getCalendarEvents(start.toISOString(), end.toISOString());
  const event = events.find(e => e.title === "Testmöte med Sven");
  assert.ok(event, "Event should exist in database");
  console.log("Event added in DB:", event);

  // 2. Update/Move Event
  const reply2 = await handleSmartCalendar(`flytta Testmöte med Sven till kl 17:00`);
  console.log("Update reply:", reply2);
  assert.ok(reply2.includes("Uppdaterat!"), `Unexpected reply: ${reply2}`);

  // Fetch again to verify updated time
  const updatedEvents = await getCalendarEvents(start.toISOString(), end.toISOString());
  const updatedEvent = updatedEvents.find(e => e.title === "Testmöte med Sven");
  assert.ok(updatedEvent, "Event should still exist");
  const updatedTime = new Date(updatedEvent.startsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  assert.strictEqual(updatedTime, "17:00");
  console.log("Event updated in DB:", updatedEvent);

  // 3. Delete Event
  const reply3 = await handleSmartCalendar(`ta bort Testmöte med Sven`);
  console.log("Delete reply:", reply3);
  assert.ok(reply3.includes("Avbokat!"), `Unexpected reply: ${reply3}`);

  // Verify it is gone
  const finalEvents = await getCalendarEvents(start.toISOString(), end.toISOString());
  const deletedEvent = finalEvents.find(e => e.title === "Testmöte med Sven");
  assert.ok(!deletedEvent, "Event should be deleted from database");

  console.log("✓ handleSmartCalendar integration tests passed!");
}

async function main() {
  try {
    initDb();
    await testCalendarIntent();
    await testHandleSmartCalendar();
    process.exit(0);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
