import {
  ValidationInput,
  ValidationResult,
  Violation,
  Restaurant,
  ConversationContext,
} from "../types";

// ─── Time Utilities ──────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" into total minutes since midnight.
 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Parse the UTC offset in minutes from an ISO 8601 string.
 * e.g. "+04:00" → 240,  "-05:30" → -330,  "Z" → 0
 */
function parseOffsetMinutes(isoTime: string): number {
  const offsetMatch = isoTime.match(/([+-])(\d{2}):(\d{2})$/);
  if (!offsetMatch) return 0;
  const sign = offsetMatch[1] === "+" ? 1 : -1;
  return sign * (parseInt(offsetMatch[2], 10) * 60 + parseInt(offsetMatch[3], 10));
}

/**
 * Get lowercase day name from an ISO 8601 timestamp, respecting the
 * embedded UTC offset (wall-clock time at that offset).
 * e.g. "2025-05-10T04:30:00+04:00" → "saturday"
 */
function getDayName(isoTime: string): string {
  const date = new Date(isoTime);
  const offsetMinutes = parseOffsetMinutes(isoTime);
  const utcMs = date.getTime();
  const localMs = utcMs + offsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  return days[localDate.getUTCDay()];
}

/**
 * Get minutes since midnight from an ISO 8601 timestamp, in the wall-clock
 * sense of the embedded offset (or UTC if no offset is given).
 */
function getMinuteOfDay(isoTime: string): number {
  const date = new Date(isoTime);
  const offsetMinutes = parseOffsetMinutes(isoTime);
  const utcMs = date.getTime();
  const localMs = utcMs + offsetMinutes * 60 * 1000;
  const localDate = new Date(localMs);
  return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
}

/**
 * Check whether `currentMinute` falls within an opening window.
 * Handles midnight-spanning windows, e.g. open=22:00 close=02:00.
 * A close of "00:00" is treated as end-of-day (1440 minutes).
 */
function isWithinWindow(
  currentMinute: number,
  open: string,
  close: string
): boolean {
  const openMin = toMinutes(open);
  const closeMin = close === "00:00" ? 1440 : toMinutes(close);

  if (closeMin > openMin) {
    // Normal window, e.g. 12:00 – 23:00
    return currentMinute >= openMin && currentMinute < closeMin;
  } else {
    // Midnight-spanning window, e.g. 22:00 – 02:00
    return currentMinute >= openMin || currentMinute < closeMin;
  }
}

// ─── Rule Checkers ───────────────────────────────────────────────────────────

/**
 * RULE_01_CLOSED
 * A restaurant must have at least one opening window that covers the current time.
 */
function checkClosed(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  const day = getDayName(ctx.currentTime);
  const minute = getMinuteOfDay(ctx.currentTime);
  const windows = restaurant.openingHours[day] ?? [];

  const isOpen = windows.some((w) => isWithinWindow(minute, w.open, w.close));

  if (!isOpen) {
    return {
      ruleId: "RULE_01_CLOSED",
      severity: "hard",
      restaurantId: restaurant.id,
      description: `${restaurant.name} is closed at the requested time (${day}, ${ctx.currentTime}). Opening hours for ${day}: ${
        windows.length
          ? windows.map((w) => `${w.open}–${w.close}`).join(", ")
          : "closed all day"
      }.`,
    };
  }

  return null;
}

/**
 * RULE_03_DISTANCE
 * Restaurant must be within 20 km of the user's location.
 */
function checkDistance(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  if (!ctx.userLocation) return null; // cannot check — flow rule in prompt handles asking

  const distance = restaurant.distanceKm[ctx.userLocation];

  if (distance === undefined) {
    // No distance data for this location — log as soft rather than hard-block
    return {
      ruleId: "RULE_03_DISTANCE",
      severity: "soft",
      restaurantId: restaurant.id,
      description: `No distance data for ${restaurant.name} from ${ctx.userLocation}. Cannot verify 20 km rule.`,
    };
  }

  if (distance > 20) {
    return {
      ruleId: "RULE_03_DISTANCE",
      severity: "hard",
      restaurantId: restaurant.id,
      description: `${restaurant.name} is ${distance} km from ${ctx.userLocation}, exceeding the 20 km limit.`,
    };
  }

  return null;
}

/**
 * RULE_04_ALLERGY
 * No recommended restaurant may contain any of the user's stated allergens.
 * Safety-critical — case-insensitive comparison, no exceptions.
 */
