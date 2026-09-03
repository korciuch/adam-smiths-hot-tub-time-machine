'use client'

import { useRef, useState, useTransition } from 'react'

import { askAi } from '@/app/actions'
import type { AiQueryResponse } from '@/lib/api/types'
import { parseChartSpec, type AiRow, type ChartSpec } from '@/lib/ai/chart-spec'
import { MiniChart } from './MiniChart'

type Turn = {
  id: number
  question: string
  answer?: string
  rows: AiRow[]
  spec: ChartSpec | null
  error?: string
}

const SUGGESTIONS = [
  'Which sector gained the most this month?',
  'Compare AAPL and MSFT over the last year',
  'What were the five biggest movers yesterday?',
]

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

export function AiChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [pending, startTransition] = useTransition()
  const nextId = useRef(1)

  function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return

    const id = nextId.current++
    setTurns((current) => [...current, { id, question: trimmed, rows: [], spec: null }])
    setQuestion('')

    startTransition(async () => {
      const result = await askAi(trimmed)
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, ...settle(result) } : turn)),
      )
    })
  }

  return (
    <section className="flex flex-col rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
      <header className="border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="text-sm font-semibold">Ask about the data</h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">
              Questions run against the seeded price history on the backend.
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

            {turn.error ? (
              <p role="alert" className="text-sm text-[var(--status-critical)]">
                {turn.error}
              </p>
            ) : turn.answer === undefined ? (
              <p className="text-sm text-[var(--text-secondary)]">Thinking…</p>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap text-[var(--text-secondary)]">
                  {turn.answer}
                </p>
                {turn.spec && <MiniChart spec={turn.spec} rows={turn.rows} />}
                {turn.rows.length > 0 && <DataTable rows={turn.rows} />}
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
          disabled={pending || !question.trim()}
          className="h-9 rounded bg-[var(--series-1)] px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? '…' : 'Ask'}
        </button>
      </form>
    </section>
  )
}

/** Turns an action result into the fields a turn displays. */
function settle(
  result: { ok: true; data: AiQueryResponse } | { ok: false; error: string },
): Partial<Turn> {
  if (!result.ok) return { error: result.error }

  const rows = (result.data.data ?? []) as AiRow[]
  return {
    answer: result.data.answer,
    rows,
    // A bad hint is dropped, not surfaced - the table still answers the question.
    spec: parseChartSpec(result.data.chart_spec, rows),
  }
}
