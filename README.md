# Etara Restaurant Agent

A refactored LLM-powered restaurant recommendation agent for the UAE market. The main idea here is simple: instead of trusting the model to remember and follow business rules written in plain English, we pull those rules out of the prompt and enforce them in code.

The result is a system where certain violations (recommending a closed restaurant, ignoring a nut allergy) literally cannot happen — not "probably won't happen," but cannot.

---

## Background

The original agent had all its business rules crammed into the system prompt. Things like "never recommend a restaurant that's more than 20km away" or "always check for allergens." That works fine until it doesn't — the model follows natural language instructions approximately, not precisely, and there's no way to write a test that proves a rule was actually enforced.

This project refactors that. Rules that can be checked against data move into a typed validator that runs after every LLM response. The prompt shrinks down to just tone and conversation flow.

---

## How it works

The flow is straightforward:

```
User message
    ↓
LLM call (Claude Haiku)
    ↓
Validator checks the response
    ↓
Hard violation? → block + re-prompt the LLM with the specific issue
No violation?  → return response to user
```

The LLM is asked to include a small machine-readable marker at the end of any response that includes a recommendation:

```
<!-- RESTAURANTS: ["r_001", "r_004"] -->
```

The validator uses those IDs to look up the restaurants and run the checks. The marker gets stripped before the user ever sees it.

---

## Project structure

```
etara-agent/
├── src/
│   ├── types/index.ts          Type definitions
│   ├── data/restaurants.ts     Restaurant fixture data
│   ├── validator/index.ts      The guardrail layer (the main thing)
│   └── agent/
│       ├── index.ts            Orchestrates LLM → validate → correct
│       └── prompt.ts           The simplified system prompt
├── tests/
│   └── validator.test.ts       21 unit tests, no LLM calls
├── demo.ts                     Runs the 4 demo scenarios
├── GUARDRAILS.md               All 12 rules classified
├── prompt.md                   The simplified prompt + notes on what was removed
├── tooling/REFLECTION.md       Design decisions and tradeoffs
└── README.md                   You're reading it
```

---

## Setup

You'll need Node.js 18 or higher. Check with:

```bash
node --version
```

Then install dependencies:

```bash
npm install
```

If you want to use the live LLM (not required for tests or demo), set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get a key at [console.anthropic.com](https://console.anthropic.com) if you don't have one.

---

## Running things

**Tests** — no API key needed, everything is stubbed:

```bash
npm test
```

Should give you 21 passed, 0 failed.

**Demo** — runs all 4 violation scenarios with stubbed LLM responses:

```bash
npm run demo
```

Again, no API key needed. Each scenario forces a specific rule violation and shows the validator catching and correcting it.

**Type check** — just verifies the TypeScript compiles cleanly:

```bash
npm run typecheck
```

---

## The four hard rules

These are enforced in code and cannot be bypassed:

| Rule | What it checks |
|------|----------------|
| `RULE_01_CLOSED` | Is the restaurant actually open right now? |
| `RULE_03_DISTANCE` | Is it within 20km of where the user is? |
| `RULE_04_ALLERGY` | Does the menu contain any of the user's allergens? |
| `RULE_06_BUDGET` | Does the price fit within the user's per-person budget? |

When any of these fire, the original response is blocked and the LLM gets re-prompted with the specific issue — e.g. "Al Fanar contains nuts and the user has a nut allergy, please suggest something else." The model then writes a corrected response with that context.

There are also soft guidelines (duplicate recommendations, low ambiance for romantic occasions, low ratings) that get logged but don't block anything. The user might still want that restaurant.

---

## What stayed in the prompt

Three rules are still in the system prompt because they're about conversation flow, not data:

- Confirm party size before booking
- Summarise booking details before confirming
- If no matching cuisine exists, say so and offer alternatives

You can't validate these from a single response snapshot — they only make sense across multiple turns.

---

## Demo scenarios

Each one stubs the LLM to return a deliberately bad recommendation, then shows the validator intercepting it:

1. **Scenario 1** — User wants dinner at 4am. LLM recommends Casa Lupo (closes at 10pm). Blocked.
2. **Scenario 2** — User is in Deira. LLM recommends Trattoria Lucia (32km away). Blocked.
3. **Scenario 3** — User has a nut allergy. LLM recommends Al Fanar (contains nuts). Blocked.
4. **Scenario 4** — User's budget is AED 100. LLM recommends Hoshi Omakase (AED 450). Blocked.

---

## Notes

The validator is completely independent of the LLM — it's just a function that takes structured input and returns pass/fail. That's intentional. It means you can test it exhaustively without mocking anything, and it means a bug in the validator is always a code bug, never a prompt tuning problem.

See `tooling/REFLECTION.md` for a longer discussion of the design decisions, including why structured output was chosen over string matching and how the corrective re-prompt loop works.