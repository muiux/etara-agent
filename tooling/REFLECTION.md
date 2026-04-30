# REFLECTION.md

Some notes on the decisions made during this refactor and the tradeoffs involved.

---

## Why structured output instead of string matching

The validator needs to know which restaurants the LLM recommended so it can run the checks. The obvious approach is to scan the prose for restaurant names. The problem is that it's surprisingly unreliable.

A restaurant called "The Garden" will match any response that contains the word "garden." A restaurant named "Al Fanar Restaurant & Café" might appear as just "Al Fanar" in the response, or "the Al Fanar place," or not match at all if the model paraphrases. You end up writing increasingly complicated regex patterns and still getting false positives.

The alternative — asking the model to append a structured marker with the exact restaurant IDs — is cleaner. The validator gets a deterministic list, no guessing involved. The tradeoff is that the prompt has to carry that instruction, and if the model ever forgets to include the marker, the validator can't check anything. In practice that's a minor risk: the instruction is short and clear, and a missing marker just means the response passes unchecked rather than crashing.

For a production system you'd want to monitor for marker-absent responses. For this project it's an acceptable tradeoff.

---

## Why re-prompt instead of just substituting a safe response

When a hard violation is detected, there are a few ways to handle it:

1. Return a canned "sorry, I couldn't find anything suitable" message
2. Automatically pick the nearest compliant restaurant from the dataset
3. Re-prompt the LLM, telling it specifically what went wrong

Option 1 is unhelpful. Option 2 ignores all the conversational context the model has — the user's mood, what they've already said, what alternatives might actually appeal to them. Option 3 is slower (another API call) but produces a much better response because the model can compose something natural and contextually appropriate.

The correction instruction names the specific restaurant and rule — "Al Fanar contains nuts and the user has a nut allergy" — so the model understands exactly what to avoid without needing to re-reason from scratch.

---

## The hard vs. soft line

A few of these calls were less obvious than others.

**Rule 5 (no duplicate recommendations)** ended up soft because the user might explicitly ask to revisit somewhere. If someone says "actually, let's just go back to Hoshi," the right behaviour is to comply, not refuse. So the validator logs the repeat and lets the model handle it.

**Rule 7 (romantic ambiance)** is soft because "romantic" isn't a binary attribute of a restaurant — it's a relationship between the restaurant and the couple's preferences. A 3.8-ambiance place might be exactly right for a particular pair. Worth flagging, not worth blocking.

**Rule 11 (low rating warning)** is soft because the rule says "warn," not "block." The model should mention that a restaurant has a below-average rating, but whether to still recommend it depends on context — maybe it's the only option that fits the cuisine, location, and budget. That judgment call belongs with the model.

---

## Known limitations

**No retry loop on correction.** Right now if the corrected response also contains a violation, it goes through unchecked. A production version should validate the corrected response too, with a retry limit of 2–3 attempts before falling back to a safe default.

**Static restaurant data.** The restaurants live in a TypeScript file. In a real system this would come from a database, with live updates to opening hours and pricing.

**Rule 10 not implemented.** The "no repeated cuisine type more than twice in a row" rule is classified as a soft guideline but isn't wired up yet. The session history tracking is already in the context object, so it wouldn't be a big addition.

**Marker dependency.** As mentioned above, if the model omits the `<!-- RESTAURANTS: [...] -->` marker, validation is skipped. This should be monitored in production.

---

## What the refactor actually achieved

The prompt went from a long list of rules to under 150 words of intent and tone. The rules that moved to code are now testable — you can write a unit test that proves a nut allergy violation fires correctly, run it in CI, and know with certainty that the check works. You couldn't do that before. The rules that stayed in the prompt are the ones that genuinely need conversational judgment, which is what the model is actually good at.

The split isn't about distrust of the model. It's about using the right tool for each job.