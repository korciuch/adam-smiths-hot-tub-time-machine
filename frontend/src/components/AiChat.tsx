'use client'

import { useCallback, useRef, useState } from 'react'

import { executeSql } from '@/app/actions'
import type { AiRow } from '@/lib/ai/chart-spec'
import type { InferredChart } from '@/lib/ai/infer-chart'
import { runQuery, type QueryProgress } from '@/lib/ai/run-query'
import { MiniChart } from './MiniChart'

/**
 * The AI panel.
 *
 * Inference runs in this tab against WebGPU; the backend only executes the SQL
 * the model writes. That makes the first question of a session expensive - the
 * weights are a multi-hundred-MB download, cached in IndexedDB afterwards - so
 * load progress is surfaced rather than hidden behind a spinner, and the model
 * is not loaded until the user actually asks something.
 */

type Turn = {
  id: number
  question: string
  status: 'running' | 'done' | 'failed'
  progress?: QueryProgress
  sql?: string
  columns: string[]
  rows: AiRow[]
  chart: InferredChart | null
  truncated: boolean
  error?: string
}

const SUGGESTIONS = [
  'Which sector has the highest average closing price?',
  'Compare AAPL and MSFT over the last year',
  'Which 5 companies had the lowest closing price on any single day?',
]

function progressLabel(progress: QueryProgress | undefined): string {
  if (!progress) return 'Starting…'
  switch (progress.stage) {
    case 'loading-model':
      return progress.load.text || 'Loading the model…'
    case 'generating':
      // Attempt 1 is the normal path and needs no explanation; a later one
      // means the previous query failed and is being corrected.
      return progress.attempt === 1
        ? 'Writing a query…'
        : `Fixing the query (attempt ${progress.attempt})…`
    case 'executing':
      return 'Running the query…'
  }
}

function DataTable({ rows }: { rows: AiRow[] }) {
  // Union of keys, in first-seen order, so a sparse row does not drop a column.
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }

  return (
    <div className="max-h-64 overflow-auto rounded border border-[var(--hairline)]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[var(--surface-1)]">
          <tr className="border-b border-[var(--hairline)]">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-2 py-1.5 text-left font-medium text-[var(--text-secondary)]"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[var(--hairline)] last:border-0">
              {columns.map((column) => {
                const value = row[column]
                const numeric = typeof value === 'number'
                return (
                  <td
                    key={column}
                    className={`px-2 py-1 ${numeric ? 'text-right tnum' : ''}`}
                  >
                    {value === null || value === undefined
                      ? '—'
                      : numeric
                        ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
                        : String(value)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The generated SQL, collapsed. Shown because the model is fallible and the
 * query is the only way to judge whether the numbers answer the question. */
function SqlDisclosure({ sql }: { sql: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
        Show SQL
      </summary>
      <pre className="mt-1 overflow-x-auto rounded border border-[var(--hairline)] bg-[var(--surface-2,var(--surface-1))] p-2 text-xs">
        <code>{sql}</code>
      </pre>
    </details>
  )
}

export function AiChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      // One question at a time: a second concurrent generation would queue on
      // the same worker and the same GPU, so it only makes both slower.
      if (!trimmed || busy) return

      const id = nextId.current++
      setQuestion('')
      setBusy(true)
      setTurns((current) => [
        ...current,
        {
          id,
          question: trimmed,
          status: 'running',
          columns: [],
          rows: [],
          chart: null,
          truncated: false,
        },
      ])

      const patch = (fields: Partial<Turn>) =>
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, ...fields } : turn)),
        )

      const outcome = await runQuery(trimmed, executeSql, (progress) => patch({ progress }))

      if (outcome.ok) {
        patch({
          status: 'done',
          sql: outcome.sql,
          columns: outcome.columns,
          rows: outcome.rows,
          chart: outcome.chart,
          truncated: outcome.truncated,
          progress: undefined,
        })
      } else {
        patch({
          status: 'failed',
          sql: outcome.sql,
          error: outcome.error,
          progress: undefined,
        })
      }

      setBusy(false)
    },
    [busy],
  )

  return (
    <section className="flex flex-col rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
      <header className="border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="text-sm font-semibold">Ask about the data</h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">
              Questions are turned into SQL by a model running in this browser, then run
              against the price history. The first question downloads the model, which
              takes a minute.
            </p>
            <ul className="flex flex-col items-start gap-1">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="text-left text-sm text-[var(--series-1)] hover:underline"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {turns.map((turn) => (
          <article key={turn.id} className="space-y-2">
            <p className="text-sm font-medium">{turn.question}</p>

            {turn.status === 'running' && (
              <div className="space-y-1">
                <p className="text-sm text-[var(--text-secondary)]">
                  {progressLabel(turn.progress)}
                </p>
                {turn.progress?.stage === 'loading-model' && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(turn.progress.load.progress * 100)}
                    className="h-1 w-full overflow-hidden rounded bg-[var(--hairline)]"
                  >
                    <div
                      className="h-full bg-[var(--series-1)] transition-[width]"
                      style={{ width: `${Math.round(turn.progress.load.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {turn.status === 'failed' && (
              <>
                <p role="alert" className="text-sm text-[var(--status-critical)]">
                  {turn.error}
                </p>
                {turn.sql && <SqlDisclosure sql={turn.sql} />}
              </>
            )}

            {turn.status === 'done' && (
              <>
                {turn.rows.length === 0 ? (
                  <p className="text-sm text-[var(--text-secondary)]">
                    The query ran but matched no rows.
                  </p>
                ) : (
                  <>
                    {turn.truncated && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Showing the first {turn.rows.length} rows; the query matched more.
                      </p>
                    )}
                    {turn.chart && (
                      <MiniChart spec={turn.chart.spec} rows={turn.chart.rows} />
                    )}
                    <DataTable rows={turn.rows} />
                  </>
                )}
                {turn.sql && <SqlDisclosure sql={turn.sql} />}
              </>
            )}
          </article>
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-[var(--hairline)] px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          ask(question)
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a question…"
          aria-label="Question"
          className="h-9 flex-1 rounded border border-[var(--hairline)] bg-transparent px-2 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--series-1)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="h-9 rounded bg-[var(--series-1)] px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </section>
  )
}
