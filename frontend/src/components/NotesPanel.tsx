'use client'

import { useMemo, useState, useTransition } from 'react'

import { createNote, deleteNote, updateNote } from '@/app/actions'
import type { Company, Note } from '@/lib/api/types'

type Props = {
  notes: Note[]
  companies: Company[]
  /** Currently charted tickers, used to preselect the company and to scope the list. */
  selectedTickers: string[]
  colorFor: (ticker: string) => string | null
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The note actions call `updateTag('notes')`, which re-renders this panel's
 * server parent in the action's own response - so the list updates without a
 * client-side refetch and without local optimistic state to reconcile.
 */
export function NotesPanel({ notes, companies, selectedTickers, colorFor }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [companyId, setCompanyId] = useState<string>('')
  const [date, setDate] = useState(today)
  const [text, setText] = useState('')

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editDate, setEditDate] = useState('')

  const [scopeToSelection, setScopeToSelection] = useState(false)

  const companyById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  )

  const selectedIds = useMemo(() => {
    const tickers = new Set(selectedTickers)
    return new Set(
      companies.filter((company) => tickers.has(company.ticker)).map((c) => c.id),
    )
  }, [companies, selectedTickers])

  const visible = useMemo(() => {
    const list = scopeToSelection
      ? notes.filter((note) => note.company_id !== null && note.company_id !== undefined && selectedIds.has(note.company_id))
      : notes
    // Newest first, undated notes last.
    return [...list].sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date)
      if (a.date && !b.date) return -1
      if (!a.date && b.date) return 1
      return b.created_at.localeCompare(a.created_at)
    })
  }, [notes, scopeToSelection, selectedIds])

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong.')
        return
      }
      onDone?.()
    })
  }

  function submit() {
    if (!text.trim()) {
      setError('Note text cannot be empty.')
      return
    }
    run(
      () =>
        createNote({
          text,
          date: date || null,
          company_id: companyId ? Number(companyId) : null,
        }),
      () => {
        setText('')
      },
    )
  }

  function startEdit(note: Note) {
    setEditingId(note.id)
    setEditText(note.text)
    setEditDate(note.date ?? '')
    setError(null)
  }

  function saveEdit(note: Note) {
    run(
      () => updateNote(note.id, { text: editText, date: editDate || null }),
      () => setEditingId(null),
    )
  }

  return (
    <section className="flex flex-col rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
      <header className="flex items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="mr-auto text-sm font-semibold">
          Notes
          <span className="ml-2 font-normal text-[var(--text-secondary)]">
            {visible.length}
          </span>
        </h2>
        {selectedTickers.length > 0 && (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={scopeToSelection}
              onChange={(event) => setScopeToSelection(event.target.checked)}
            />
            Charted only
          </label>
        )}
      </header>

      <form
        className="flex flex-col gap-2 border-b border-[var(--hairline)] px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-wrap gap-2">
          <select
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            aria-label="Company"
            className="h-8 min-w-40 flex-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2 text-sm"
          >
            <option value="">No company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.ticker} — {company.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Date"
            className="h-8 rounded border border-[var(--hairline)] bg-transparent px-2 text-sm tnum"
          />
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="What happened on this date?"
          rows={3}
          aria-label="Note text"
          className="resize-y rounded border border-[var(--hairline)] bg-transparent p-2 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--series-1)] focus:outline-none"
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="h-8 rounded bg-[var(--series-1)] px-3 text-sm font-medium text-white disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Add note'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-[var(--status-critical)]">
              {error}
            </p>
          )}
        </div>
      </form>

      <ul className="max-h-96 divide-y divide-[var(--hairline)] overflow-y-auto">
        {visible.map((note) => {
          const company =
            note.company_id !== null && note.company_id !== undefined
              ? companyById.get(note.company_id)
              : undefined
          const color = company ? colorFor(company.ticker) : null

          return (
            <li key={note.id} className="px-4 py-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                {company ? (
                  <span className="flex items-center gap-1.5">
                    {color && (
                      <span
                        aria-hidden
                        className="size-[8px] rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <span className="font-mono font-medium text-[var(--text-primary)]">
                      {company.ticker}
                    </span>
                  </span>
                ) : (
                  <span className="italic">General</span>
                )}
                {note.date && <span className="tnum">{note.date}</span>}

                <span className="ml-auto flex gap-2">
                  {editingId === note.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveEdit(note)}
                        disabled={pending}
                        className="hover:text-[var(--text-primary)] disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        className="hover:text-[var(--text-primary)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => run(() => deleteNote(note.id))}
                        disabled={pending}
                        className="hover:text-[var(--status-critical)] disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </div>

              {editingId === note.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(event) => setEditDate(event.target.value)}
                    aria-label="Note date"
                    className="h-8 w-40 rounded border border-[var(--hairline)] bg-transparent px-2 text-sm tnum"
                  />
                  <textarea
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    rows={3}
                    aria-label="Note text"
                    className="resize-y rounded border border-[var(--hairline)] bg-transparent p-2 text-sm focus:border-[var(--series-1)] focus:outline-none"
                  />
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{note.text}</p>
              )}
            </li>
          )
        })}

        {visible.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
            {scopeToSelection
              ? 'No notes on the charted companies yet.'
              : 'No notes yet. Dated notes appear as markers on the chart.'}
          </li>
        )}
      </ul>
    </section>
  )
}
