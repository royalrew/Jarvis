import assert from "node:assert/strict";
import test from "node:test";
import { lessonPedagogy } from "./pedagogy.js";

test("första scenen har minimal aktiv belastning", () => {
  const policy = lessonPedagogy("A1 – Hälsningar", true);
  assert.equal(policy.targetWords, 2);
  assert.equal(policy.leechWords, 0);
  assert.equal(policy.maxNewItems, 1);
});

test("ordbudgeten växer kontrollerat med nivån", () => {
  const a1 = lessonPedagogy("A1 – Vardag");
  const b1 = lessonPedagogy("B1 – Seuil");
  const c2 = lessonPedagogy("C2 – Maîtrise");
  assert.ok(a1.targetWords < b1.targetWords);
  assert.ok(b1.targetWords < c2.targetWords);
  assert.ok(a1.targetWords + a1.leechWords + a1.maxNewItems <= 6);
});

test("okänd nivå faller säkert tillbaka till A1", () => {
  assert.deepEqual(lessonPedagogy("nybörjare"), lessonPedagogy("A1"));
});
