# GUARDRAILS.md

This document goes through all 12 rules from the original Etara system prompt and explains what we decided to do with each one — move it to code, log it softly, or leave it in the prompt.

---

## The three buckets

Before getting into the rules, here's what each category means in practice:

**Hard Constraint** — the check is purely against data. Closed or open, within range or not, safe or unsafe. No judgment involved. These moved entirely into the validator and were removed from the prompt. If the LLM violates one of these, the response gets blocked.

**Soft Guideline** — technically checkable from data, but there are legitimate reasons a user might want to override it. A user might ask to see the same restaurant again, or choose a low-ambiance spot for a date because they like the food. The validator logs these violations but lets the response through.

**Flow Rule** — governs the shape of the conversation, not the content of a recommendation. Things like "confirm party size before booking" only make sense across multiple turns. There's no way to check them from a single response snapshot, so they stayed in the prompt.

---

## All 12 rules

**Rule 1 — Never recommend a closed restaurant**
Classification: Hard Constraint → `RULE_01_CLOSED`

This one was the most clear-cut. The restaurant's opening hours are structured data, the current time is known, and the check is binary. There's no scenario where "the model's judgment" adds anything useful here. Moved to code.

---

**Rule 2 — Always confirm party size before booking**
Classification: Flow Rule → stays in prompt

You can't validate this from a single response. It's about the order of turns in a conversation — did the model ask before proceeding? That requires observing multiple messages, which the validator doesn't do. Kept in the prompt.

---

**Rule 3 — Never recommend restaurants more than 20km away**
Classification: Hard Constraint → `RULE_03_DISTANCE`

Distance is a number. The limit is 20. The check is one comparison. If the user's location isn't known yet, the validator skips the check and the prompt handles asking for it first.

---

**Rule 4 — Every recommendation must be safe for stated allergies**
Classification: Hard Constraint → `RULE_04_ALLERGY`

This is the most safety-critical rule in the whole list. Allergen information is structured data, the user's restrictions are known, and the overlap check is straightforward. This absolutely cannot be left to probabilistic interpretation by a language model. Moved to code, no exceptions.

---

**Rule 5 — Never recommend the same restaurant twice**
Classification: Soft Guideline → `RULE_05_DUPLICATE` (logged)

Checkable from session history, but a user might explicitly ask to go back to somewhere they liked earlier. Blocking that would be annoying. The validator logs it so it can be monitored, but doesn't block.

---

**Rule 6 — Don't exceed the user's per-person budget**
Classification: Hard Constraint → `RULE_06_BUDGET`

Price per person is a field on every restaurant. Budget is a number from the user. One comparison. Worth noting: the check is per person, not per table — the validator doesn't multiply by party size.

---

**Rule 7 — Romantic occasions: ambiance rating should be 4.0 or above**
Classification: Soft Guideline → `RULE_07_AMBIANCE` (logged)

The ambiance rating is checkable, but "romantic" is context-dependent. Someone might still want a 3.8-rated place because it's their favourite. Logged but not blocked.

---

**Rule 8 — Summarise booking details before confirming**
Classification: Flow Rule → stays in prompt

Same reasoning as Rule 2. This is about conversation structure — did the model recap the details before asking for confirmation? Can't be checked from one response. Kept in the prompt.

---

**Rule 9 — If no matching cuisine, say so and offer alternatives**
Classification: Flow Rule → stays in prompt

This is mostly a tone and honesty guideline. It could be partially checked against the dataset (does this cuisine exist?) but the core of it — being upfront with the user — is better handled by the model. Kept in the prompt.

---

**Rule 10 — Don't repeat the same cuisine type more than twice in a row**
Classification: Soft Guideline → future implementation

Checkable from session history. Not implemented in the current version but the structure is there to add it. Logged as future work in REFLECTION.md.

---

**Rule 11 — Warn the user if a restaurant's rating is below 4.0**
Classification: Soft Guideline → `RULE_11_RATING` (logged)

The rating field is structured data, so detecting when this applies is easy. But "warn" doesn't mean "block" — the model should mention the low rating, but whether to still recommend the place depends on context. Soft logging only.

---

**Rule 12 — Respect meal period hours (breakfast, lunch, dinner)**
Classification: Hard Constraint → covered by `RULE_01_CLOSED`

If a user asks for a breakfast spot at 9pm, the restaurant's opening hours will already catch that. This is effectively a variant of Rule 1 and is handled by the same implementation.

---

## Summary

| # | Rule | Classification | Handled by |
|---|------|----------------|------------|
| 1 | No closed restaurants | Hard | `RULE_01_CLOSED` |
| 2 | Confirm party size first | Flow | Prompt |
| 3 | Max 20km distance | Hard | `RULE_03_DISTANCE` |
| 4 | Allergy safety | Hard | `RULE_04_ALLERGY` |
| 5 | No session duplicates | Soft | `RULE_05_DUPLICATE` (log) |
| 6 | Stay within budget | Hard | `RULE_06_BUDGET` |
| 7 | Romantic ambiance ≥ 4.0 | Soft | `RULE_07_AMBIANCE` (log) |
| 8 | Summarise before booking | Flow | Prompt |
| 9 | Offer alternatives if no match | Flow | Prompt |
| 10 | No cuisine repetition | Soft | Future |
| 11 | Warn on low rating | Soft | `RULE_11_RATING` (log) |
| 12 | Meal period hours | Hard | `RULE_01_CLOSED` variant |