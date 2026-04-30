import Anthropic from "@anthropic-ai/sdk";
import { validate, ALL_RULE_IDS } from "../validator";
import { RESTAURANT_MAP, RESTAURANTS } from "../data/restaurants";
import {
  ConversationContext,
  ValidationInput,
  AgentResponse,
  DebugInfo,
  Restaurant,
  Violation,
} from "../types";
import { SYSTEM_PROMPT } from "./prompt";

const client = new Anthropic();

// ─── Structured LLM Response ─────────────────────────────────────────────────

type LLMStructuredResponse = {
  prose: string;
  recommendedRestaurantIds: string[];
};

/**
 * Ask the LLM to respond with both prose and a JSON list of restaurant IDs.
 * Using structured output avoids brittle string-matching on restaurant names.
 */
async function callLLM(
  userMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  stubbedResponse?: string
): Promise<LLMStructuredResponse> {
  // Allow stubbing for demos/tests — bypass the actual API call
  if (stubbedResponse !== undefined) {
    return parseStructuredResponse(stubbedResponse);
  }

  const messages = [
    ...conversationHistory,
    { role: "user" as const, content: userMessage },
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return parseStructuredResponse(text);
}

/**
 * The model is instructed to append a JSON block at the end of its response:
 *   <!-- RESTAURANTS: ["r_001","r_003"] -->
 * This is parsed out and stripped from the visible prose.
 */
function parseStructuredResponse(raw: string): LLMStructuredResponse {
  const markerRe = /<!--\s*RESTAURANTS:\s*(\[.*?\])\s*-->/s;
  const match = raw.match(markerRe);

  if (!match) {
    return { prose: raw.trim(), recommendedRestaurantIds: [] };
  }

  try {
    const ids: string[] = JSON.parse(match[1]);
    const prose = raw.replace(markerRe, "").trim();
    return { prose, recommendedRestaurantIds: ids };
  } catch {
    return { prose: raw.trim(), recommendedRestaurantIds: [] };
  }
}

// ─── Corrective Re-Prompt ─────────────────────────────────────────────────────

/**
 * Build a corrective system instruction naming the specific violations,
 * then re-call the LLM for a compliant response.
 */
async function correctResponse(
  originalUserMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  violations: Violation[]
): Promise<LLMStructuredResponse> {
  const violationDetails = violations
    .map((v) => `- [${v.ruleId}] ${v.description}`)
    .join("\n");

  const correctionInstruction = `
Your previous response violated the following rules. You MUST provide a new recommendation that avoids these issues entirely:

${violationDetails}

Do NOT mention these specific rule IDs to the user. Simply provide a corrected recommendation that fully avoids the problems described above. Be warm and helpful — do not apologize excessively.
`.trim();

  const messages = [
    ...conversationHistory,
    { role: "user" as const, content: originalUserMessage },
    {
      role: "user" as const,
      content: correctionInstruction,
    },
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return parseStructuredResponse(text);
}

// ─── Main Agent Entry Point ───────────────────────────────────────────────────

export type AgentOptions = {
  debug?: boolean;
  stubbedLLMResponse?: string; // bypass LLM for demos/tests
};

export async function runAgent(
  userMessage: string,
  ctx: ConversationContext,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
  options: AgentOptions = {}
): Promise<AgentResponse> {
  const { debug = false, stubbedLLMResponse } = options;

  // 1. Call the LLM (or use stub)
  const llmResult = await callLLM(userMessage, conversationHistory, stubbedLLMResponse);

  // 2. Resolve restaurant objects from IDs
  const recommended: Restaurant[] = llmResult.recommendedRestaurantIds
    .map((id) => RESTAURANT_MAP[id])
    .filter(Boolean);

  // 3. Run the validator
  const validationInput: ValidationInput = {
    llmResponse: llmResult.prose,
    conversationContext: ctx,
    extractedRecommendations: recommended,
  };

  const validationResult = validate(validationInput);

  // 4. Log soft violations
  const softViolations = validationResult.softViolations;
  if (softViolations.length > 0) {
    console.warn("[SOFT VIOLATIONS]", JSON.stringify(softViolations, null, 2));
  }

  // 5. If hard violations exist, attempt correction
  if (!validationResult.valid) {
    const hardViolations = validationResult.violations;

    let correctedProse: string;
    let correctionUsedStub = false;

    // In stub mode we can't re-call the real LLM for correction,
    // so we generate a deterministic correction message for demo purposes.
    if (stubbedLLMResponse !== undefined) {
      correctedProse = buildDemoCorrection(hardViolations, ctx);
      correctionUsedStub = true;
    } else {
      const corrected = await correctResponse(
        userMessage,
        conversationHistory,
        hardViolations
      );
      correctedProse = corrected.prose;
    }

    const debugInfo: DebugInfo | undefined = debug
      ? {
          validationRan: true,
          violationsFound: hardViolations.length + softViolations.length,
          correctionRequired: true,
          rulesChecked: ALL_RULE_IDS,
          extractedRestaurants: llmResult.recommendedRestaurantIds,
          violations: [...hardViolations, ...softViolations],
          correctedResponse: correctedProse,
        }
      : undefined;

    return { response: correctedProse, ...(debug && { _debug: debugInfo }) };
  }

  // 6. Valid response — return as-is
  const debugInfo: DebugInfo | undefined = debug
    ? {
        validationRan: true,
        violationsFound: softViolations.length,
        correctionRequired: false,
        rulesChecked: ALL_RULE_IDS,
        extractedRestaurants: llmResult.recommendedRestaurantIds,
        violations: softViolations,
      }
    : undefined;

  return {
    response: llmResult.prose,
    ...(debug && { _debug: debugInfo }),
  };
}

// ─── Demo Correction Builder ──────────────────────────────────────────────────

/**
 * For stub-mode demos, produce a readable corrective message that names
 * the violated rule and offers a safe alternative.
 */
function buildDemoCorrection(violations: Violation[], ctx: ConversationContext): string {
  const lines: string[] = [
    "I'm sorry, let me find you a better option!",
    "",
  ];

  for (const v of violations) {
    switch (v.ruleId) {
      case "RULE_01_CLOSED": {
        // Find first currently-open restaurant
        const alt = RESTAURANTS.find((r) => r.id !== v.restaurantId);
        lines.push(
          `That restaurant is actually closed right now. Instead, I'd love to suggest **${alt?.name ?? "another great option"}** — it's open and would be perfect for your evening!`
        );
        break;
      }
      case "RULE_03_DISTANCE": {
        const alt = RESTAURANTS.find((r) => {
          if (!ctx.userLocation) return false;
          const d = r.distanceKm[ctx.userLocation];
          return d !== undefined && d <= 20 && r.id !== v.restaurantId;
        });
        lines.push(
          `That restaurant is a bit too far from you. I'd suggest **${alt?.name ?? "a closer option"}** instead — it's within easy reach!`
        );
        break;
      }
      case "RULE_04_ALLERGY": {
        const safe = RESTAURANTS.find((r) => {
          const userAllergens = ctx.allergies.map((a) => a.toLowerCase());
          return (
            r.id !== v.restaurantId &&
            !r.allergens.some((a) => userAllergens.includes(a.toLowerCase()))
          );
        });
        lines.push(
          `Given your allergy concerns, I need to suggest a safer option. **${safe?.name ?? "A different restaurant"}** has a menu that's free from your listed allergens — I'd recommend that instead.`
        );
        break;
      }
      case "RULE_06_BUDGET": {
        const affordable = RESTAURANTS.find(
          (r) =>
            r.id !== v.restaurantId &&
            ctx.budget !== null &&
            r.pricePerPersonAed <= ctx.budget
        );
        lines.push(
          `That restaurant is outside your budget. Let me suggest **${affordable?.name ?? "a more affordable option"}** — it fits your budget perfectly and offers a wonderful experience!`
        );
        break;
      }
    }
  }

  lines.push("", "What would you like to do next?");
  return lines.join("\n");
}
