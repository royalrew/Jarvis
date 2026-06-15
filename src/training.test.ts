import assert from "node:assert";
import dotenv from "dotenv";
dotenv.config();

import { parseTrainingCommand, handleTrainingCommand } from "./training.js";

function testParseTrainingCommand() {
  console.log("Running parseTrainingCommand tests...");

  // Smart completion detections
  const t1 = parseTrainingCommand("jag klarade hollow hold 40 sekunder");
  assert.deepStrictEqual(t1, { type: "smartComplete", input: "jag klarade hollow hold 40 sekunder" });

  const t2 = parseTrainingCommand("hollow hold 40s klar");
  assert.deepStrictEqual(t2, { type: "smartComplete", input: "hollow hold 40s klar" });

  const t3 = parseTrainingCommand("complete tuck front lever 10s");
  assert.deepStrictEqual(t3, { type: "smartComplete", input: "complete tuck front lever 10s" });

  const t4 = parseTrainingCommand("klarade 8 strikta pull-ups");
  assert.deepStrictEqual(t4, { type: "smartComplete", input: "klarade 8 strikta pull-ups" });

  // Standard commands should still function identically
  const c1 = parseTrainingCommand("/complete-level drag");
  assert.deepStrictEqual(c1, { type: "completeLevel", trackId: "drag" });

  const c2 = parseTrainingCommand("/next-training");
  assert.deepStrictEqual(c2, { type: "next" });

  const c3 = parseTrainingCommand("öppna logg");
  assert.deepStrictEqual(c3, { type: "open", view: "logg" });

  const c4 = parseTrainingCommand("vad är nästa mål?");
  assert.deepStrictEqual(c4, { type: "next" });

  // Weight vest logging command tests
  const w1 = parseTrainingCommand("logga Pull-ups 5 5 4 +10");
  assert.deepStrictEqual(w1, { type: "log", exercise: "Pull-ups", sets: [5, 5, 4], weight: 10 });

  const w2 = parseTrainingCommand("logga Pull-ups 5 5 4 +10kg");
  assert.deepStrictEqual(w2, { type: "log", exercise: "Pull-ups", sets: [5, 5, 4], weight: 10 });

  const w3 = parseTrainingCommand("logga Pull-ups 5 5 4");
  assert.deepStrictEqual(w3, { type: "log", exercise: "Pull-ups", sets: [5, 5, 4], weight: null });

  console.log("✓ parseTrainingCommand tests passed!");
}

async function testHandleSmartComplete() {
  console.log("Running handleSmartComplete integration test (database + LLM)...");
  
  // Case 1: Hollow Hold
  const command1 = parseTrainingCommand("jag klarade hollow hold 40 sekunder");
  if (!command1) throw new Error("Could not parse command1");
  const reply1 = await handleTrainingCommand(command1);
  console.log("Response 1:", reply1);
  assert.ok(reply1 !== null, "reply1 should not be null");
  assert.ok(reply1.includes("Bål") || reply1.includes("Hollow hold") || reply1.includes("mål"));
  assert.ok(reply1.includes("/complete-level core") || reply1.includes("redan markerat"));

  // Case 2: Tuck front lever
  const command2 = parseTrainingCommand("klarade tuck front lever 10s");
  if (!command2) throw new Error("Could not parse command2");
  const reply2 = await handleTrainingCommand(command2);
  console.log("Response 2:", reply2);
  assert.ok(reply2 !== null, "reply2 should not be null");
  assert.ok(reply2.includes("Front Lever") || reply2.includes("Tuck front lever"));
  assert.ok(reply2.includes("/complete-level front") || reply2.includes("redan markerat"));

  // Case 3: Negative/No match sentence
  const command3 = parseTrainingCommand("jag har inte klarat handstående än");
  if (!command3) throw new Error("Could not parse command3");
  const reply3 = await handleTrainingCommand(command3);
  console.log("Response 3:", reply3);
  assert.strictEqual(reply3, null, "reply3 should be null for a negative completion statement");
  
  console.log("✓ handleSmartComplete integration test passed!");
}

async function testDynamicWorkoutGeneration() {
  console.log("Running dynamic workout generation tests...");

  // 1. Check parsing
  const cmdToday = parseTrainingCommand("vad ska jag träna idag?");
  assert.deepStrictEqual(cmdToday, { type: "today", location: undefined });

  const cmdDraft = parseTrainingCommand("spara passet");
  assert.deepStrictEqual(cmdDraft, { type: "createDraft" });

  // 2. Run handlers
  const replyToday = await handleTrainingCommand({ type: "today", location: undefined });
  console.log("Today's workout reply:", replyToday);
  assert.ok(replyToday && replyToday.length > 0, "Workout reply should not be empty");

  const replyDraft = await handleTrainingCommand({ type: "createDraft" });
  console.log("Draft workout reply:", replyDraft);
  assert.ok(replyDraft && replyDraft.includes("förberett och lagt in"), "Draft reply should confirm insertion");

  // 3. Cleanup today's session
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5434/trainer");
  const date = new Date().toISOString().slice(0, 10);
  await sql`delete from session where date = ${date}`;
  await sql.end();

  console.log("✓ Dynamic workout generation tests passed!");
}

async function main() {
  try {
    testParseTrainingCommand();
    await testHandleSmartComplete();
    await testDynamicWorkoutGeneration();
    process.exit(0);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
