import assert from "node:assert/strict";
import test from "node:test";
import { lessonPedagogy, needsGentleStart } from "./pedagogy.js";

test("första scenen har minimal aktiv belastning", () => {
  const policy = lessonPedagogy("A1 – Hälsningar", true);
  assert.equal(policy.targetWords, 1);
  assert.equal(policy.leechWords, 0);
  assert.equal(policy.maxNewItems, 0);
  assert.equal(policy.sentenceStarters, 1);
  assert.equal(policy.frenchMaxWords, 12);
  assert.equal(policy.responseMaxWords, 4);
  assert.equal(policy.translateAllFrench, true);
  assert.equal(policy.gentleStart, true);
  assert.equal(policy.wordBankMax, 1);
  assert.ok(policy.frenchMaxWords < lessonPedagogy("A1").frenchMaxWords);
});

test("ordbudgeten växer kontrollerat med nivån", () => {
  const a1 = lessonPedagogy("A1 – Vardag");
  const b1 = lessonPedagogy("B1 – Seuil");
  const c2 = lessonPedagogy("C2 – Maîtrise");
  assert.ok(a1.targetWords < b1.targetWords);
  assert.ok(b1.targetWords < c2.targetWords);
  assert.ok(a1.targetWords + a1.leechWords + a1.maxNewItems <= 6);
  assert.ok(a1.sentenceStarters > b1.sentenceStarters);
  assert.equal(c2.sentenceStarters, 0);
});

test("okänd nivå faller säkert tillbaka till A1", () => {
  assert.deepEqual(lessonPedagogy("nybörjare"), lessonPedagogy("A1"));
});

test("mjukstart styrs av demonstrerad förmåga, inte antal scener", () => {
  const weak = { meaningStability: 0, productionStability: 0, pronunciationStability: 0 };
  const known = { meaningStability: 1, productionStability: 1, pronunciationStability: 0 };
  assert.equal(needsGentleStart("A1.1", [known, known, weak]), true);
  assert.equal(needsGentleStart("A1.1", [known, known, known]), false);
  assert.equal(needsGentleStart("A1.2", [weak]), false);
});
