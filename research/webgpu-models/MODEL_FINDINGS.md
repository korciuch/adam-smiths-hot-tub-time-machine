# WebLLM model quality spike

Ran `tests/webllm-text-to-sql.spec.ts`: real WebGPU (Apple Metal, confirmed
via adapter info) loading real WebLLM models, generating SQL against our
actual companies/prices/notes schema. Not a rigorous benchmark - two
questions, temperature 0, one run each - but enough to sanity-check the
model-size tradeoff discussed earlier.

## Results

| Model | Weights | Load time (cold) | "Which 5 companies had lowest close" | "AAPL price history" |
|---|---|---|---|---|
| Llama-3.2-1B-Instruct-q4f16_1 | 664MB | ~15s | Wrong: sorted DESC not ASC, dropped company name entirely | Wrong: compared `company_id = 'AAPL'` directly (FK vs string) |
| Llama-3.2-3B-Instruct-q4f16_1 | ~2.2GB | ~34s | Still wrong: grouped by price value instead of company, dropped company name | Correct: used a subquery to resolve ticker -> company_id |

## Takeaways

- **3B is a real, measurable step up from 1B** on this schema - it correctly
  handled the FK/ticker resolution that 1B got wrong outright. This matches
  the earlier recommendation to default to the 3B tier when memory allows.
- **Neither model is reliable enough to trust raw output** for multi-entity
  ranking questions (both dropped the company name/ticker from the SELECT
  list despite the question needing it, and 3B's GROUP BY was semantically
  wrong). Production implementation should plan for:
  - A **validation + retry loop**: execute the generated SQL, and if it
    errors or the schema doesn't include an expected column, feed the error
    back to the model for one correction pass (WebLLM's context window is
    small but this is a short round-trip).
  - **Few-shot examples** in the system prompt showing the join pattern
    would likely help more than model size alone, worth trying before
    assuming a bigger model is required.
- Load times are workable for a one-time-per-session cost (results are
  cached in IndexedDB after first load), well within earlier estimates.

## Gotcha: Playwright's default context has a tiny IndexedDB quota
WebLLM caches weights in IndexedDB. Playwright's default (ephemeral)
browser context throws `QuotaExceededError` on models over ~1GB regardless
of actual free disk space. Fixed by using `chromium.launchPersistentContext()`
with a real temp user-data-dir instead - representative of an actual Chrome
profile, where quota scales with free disk space as normal.
