import assert from "node:assert/strict";
import test from "node:test";
import { naturalCommand } from "./commands.js";

test("lära och öva franska startar alltid en stöttad lektion", () => {
  assert.equal(naturalCommand("Nu vill jag lära mig franska")?.command, "/lektion");
  assert.equal(naturalCommand("Jag vill öva franska")?.command, "/lektion");
  assert.equal(naturalCommand("Dags att träna franska")?.command, "/lektion");
});

test("uttrycklig fri konversation lämnas till intentklassificeringen", () => {
  assert.equal(naturalCommand("Prata franska med mig"), null);
});

test("glosor kan öppnas med naturligt språk", () => {
  assert.equal(naturalCommand("Visa dagens glosor")?.command, "/glosor");
});
