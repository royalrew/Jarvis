import "dotenv/config";
import { getSql } from "../src/db.js";
import { initFrenchDb } from "../src/french/db.js";
import { seedCurriculum } from "../src/french/curriculum.js";

/** Seedar den franska läroplanen mot DATABASE_URL. Kör: npm run french:seed */
async function main() {
  await initFrenchDb();
  const { items, modules } = await seedCurriculum();
  console.log(`✓ Fransk läroplan seedad: ${items} ord i ${modules} moduler.`);
  await getSql().end();
}

main().catch((e) => {
  console.error("Seed misslyckades:", e);
  process.exit(1);
});
