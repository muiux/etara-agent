/**
 * Demo Script — 4 Required Scenarios
 *
 * Each scenario stubs the LLM response to force a specific violation,
 * then shows how the validator catches and corrects it.
 *
 * Run with: npx ts-node demo.ts
 */

import { runAgent } from "./src/agent";
import { ConversationContext } from "./src/types";

const DIVIDER = "─".repeat(70);

function printScenario(num: number, title: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`  SCENARIO ${num}: ${title}`);
  console.log(DIVIDER);
}

function printResult(label: string, value: unknown) {
  console.log(`\n[${label}]`);
  if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

// ─── Base context factory ─────────────────────────────────────────────────────

function ctx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    userLocation: "Marina",
    partySize: 2,
    budget: 500,
    dietaryRestrictions: [],
    allergies: [],
    occasion: null,
    currentTime: "2025-05-07T19:30:00+04:00",
    recommendedRestaurantsInSession: [],
    ...overrides,
  };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function scenario1() {
  printScenario(1, "RULE_01_CLOSED — User asks for dinner at 04:00");

  // The LLM (stubbed) recommends r_006 Casa Lupo, which closes at 22:00
  const stubbedResponse = `
I'd love to recommend **Casa Lupo** for a late-night dinner — it has a wonderful Italian ambiance perfect for a romantic evening!

<!-- RESTAURANTS: ["r_006"] -->
`.trim();

  const context = ctx({
    currentTime: "2025-05-07T04:00:00+04:00", // 4 AM — Casa Lupo is closed
  });

  console.log("\nUser: I'd like dinner somewhere nice right now.");
  console.log(`Context: currentTime = 04:00, location = Marina`);

  const result = await runAgent(
    "I'd like dinner somewhere nice right now.",
    context,
    [],
    { debug: true, stubbedLLMResponse: stubbedResponse }
  );

  printResult("CORRECTED RESPONSE", result.response);
  printResult("DEBUG INFO", result._debug);
}

async function scenario2() {
  printScenario(2, "RULE_03_DISTANCE — User in Deira, LLM recommends Trattoria Lucia (32.1km)");

  const stubbedResponse = `
Looking for Italian near you? **Trattoria Lucia** is a fantastic choice — authentic pasta, great ambiance, and perfect for a relaxed evening!

<!-- RESTAURANTS: ["r_003"] -->
`.trim();

  const context = ctx({
    userLocation: "Deira",
  });

  console.log("\nUser: Can you recommend a good Italian restaurant?");
  console.log(`Context: userLocation = Deira`);

  const result = await runAgent(
    "Can you recommend a good Italian restaurant?",
    context,
    [],
    { debug: true, stubbedLLMResponse: stubbedResponse }
  );

  printResult("CORRECTED RESPONSE", result.response);
  printResult("DEBUG INFO", result._debug);
}

async function scenario3() {
  printScenario(3, "RULE_04_ALLERGY — User has nut allergy, LLM recommends Al Fanar (contains nuts)");

  const stubbedResponse = `
For an authentic Emirati experience, I highly recommend **Al Fanar Restaurant** — traditional UAE cuisine in a beautiful heritage setting!

<!-- RESTAURANTS: ["r_004"] -->
`.trim();

  const context = ctx({
    allergies: ["nuts"],
  });

  console.log("\nUser: I'd love to try some local Emirati food. I have a nut allergy.");
  console.log(`Context: allergies = ["nuts"]`);

  const result = await runAgent(
    "I'd love to try some local Emirati food. I have a nut allergy.",
    context,
    [],
    { debug: true, stubbedLLMResponse: stubbedResponse }
  );

  printResult("CORRECTED RESPONSE", result.response);
  printResult("DEBUG INFO", result._debug);
}

async function scenario4() {
  printScenario(4, "RULE_06_BUDGET — Budget AED 100/person, LLM recommends Hoshi Omakase (AED 450)");

  const stubbedResponse = `
For a truly special experience, I'd recommend **Hoshi Omakase** — an exquisite 12-course Japanese omakase that will delight every sense!

<!-- RESTAURANTS: ["r_001"] -->
`.trim();

  const context = ctx({
    budget: 100,
  });

  console.log("\nUser: What's a nice restaurant? My budget is AED 100 per person.");
  console.log(`Context: budget = 100 AED/person`);

  const result = await runAgent(
    "What's a nice restaurant? My budget is AED 100 per person.",
    context,
    [],
    { debug: true, stubbedLLMResponse: stubbedResponse }
  );

  printResult("CORRECTED RESPONSE", result.response);
  printResult("DEBUG INFO", result._debug);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("\nEtara Restaurant Agent — Demo: 4 Guardrail Scenarios");
  console.log("(LLM responses are stubbed to force specific violations)\n");

  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();

  console.log(`\n${DIVIDER}`);
  console.log("  All scenarios complete.");
  console.log(DIVIDER);
})();
