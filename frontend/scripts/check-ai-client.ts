/**
 * Checks the client-side AI logic that has no server involvement: chart
 * inference, SQL extraction, and the silent-failure lint.
 *
 * Run with `npm run check:ai`. Kept as a script rather than a test suite
 * because the project has no test runner configured yet.
 */

import { inferChart } from '../src/lib/ai/infer-chart'
import { extractSql, lintSql } from '../src/lib/ai/sql-text'

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`)
    failures += 1
  }
}

console.log('== extractSql ==')
check(
  'strips ```sql fences',
  extractSql('```sql\nSELECT 1 FROM companies\n```') === 'SELECT 1 FROM companies',
  extractSql('```sql\nSELECT 1 FROM companies\n```'),
)
check(
  'drops preamble prose',
  extractSql("Here is the query:\nSELECT ticker FROM companies") === 'SELECT ticker FROM companies',
  extractSql("Here is the query:\nSELECT ticker FROM companies"),
)
check(
  'drops trailing explanation after semicolon',
  extractSql('SELECT ticker FROM companies; -- this lists them') === 'SELECT ticker FROM companies',
  extractSql('SELECT ticker FROM companies; -- this lists them'),
)
check('keeps a CTE', extractSql('WITH x AS (SELECT 1) SELECT * FROM x').startsWith('WITH'))

console.log('\n== lintSql (silent failures) ==')
check('catches company_id = string', lintSql("SELECT date FROM prices WHERE company_id = 'AAPL'") !== null)
check('catches p.company_id = string', lintSql("SELECT date FROM prices p WHERE p.company_id = 'AAPL'") !== null)
check('catches company_id IN (strings)', lintSql("SELECT * FROM prices WHERE company_id IN ('AAPL','MSFT')") !== null)
check('allows integer comparison', lintSql('SELECT * FROM prices WHERE company_id = 42') === null)
check(
  'allows the correct join',
  lintSql("SELECT p.date FROM prices p JOIN companies c ON c.id = p.company_id WHERE c.ticker = 'AAPL'") === null,
)

console.log('\n== inferChart ==')

// One row per ticker per day - the "compare AAPL and MSFT" shape.
const long = inferChart(
  ['date', 'ticker', 'close'],
  [
    { date: '2026-09-02', ticker: 'AAPL', close: 324.9 },
    { date: '2026-09-02', ticker: 'MSFT', close: 496.8 },
    { date: '2026-09-03', ticker: 'AAPL', close: 327.9 },
    { date: '2026-09-03', ticker: 'MSFT', close: 510.6 },
  ],
)
check('long format pivots to one series per ticker', long?.spec.series.length === 2, JSON.stringify(long?.spec))
check('pivoted x is the date', long?.spec.x === 'date')
check('pivoted line chart', long?.spec.kind === 'line')
check('pivoted rows collapse to one per date', long?.rows.length === 2, `${long?.rows.length}`)
check(
  'pivoted series are the tickers',
  long?.spec.series.map((s) => s.key).join(',') === 'AAPL,MSFT',
  long?.spec.series.map((s) => s.key).join(','),
)

// Single ticker history - already wide, must not pivot.
const wide = inferChart(
  ['date', 'close'],
  [
    { date: '2026-09-01', close: 325.1 },
    { date: '2026-09-02', close: 324.9 },
    { date: '2026-09-03', close: 327.9 },
  ],
)
check('single series history is a line', wide?.spec.kind === 'line' && wide?.spec.series.length === 1)
check('unsorted dates get sorted ascending', (() => {
  const out = inferChart(
    ['date', 'close'],
    [
      { date: '2026-09-03', close: 327.9 },
      { date: '2026-09-01', close: 325.1 },
      { date: '2026-09-02', close: 324.9 },
    ],
  )
  return out?.rows.map((r) => r.date).join(',') === '2026-09-01,2026-09-02,2026-09-03'
})())

// Ranking - unordered categories must be a bar, per chart-spec's contract.
const ranking = inferChart(
  ['ticker', 'name', 'lowest_close'],
  [
    { ticker: 'AMZN', name: 'Amazon', lowest_close: 1.61 },
    { ticker: 'AMD', name: 'Advanced Micro Devices', lowest_close: 1.62 },
    { ticker: 'APH', name: 'Amphenol', lowest_close: 2.37 },
  ],
)
check('ranking is a bar chart', ranking?.spec.kind === 'bar', JSON.stringify(ranking?.spec))
check('ranking x is the first non-numeric column', ranking?.spec.x === 'ticker', ranking?.spec.x)
check('ranking plots the measure', ranking?.spec.series[0]?.key === 'lowest_close')
check('ranking preserves SQL order', ranking?.rows[0]?.ticker === 'AMZN')

check('single row is not charted', inferChart(['ticker', 'close'], [{ ticker: 'AAPL', close: 1 }]) === null)
check('no numeric column is not charted', inferChart(
  ['ticker', 'name'],
  [{ ticker: 'AAPL', name: 'Apple' }, { ticker: 'MSFT', name: 'Microsoft' }],
) === null)

const manyCategories = inferChart(
  ['date', 'ticker', 'close'],
  Array.from({ length: 20 }, (_, index) => ({
    date: `2026-09-0${(index % 2) + 1}`,
    ticker: `T${index % 10}`,
    close: index,
  })),
)
check(
  'more categories than colour slots does not pivot into 10 series',
  (manyCategories?.spec.series.length ?? 0) <= 8,
  JSON.stringify(manyCategories?.spec.series.length),
)

console.log(failures ? `\nFAILURES: ${failures}` : '\nall checks passed')
process.exit(failures ? 1 : 0)
