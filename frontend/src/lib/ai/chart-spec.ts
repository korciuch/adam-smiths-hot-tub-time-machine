/**
 * The AI contract's chart hint.
 *
 * `POST /ai/query` returns `chart_spec` as an untyped object, because the
 * backend cannot know what the model will emit. This module is the frontend's
 * half of that contract: one narrow shape, validated at runtime. Anything that
 * does not match is dropped and the answer renders with a table instead - a
 * malformed hint must never break the panel.
 *
 * The shape, for the backend and the prompt that produces it:
 *
 *   {
 *     "kind": "line" | "bar",
 *     "x": "<key in each `data` row for the category or date>",
 *     "series": [{ "key": "<numeric key in each row>", "label": "<optional>" }],
 *     "title": "<optional>",
 *     "y_label": "<optional>"
 *   }
 *
 * Constraints that are enforced here, so the prompt should state them:
 * - `x` and every `series[].key` must exist in the rows of `data`.
 * - Series values must be numbers, or null for a gap.
 * - At most 8 series. A ninth would need a ninth categorical color, which does
 *   not exist; extra series are dropped rather than recolored.
 * - `kind: "line"` implies `x` is ordered (dates ascending). Unordered
 *   categories must use `"bar"`.
 */

import { MAX_SERIES } from '../series'

export type ChartSpecSeries = { key: string; label: string }

export type ChartSpec = {
  kind: 'line' | 'bar'
  x: string
  series: ChartSpecSeries[]
  title?: string
  yLabel?: string
}

export type AiRow = Record<string, unknown>

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Returns null when the spec is unusable against `rows`. Callers fall back to
 * rendering the data as a plain table.
 */
export function parseChartSpec(value: unknown, rows: AiRow[]): ChartSpec | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  if (rows.length === 0) return null

  const spec = value as Record<string, unknown>

  const kind = spec.kind === 'bar' ? 'bar' : spec.kind === 'line' ? 'line' : null
  if (!kind) return null

  const x = asString(spec.x)
  if (!x) return null

  // The key has to be present in the data we were actually given.
  const keys = new Set(rows.flatMap((row) => Object.keys(row)))
  if (!keys.has(x)) return null

  const rawSeries = Array.isArray(spec.series) ? spec.series : []
  const series: ChartSpecSeries[] = []
  for (const entry of rawSeries) {
    if (typeof entry !== 'object' || entry === null) continue
    const key = asString((entry as Record<string, unknown>).key)
    if (!key || key === x || !keys.has(key)) continue
    if (series.some((existing) => existing.key === key)) continue
    // A numeric column is a series; a stringly one is a label the chart cannot plot.
    const numeric = rows.some((row) => typeof row[key] === 'number')
    if (!numeric) continue
    series.push({
      key,
      label: asString((entry as Record<string, unknown>).label) ?? key,
    })
    if (series.length === MAX_SERIES) break
  }
  if (series.length === 0) return null

  return {
    kind,
    x,
    series,
    title: asString(spec.title),
    yLabel: asString(spec.y_label) ?? asString(spec.yLabel),
  }
}

/** Row values coerced to the shape the mini chart plots. */
export function toPlotRows(spec: ChartSpec, rows: AiRow[]) {
  return rows.map((row) => ({
    label: String(row[spec.x] ?? ''),
    values: spec.series.map((entry) => {
      const value = row[entry.key]
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }),
  }))
}
