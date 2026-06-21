import assert from "node:assert/strict";
import test from "node:test";
import { parseMysteryLevel } from "./mystery.js";

test("mysterienivån hämtas ur modulnamnet", () => {
  assert.equal(parseMysteryLevel("A1 – Hälsningar"), "A1");
  assert.equal(parseMysteryLevel("C2.3 Maîtrise"), "C2");
});

test("okänd mysterienivå faller säkert tillbaka till A1", () => {
  assert.equal(parseMysteryLevel("nybörjare"), "A1");
});
