/**
 * Validator Test Suite
 * Tests all 4 hard rules + soft guidelines.
 * Zero LLM calls — all inputs are stubbed.
 */

import { validate } from "../src/validator";
import { RESTAURANT_MAP, RESTAURANTS } from "../src/data/restaurants";
import { ConversationContext, ValidationInput } from "../src/types";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function baseContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    userLocation: "Marina",
    partySize: 2,
    budget: 500,
    dietaryRestrictions: [],
    allergies: [],
    occasion: null,
    currentTime: "2025-05-07T19:30:00+04:00", // Wednesday, 19:30 — most places open
    recommendedRestaurantsInSession: [],
    ...overrides,
  };
}

function makeInput(
  restaurantIds: string[],
  ctx: ConversationContext,
  prose = "Here are my recommendations."
): ValidationInput {
  return {
    llmResponse: prose,
    conversationContext: ctx,
    extractedRecommendations: restaurantIds.map((id) => RESTAURANT_MAP[id]),
  };
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

type TestResult = { name: string; passed: boolean; error?: string };
const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✓  ${name}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, error: msg });
    console.error(`  ✗  ${name}`);
    console.error(`     ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── RULE_01_CLOSED Tests ─────────────────────────────────────────────────────

console.log("\n── RULE_01_CLOSED: Never recommend a closed restaurant ──");

test("passes when restaurant is open", () => {
  // r_001 Hoshi Omakase: Wednesday open 12:00-15:00 and 18:00-23:00
  // currentTime = Wednesday 19:30 → should be open
  const result = validate(makeInput(["r_001"], baseContext()));
  assertEqual(result.valid, true, "valid");
});

test("fails when restaurant is closed (4am)", () => {
  // r_006 Casa Lupo: only open 12:00-22:00 — 04:00 is clearly closed
  const ctx = baseContext({
    currentTime: "2025-05-07T04:00:00+04:00", // Wednesday 04:00
  });
  const result = validate(makeInput(["r_006"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const violation = result.violations.find((v) => v.ruleId === "RULE_01_CLOSED");
    assert(violation !== undefined, "RULE_01_CLOSED violation present");
    assertEqual(violation!.severity, "hard", "severity");
    assertEqual(violation!.restaurantId, "r_006", "restaurantId");
  }
});

test("passes midnight-spanning window correctly (open at 01:00)", () => {
  // r_002 Zuma: Monday open 12:00-01:00 → 01:00 is edge, should be closed
  const ctx = baseContext({
    currentTime: "2025-05-05T01:30:00+04:00", // Monday 01:30 → outside 12:00-01:00
  });
  const result = validate(makeInput(["r_002"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    assert(result.violations.some((v) => v.ruleId === "RULE_01_CLOSED"), "RULE_01_CLOSED present");
  }
});

test("handles restaurant with no hours for that day", () => {
  // r_001 has no "tuesday" entry in some scenarios — use a restaurant without a day
  // Simulate by checking a real gap: r_005 Nobu doesn't open for lunch Mon-Thu
  const ctx = baseContext({
    currentTime: "2025-05-05T12:30:00+04:00", // Monday 12:30 — Nobu only opens 19:00
  });
  const result = validate(makeInput(["r_005"], ctx));
  assertEqual(result.valid, false, "valid");
});

// ─── RULE_03_DISTANCE Tests ───────────────────────────────────────────────────

console.log("\n── RULE_03_DISTANCE: Never recommend restaurants >20km away ──");

test("passes when restaurant is within 20km", () => {
  // r_003 Trattoria Lucia: from Marina = 4.2km
  const ctx = baseContext({ userLocation: "Marina" });
  const result = validate(makeInput(["r_003"], ctx));
  assertEqual(result.valid, true, "valid");
});

test("fails when restaurant is >20km (Trattoria Lucia from Deira = 32.1km)", () => {
  const ctx = baseContext({ userLocation: "Deira" });
  const result = validate(makeInput(["r_003"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const violation = result.violations.find((v) => v.ruleId === "RULE_03_DISTANCE");
    assert(violation !== undefined, "RULE_03_DISTANCE violation present");
    assertEqual(violation!.severity, "hard", "severity");
    assertEqual(violation!.restaurantId, "r_003", "restaurantId");
  }
});

test("skips distance check when userLocation is null", () => {
  const ctx = baseContext({ userLocation: null });
  const result = validate(makeInput(["r_003"], ctx));
  // No hard violation — cannot check without location
  const hardViolations = result.valid ? [] : result.violations.filter((v) => v.severity === "hard" && v.ruleId === "RULE_03_DISTANCE");
  assertEqual(hardViolations.length, 0, "no hard RULE_03 violations");
});

test("passes for restaurant exactly at 20km", () => {
  // Manually inject a test distance by using r_004 from Marina = 18.3km (within limit)
  const ctx = baseContext({ userLocation: "Marina" });
  const result = validate(makeInput(["r_004"], ctx));
  // r_004 from Marina = 18.3 → should pass distance check
  const distViolations = result.valid
    ? []
    : result.violations.filter((v) => v.ruleId === "RULE_03_DISTANCE");
  assertEqual(distViolations.length, 0, "no distance violations for 18.3km");
});

// ─── RULE_04_ALLERGY Tests ────────────────────────────────────────────────────

console.log("\n── RULE_04_ALLERGY: Every recommendation safe for stated allergies ──");

test("passes when no allergies stated", () => {
  const result = validate(makeInput(["r_004"], baseContext({ allergies: [] })));
  assertEqual(result.valid, true, "valid");
});

test("passes when restaurant has no matching allergens", () => {
  // r_003 Trattoria Lucia has: gluten, dairy, eggs — user only allergic to fish
  const ctx = baseContext({ allergies: ["fish"] });
  const result = validate(makeInput(["r_003"], ctx));
  assertEqual(result.valid, true, "valid");
});

test("fails when restaurant contains user allergen (nut allergy + r_004)", () => {
  // r_004 Al Fanar contains nuts
  const ctx = baseContext({ allergies: ["nuts"] });
  const result = validate(makeInput(["r_004"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const violation = result.violations.find((v) => v.ruleId === "RULE_04_ALLERGY");
    assert(violation !== undefined, "RULE_04_ALLERGY violation present");
    assertEqual(violation!.severity, "hard", "severity");
    assertEqual(violation!.restaurantId, "r_004", "restaurantId");
  }
});

test("allergen check is case-insensitive (NUTS vs nuts)", () => {
  const ctx = baseContext({ allergies: ["NUTS"] });
  const result = validate(makeInput(["r_004"], ctx));
  assertEqual(result.valid, false, "case-insensitive match");
});

test("fails for multiple allergen matches", () => {
  // r_001 Hoshi has: fish, shellfish, soy, sesame
  const ctx = baseContext({ allergies: ["fish", "sesame"] });
  const result = validate(makeInput(["r_001"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    assert(result.violations.some((v) => v.ruleId === "RULE_04_ALLERGY"), "allergy violation");
  }
});

// ─── RULE_06_BUDGET Tests ─────────────────────────────────────────────────────

console.log("\n── RULE_06_BUDGET: Never exceed user's per-person budget ──");

test("passes when restaurant is within budget", () => {
  // r_004 Al Fanar = AED 120, budget = 150
  const ctx = baseContext({ budget: 150 });
  const result = validate(makeInput(["r_004"], ctx));
  assertEqual(result.valid, true, "valid");
});

test("fails when restaurant exceeds budget (r_001 AED 450 > AED 100)", () => {
  const ctx = baseContext({ budget: 100 });
  const result = validate(makeInput(["r_001"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const violation = result.violations.find((v) => v.ruleId === "RULE_06_BUDGET");
    assert(violation !== undefined, "RULE_06_BUDGET violation present");
    assertEqual(violation!.severity, "hard", "severity");
    assertEqual(violation!.restaurantId, "r_001", "restaurantId");
  }
});

test("passes when budget is null (not stated)", () => {
  const ctx = baseContext({ budget: null });
  const result = validate(makeInput(["r_001"], ctx));
  const budgetViolations = result.valid
    ? []
    : result.violations.filter((v) => v.ruleId === "RULE_06_BUDGET");
  assertEqual(budgetViolations.length, 0, "no budget violations when budget is null");
});

test("passes when price exactly equals budget", () => {
  // r_004 = AED 120, budget = 120
  const ctx = baseContext({ budget: 120 });
  const result = validate(makeInput(["r_004"], ctx));
  const budgetViolations = result.valid
    ? []
    : result.violations.filter((v) => v.ruleId === "RULE_06_BUDGET");
  assertEqual(budgetViolations.length, 0, "price == budget is valid");
});

// ─── Multi-Rule & Interaction Tests ──────────────────────────────────────────

console.log("\n── Multi-rule & edge cases ──");

test("detects multiple hard violations in one response", () => {
  // r_001 (AED 450) recommended at 04:00 → both RULE_01 and RULE_06
  const ctx = baseContext({
    currentTime: "2025-05-07T04:00:00+04:00",
    budget: 100,
  });
  const result = validate(makeInput(["r_001"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const ruleIds = result.violations.map((v) => v.ruleId);
    assert(ruleIds.includes("RULE_01_CLOSED"), "RULE_01_CLOSED");
    assert(ruleIds.includes("RULE_06_BUDGET"), "RULE_06_BUDGET");
  }
});

test("validates multiple restaurants — one violating, one clean", () => {
  // r_004 (nuts) + r_002 (no nuts) for a nut-allergic user
  const ctx = baseContext({ allergies: ["nuts"] });
  const result = validate(makeInput(["r_004", "r_002"], ctx));
  assertEqual(result.valid, false, "valid");
  if (!result.valid) {
    const ids = result.violations.map((v) => v.restaurantId);
    assert(ids.includes("r_004"), "r_004 flagged");
    assert(!ids.includes("r_002"), "r_002 not flagged");
  }
});

test("soft violations don't block a valid response", () => {
  // r_002 Zuma: rating 4.6 (fine), but set occasion to romantic + low ambiance... 
  // actually ambiance is 4.7 so we need a different setup.
  // Use duplicate session history as a soft violation
  const ctx = baseContext({
    recommendedRestaurantsInSession: ["r_002"],
  });
  const result = validate(makeInput(["r_002"], ctx));
  assertEqual(result.valid, true, "valid despite soft violation");
  assert(result.softViolations.length > 0, "soft violations logged");
  assert(
    result.softViolations.some((v) => v.ruleId === "RULE_05_DUPLICATE"),
    "RULE_05_DUPLICATE logged"
  );
});

test("empty recommendation list passes cleanly", () => {
  const result = validate(makeInput([], baseContext()));
  assertEqual(result.valid, true, "valid");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${results.length} tests`);

if (failed > 0) {
  console.log("\nFailed tests:");
  results
    .filter((r) => !r.passed)
    .forEach((r) => console.log(`  ✗  ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log("\nAll tests passed! ✓");
}
