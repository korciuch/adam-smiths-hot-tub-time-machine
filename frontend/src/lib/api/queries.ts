/**
 * Server-side read helpers.
 *
 * These never throw. The backend is a separate service that can be down or
 * still seeding, and a dashboard that 500s because one panel's data is missing
 * is worse than one that renders the rest and says so. Callers get a tagged
 * result and decide how to degrade.
 */
import { api } from './client'
import type { paths } from './schema'
import type { Company, Note, Price, Quote } from './types'

/**
 * Query objects are annotated with the generated parameter types rather than
 * passed inline. openapi-fetch's generics widen an inline literal enough that a
 * stale key slips through unchecked, and a silently ignored date filter is the
 * kind of bug that looks like a backend problem for an hour.
 */
type PricesQuery = NonNullable<paths['/prices']['get']['parameters']['query']>
type QuotesQuery = NonNullable<paths['/quotes/latest']['get']['parameters']['query']>
type NotesQuery = NonNullable<paths['/notes']['get']['parameters']['query']>

export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string }

/** Cache tag for everything notes-related, revalidated by the note actions. */
export const NOTES_TAG = 'notes'

/**
 * How long the UI may lag the database, not how often the underlying facts
 * change. Constituents and daily closes both move rarely, but ingestion is what
 * populates them, so a long window means a backfill appears to have done
 * nothing. Shared by companies, prices and quotes so the table's companies and
 * quotes can't expire at different times and show rows with no price. Notes are
 * tag-revalidated instead, because their writes go through this app.
 */
const STALE_SECONDS = 60

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof Error) {
    // `fetch` failing to connect surfaces as an opaque "fetch failed".
    const isConnectionRefused = error.cause !== undefined
    return {
      ok: false,
      error: isConnectionRefused
        ? 'Cannot reach the backend API.'
        : error.message,
    }
  }
  return { ok: false, error: 'Request to the backend API failed.' }
}

export async function getCompanies(): Promise<Fetched<Company[]>> {
  try {
    const { data, error } = await api.GET('/companies', {
      next: { revalidate: STALE_SECONDS },
    })
    if (error || !data) return { ok: false, error: 'Could not load companies.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}

export async function getPrices(
  ticker: string,
  range?: { from?: string; to?: string },
): Promise<Fetched<Price[]>> {
  const query: PricesQuery = {
    ticker,
    from: range?.from,
    to: range?.to,
  }

  try {
    const { data, error, response } = await api.GET('/prices', {
      params: { query },
      next: { revalidate: STALE_SECONDS },
    })
    if (response.status === 404) {
      return { ok: false, error: `Unknown ticker: ${ticker}` }
    }
    if (error || !data) return { ok: false, error: `Could not load prices for ${ticker}.` }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}

export async function getLatestQuotes(tickers: string[]): Promise<Fetched<Quote[]>> {
  if (tickers.length === 0) return { ok: true, data: [] }

  const query: QuotesQuery = { tickers: tickers.join(',') }
  try {
    const { data, error } = await api.GET('/quotes/latest', {
      params: { query },
      next: { revalidate: STALE_SECONDS },
    })
    if (error || !data) return { ok: false, error: 'Could not load latest quotes.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}

export async function getNotes(companyId?: number): Promise<Fetched<Note[]>> {
  const query: NotesQuery = { company_id: companyId }
  try {
    const { data, error } = await api.GET('/notes', {
      params: { query },
      next: { tags: [NOTES_TAG] },
    })
    if (error || !data) return { ok: false, error: 'Could not load notes.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}
