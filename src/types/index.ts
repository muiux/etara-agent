// ─── Core Data Types ────────────────────────────────────────────────────────

export type OpeningWindow = {
  open: string;  // "HH:MM" 24h
  close: string; // "HH:MM" 24h — "00:00" means midnight end-of-day
};

export type OpeningHours = {
  [day: string]: OpeningWindow[]; // "monday", "tuesday", ... "sunday"
};

export type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  ambianceRating: number;
  pricePerPersonAed: number;
  allergens: string[];
  distanceKm: Record<string, number>; // { "Deira": 5.2, "Marina": 12.1, ... }
  openingHours: OpeningHours;
};

// ─── Validator Interface ─────────────────────────────────────────────────────

export type ConversationContext = {
  userLocation: string | null;
  partySize: number | null;
  budget: number | null;        // per person, AED
  dietaryRestrictions: string[];
  allergies: string[];
  occasion: string | null;
  currentTime: string;          // ISO 8601
  recommendedRestaurantsInSession: string[];
};

export type ValidationInput = {
  llmResponse: string;
  conversationContext: ConversationContext;
  extractedRecommendations: Restaurant[];
};

export type Violation = {
  ruleId: string;
  description: string;
  severity: "hard" | "soft";
  restaurantId?: string;
};

export type ValidationResult =
  | { valid: true; softViolations: Violation[] }
  | { valid: false; violations: Violation[]; softViolations: Violation[] };

// ─── API Response ────────────────────────────────────────────────────────────

export type AgentResponse = {
  response: string;
  _debug?: DebugInfo;
};

export type DebugInfo = {
  validationRan: boolean;
  violationsFound: number;
  correctionRequired: boolean;
  rulesChecked: string[];
  extractedRestaurants: string[];
  violations: Violation[];
  correctedResponse?: string;
};
