/**
 * Cleanup for raw model output.
 *
 * Small instruction-tuned models ignore "no markdown fences" a good fraction
 * of the time, and often prepend a sentence. The backend would reject the
 * result as unparseable, burning a retry on a formatting slip rather than a
 * semantic one - so the obvious wrappers are stripped client-side first.
 */

/**
 * An integer id column compared against a quoted string.
 *
 * This is the exact 1B failure in `MODEL_FINDINGS.md` (`company_id = 'AAPL'`),
 * and it has to be caught before execution because SQLite does not error on
 * it - the comparison simply matches nothing. The endpoint returns zero rows
 * and `error: null`, so the correction loop, which keys off the driver error,
 * would never fire. A wrong answer that looks like "no data" is worse than a
 * failure, so this is checked client-side instead.
 */
const ID_COMPARED_TO_STRING = /\b(?:\w+\.)?(?:company_id|id)\s*(?:=|!=|<>|\bIN\b)\s*\(?\s*'/i

/**
 * Returns a correction hint if the SQL is recognisably wrong, else null.
 *
 * Only for mistakes that execute cleanly and silently return nothing. Anything
 * the database itself rejects needs no lint - the driver's message is a better
 * hint than one written here.
 */
export function lintSql(sql: string): string | null {
  if (ID_COMPARED_TO_STRING.test(sql)) {
    return (
      "company_id and id are INTEGER columns and can never equal a ticker string. " +
      "Join through companies (JOIN companies c ON c.id = p.company_id WHERE c.ticker = 'AAPL') " +
      "or use a subquery (company_id = (SELECT id FROM companies WHERE ticker = 'AAPL'))."
    )
  }
  return null
}

/** Pulls the SELECT out of whatever the model actually emitted. */
export function extractSql(raw: string): string {
  let text = raw.trim()

  // ```sql ... ``` or ``` ... ```
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()

  // Drop any preamble before the first statement keyword.
  const start = text.search(/\b(?:WITH|SELECT)\b/i)
  if (start > 0) text = text.slice(start)

  // Models frequently append a second "explanation" statement or prose after
  // the query. Everything past the first semicolon is not the query.
  const semicolon = text.indexOf(';')
  if (semicolon !== -1) text = text.slice(0, semicolon)

  return text.trim()
}
