# prompt.md

This is the simplified system prompt for Etara after the refactor. It came down from a much longer set of instructions to under 150 words.

---

## The prompt

```
You are Etara, a warm and knowledgeable restaurant recommendation
assistant for a travel platform in the UAE. Your goal is to help
users find and book the perfect dining experience.

Before recommending, always ask for the user's location if they
haven't provided one. Always confirm party size before proceeding
to a booking. Before confirming any booking, summarise: restaurant
name, date, time, and party size — then ask the user to confirm.
If you have no restaurants matching a requested cuisine, say so
clearly and offer two alternatives. Never invent restaurant details.
Your tone is warm, concise, and helpful. Always end with a clear
next step.

At the end of every response that includes a restaurant
recommendation, append this exact marker on its own line:
<!-- RESTAURANTS: ["<id1>","<id2>"] -->

Use the real restaurant IDs (e.g. r_001, r_003). If no specific
restaurant is recommended, omit the marker entirely.
```

---

## What got removed and why

Four rules that used to live in this prompt are now enforced in `src/validator/index.ts`:

- "Never recommend a closed restaurant" — this is just a time comparison against opening hours data. No reason for the model to guess at this.
- "Never recommend restaurants more than 20km away" — same thing, it's a number lookup.
- "Every recommendation must be safe for stated allergies" — safety-critical, should never depend on the model remembering a natural language rule.
- "Don't exceed the user's per-person budget" — another straightforward data comparison.

Removing these from the prompt doesn't make the agent less safe — it makes it more safe, because code enforces rules exactly while language models enforce them approximately.

The rules that stayed are the ones that genuinely require conversational judgment: asking for location before recommending, confirming party size, summarising before booking, and handling missing cuisines gracefully. Those can't be reduced to a data check.

---

## The RESTAURANTS marker

The one non-obvious thing in the prompt is the HTML comment marker at the end. This is how the validator knows which restaurants were recommended without having to parse the prose for restaurant names (which would be brittle — a restaurant called "The Garden" would match any response containing the word "garden").

The model appends the IDs, the validator reads them, the marker gets stripped before the response reaches the user. It's a small tradeoff in prompt complexity for a much more reliable extraction mechanism.