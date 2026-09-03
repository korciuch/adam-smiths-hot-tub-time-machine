/**
 * Server-side read helpers.
 *
 * These never throw. The backend is a separate service that can be down or
 * still seeding, and a dashboard that 500s because one panel's data is missing
 * is worse than one that renders the rest and says so. Callers get a tagged
 * result and decide how to degrade.
 */
import { api } from './client'
import type { Company, Note, Price, Quote } from './types'

export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string }

/** Cache tag for everything notes-related, revalidated by the note actions. */
export const NOTES_TAG = 'notes'

const DAY_SECONDS = 60 * 60 * 24

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
      next: { revalidate: DAY_SECONDS },
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
  try {
    const { data, error, response } = await api.GET('/prices', {
      params: {
        query: {
          ticker,
          // The backend declares this parameter as `from_` (Python keyword
          // clash). Regenerating the schema after it gains an alias will fail
          // the build here, which is the point.
          from_: range?.from,
          to: range?.to,
        },
      },
      // Daily bars only change once a day; live movement comes over the relay.
      next: { revalidate: 3600 },
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
  try {
    const { data, error } = await api.GET('/quotes/latest', {
      params: { query: { tickers: tickers.join(',') } },
      next: { revalidate: 3600 },
    })
    if (error || !data) return { ok: false, error: 'Could not load latest quotes.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}

export async function getNotes(companyId?: number): Promise<Fetched<Note[]>> {
  try {
    const { data, error } = await api.GET('/notes', {
      params: { query: { company_id: companyId } },
      next: { tags: [NOTES_TAG] },
    })
    if (error || !data) return { ok: false, error: 'Could not load notes.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause)
  }
}
