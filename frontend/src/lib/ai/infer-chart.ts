/**
 * Picking a chart for an arbitrary result set, client-side.
 *
 * Per TASKS.md the chart is chosen by a heuristic here, not asked of the model.
 * Two reasons: the models in the spike could not reliably keep a required
 * column in the SELECT list, so trusting them with a second structured
 * artifact invites a spec that references columns the query never returned;
 * and the shape of `rows` is knowable for free once they arrive.
 *
 * Output is validated through `parseChartSpec` rather than trusted - one
 * runtime gate for every spec, whatever produced it.
 */

import { MAX_SERIES } from '../series'
import { parseChartSpec, type AiRow, type ChartSpec } from './chart-spec'

/** Bars past this stop being individually readable at panel width. */
const MAX_BARS = 40

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function isNumericColumn(rows: AiRow[], column: string): boolean {
  return rows.some((row) => typeof row[column] === 'number')
}

function isDateColumn(rows: AiRow[], column: string): boolean {
  const values = rows.map((row) => row[column]).filter((value) => value != null)
  return values.length > 0 && values.every((value) => typeof value === 'string' && ISO_DATE.test(value))
}

function distinct(rows: AiRow[], column: string): string[] {
  const seen: string[] = []
  for (const row of rows) {
    const value = String(row[column] ?? '')
    if (!seen.includes(value)) seen.push(value)
  }
  return seen
}

/**
 * Reshapes long results into one series per category.
 *
 * "Compare AAPL and MSFT" naturally returns `(date, ticker, close)` - one row
 * per ticker per day. Plotted as-is that is a single `close` series zig-zagging
 * between two companies. The categorical column has to become the series
 * dimension for the chart to mean anything.
 */
function pivot(rows: AiRow[], x: string, category: string, value: string, categories: string[]) {
  const byX = new Map<string, AiRow>()
  for (const row of rows) {
    const key = String(row[x] ?? '')
    let target = byX.get(key)
    if (!target) {
      target = { [x]: row[x] }
      byX.set(key, target)
    }
    target[String(row[category] ?? '')] = row[value]
  }
  return { rows: [...byX.values()], keys: categories }
}

export type InferredChart = { spec: ChartSpec; rows: AiRow[] }

/** Returns null when the result set is not worth plotting; caller shows the table. */
export function inferChart(columns: string[], rows: AiRow[]): InferredChart | null {
  // A single row is a number, not a trend. The table says it better.
  if (rows.length < 2 || columns.length < 2) return null

  const numeric = columns.filter((column) => isNumericColumn(rows, column))
  if (numeric.length === 0) return null

  const dateColumn = columns.find((column) => isDateColumn(rows, column))
  // A date axis is ordered, so it is a line. Anything else is an unordered
  // category, which `chart-spec` requires to be a bar.
  const x = dateColumn ?? columns.find((column) => !numeric.includes(column))
  if (!x) return null
  const kind = dateColumn ? 'line' : 'bar'

  const measures = numeric.filter((column) => column !== x)
  if (measures.length === 0) return null

  const others = columns.filter((column) => column !== x && !numeric.includes(column))

  let plotRows = rows
  let seriesKeys = measures

  const categoryColumn = others[0]
  const categories = categoryColumn ? distinct(rows, categoryColumn) : []
  const shouldPivot =
    measures.length === 1 &&
    others.length === 1 &&
    categories.length > 1 &&
    categories.length <= MAX_SERIES &&
    // Only if x actually repeats - otherwise the category is just a label
    // sitting alongside one row per x, and pivoting gains nothing.
    distinct(rows, x).length < rows.length

  if (shouldPivot) {
    const pivoted = pivot(rows, x, categoryColumn, measures[0], categories)
    plotRows = pivoted.rows
    seriesKeys = pivoted.keys
  }

  if (kind === 'line') {
    // `chart-spec` documents that a line implies x ascending; ORDER BY is the
    // model's choice, so it is not assumed.
    plotRows = [...plotRows].sort((a, b) => String(a[x]).localeCompare(String(b[x])))
  } else if (plotRows.length > MAX_BARS) {
    plotRows = plotRows.slice(0, MAX_BARS)
  }

  const spec = parseChartSpec(
    {
      kind,
      x,
      series: seriesKeys.map((key) => ({ key })),
      y_label: seriesKeys.length === 1 ? seriesKeys[0] : undefined,
    },
    plotRows,
  )

  return spec ? { spec, rows: plotRows } : null
}