function checkAllergy(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  if (!ctx.allergies.length) return null;

  const userAllergens = ctx.allergies.map((a) => a.toLowerCase());
  const restaurantAllergens = restaurant.allergens.map((a) => a.toLowerCase());

  const hits = restaurantAllergens.filter((a) => userAllergens.includes(a));

  if (hits.length > 0) {
    return {
      ruleId: "RULE_04_ALLERGY",
      severity: "hard",
      restaurantId: restaurant.id,
      description: `${restaurant.name} contains allergens that match user restrictions: ${hits.join(", ")}. User allergies: ${ctx.allergies.join(", ")}.`,
    };
  }

  return null;
}

/**
 * RULE_06_BUDGET
 * Per-person price must not exceed the user's stated budget.
 */
function checkBudget(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  if (ctx.budget === null) return null;

  if (restaurant.pricePerPersonAed > ctx.budget) {
    return {
      ruleId: "RULE_06_BUDGET",
      severity: "hard",
      restaurantId: restaurant.id,
      description: `${restaurant.name} costs AED ${restaurant.pricePerPersonAed}/person, exceeding the budget of AED ${ctx.budget}/person.`,
    };
  }

  return null;
}

// ─── Soft Guideline Checkers ─────────────────────────────────────────────────

/**
 * RULE_07_AMBIANCE (soft)
 * For romantic occasions, ambiance rating should be ≥ 4.0.
 */
function checkAmbiance(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  const isRomantic =
    ctx.occasion?.toLowerCase().includes("romantic") ||
    ctx.occasion?.toLowerCase().includes("anniversary") ||
    ctx.occasion?.toLowerCase().includes("date");

  if (isRomantic && restaurant.ambianceRating < 4.0) {
    return {
      ruleId: "RULE_07_AMBIANCE",
      severity: "soft",
      restaurantId: restaurant.id,
      description: `${restaurant.name} has ambiance rating ${restaurant.ambianceRating} (below 4.0) for a romantic occasion.`,
    };
  }

  return null;
}

/**
 * RULE_11_RATING (soft)
 * Warn if restaurant rating < 4.0.
 */
function checkRating(
  restaurant: Restaurant,
  _ctx: ConversationContext
): Violation | null {
  if (restaurant.rating < 4.0) {
    return {
      ruleId: "RULE_11_RATING",
      severity: "soft",
      restaurantId: restaurant.id,
      description: `${restaurant.name} has a rating of ${restaurant.rating}, which is below 4.0.`,
    };
  }

  return null;
}

/**
 * RULE_05_DUPLICATE (soft)
 * Warn if a restaurant was already recommended in this session.
 */
function checkDuplicate(
  restaurant: Restaurant,
  ctx: ConversationContext
): Violation | null {
  if (ctx.recommendedRestaurantsInSession.includes(restaurant.id)) {
    return {
      ruleId: "RULE_05_DUPLICATE",
      severity: "soft",
      restaurantId: restaurant.id,
      description: `${restaurant.name} was already recommended earlier in this session.`,
    };
  }

  return null;
}

// ─── Main Validator ──────────────────────────────────────────────────────────

const HARD_RULES = [checkClosed, checkDistance, checkAllergy, checkBudget];
const SOFT_RULES = [checkAmbiance, checkRating, checkDuplicate];

const ALL_RULE_IDS = [
  "RULE_01_CLOSED",
  "RULE_03_DISTANCE",
  "RULE_04_ALLERGY",
  "RULE_06_BUDGET",
  "RULE_05_DUPLICATE",
  "RULE_07_AMBIANCE",
  "RULE_11_RATING",
];

export function validate(input: ValidationInput): ValidationResult {
  const { extractedRecommendations: restaurants, conversationContext: ctx } = input;

  const hardViolations: Violation[] = [];
  const softViolations: Violation[] = [];

  for (const restaurant of restaurants) {
    for (const checker of HARD_RULES) {
      const v = checker(restaurant, ctx);
      if (v) hardViolations.push(v);
    }

    for (const checker of SOFT_RULES) {
      const v = checker(restaurant, ctx);
      if (v) softViolations.push(v);
    }
  }

  if (hardViolations.length > 0) {
    return {
      valid: false,
      violations: hardViolations,
      softViolations,
    };
  }

  return { valid: true, softViolations };
}

export { ALL_RULE_IDS };
