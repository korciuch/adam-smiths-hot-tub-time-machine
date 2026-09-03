/**
 * Dashboard state lives in the URL, so a view is shareable and the back button
 * works. Shared by the server component that reads `searchParams` and the
 * client filter bar that writes them.
 *
 * Selected tickers are stored as *slots* rather than a plain list:
 *
 *   ?tickers=AAPL,,GOOG   -> slot 0 = AAPL, slot 1 free, slot 2 = GOOG
 *
 * The slot index is the categorical color slot. Storing the gap is what keeps
 * color attached to the company: dropping MSFT from `AAPL,MSFT,GOOG` must not
 * slide GOOG down a slot and repaint it. Freed slots are reused by the next
 * selection.
 */

import { MAX_SERIES } from './series'

export type TickerSlots = (string | null)[]

export type DashboardParams = {
  slots: TickerSlots
  tickers: string[]
  from?: string
  to?: string
  /** Rebase every series to 100 at the range start, for cross-company comparison. */
  normalize: boolean
}

type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(value: string | undefined) {
  return value && ISO_DATE.test(value) ? value : undefined
}

export function parseTickerSlots(value: string | undefined): TickerSlots {
  if (!value) return []
  return value
    .split(',')
    .slice(0, MAX_SERIES)
    .map((entry) => {
      const ticker = entry.trim().toUpperCase()
      return ticker === '' ? null : ticker
    })
}

export function serializeTickerSlots(slots: TickerSlots): string {
  const trimmed = [...slots]
  while (trimmed.length > 0 && trimmed.at(-1) === null) trimmed.pop()
  return trimmed.map((ticker) => ticker ?? '').join(',')
}

export function selectedTickers(slots: TickerSlots): string[] {
  return slots.filter((ticker): ticker is string => ticker !== null)
}

export function slotOf(slots: TickerSlots, ticker: string): number {
  return slots.indexOf(ticker)
}

/** No-op if already selected or all slots are taken. */
export function withTicker(slots: TickerSlots, ticker: string): TickerSlots {
  if (slots.includes(ticker)) return slots

  const next = [...slots]
  const free = next.indexOf(null)
  if (free !== -1) {
    next[free] = ticker
  } else if (next.length < MAX_SERIES) {
    next.push(ticker)
  }
  return next
}

export function withoutTicker(slots: TickerSlots, ticker: string): TickerSlots {
  const index = slots.indexOf(ticker)
  if (index === -1) return slots

  const next = [...slots]
  next[index] = null
  while (next.length > 0 && next.at(-1) === null) next.pop()
  return next
}

export function parseDashboardParams(raw: RawSearchParams): DashboardParams {
  const slots = parseTickerSlots(first(raw.tickers))
  return {
    slots,
    tickers: selectedTickers(slots),
    from: parseDate(first(raw.from)),
    to: parseDate(first(raw.to)),
    normalize: first(raw.normalize) === '1',
  }
}

export function buildSearchParams(params: {
  slots?: TickerSlots
  from?: string
  to?: string
  normalize?: boolean
}): URLSearchParams {
  const search = new URLSearchParams()

  const tickers = params.slots ? serializeTickerSlots(params.slots) : ''
  if (tickers) search.set('tickers', tickers)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.normalize) search.set('normalize', '1')

  return search
}

/** Presets for the date-range control, resolved against today. */
export const RANGE_PRESETS = [
  { label: '1M', months: 1 },
  { label: '6M', months: 6 },
  { label: 'YTD', months: null },
  { label: '1Y', months: 12 },
  { label: '5Y', months: 60 },
  { label: 'Max', months: 0 },
] as const

export function resolvePreset(label: string, today = new Date()) {
  const preset = RANGE_PRESETS.find((p) => p.label === label)
  if (!preset) return { from: undefined, to: undefined }

  const to = today.toISOString().slice(0, 10)

  if (preset.months === 0) return { from: undefined, to: undefined }
  if (preset.months === null) {
    return { from: `${today.getUTCFullYear()}-01-01`, to }
  }

  const from = new Date(today)
  from.setUTCMonth(from.getUTCMonth() - preset.months)
  return { from: from.toISOString().slice(0, 10), to }
}
