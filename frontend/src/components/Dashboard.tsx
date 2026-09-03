'use client'

import { useCallback, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Company, Note, Price, Quote } from '@/lib/api/types'
import { useTicks } from '@/lib/ticks/useTicks'
import {
  buildSearchParams,
  RANGE_PRESETS,
  resolvePreset,
  withTicker,
  withoutTicker,
  type DashboardParams,
  type TickerSlots,
} from '@/lib/url-state'
import { AiChat } from './AiChat'
import { CompanyTable } from './CompanyTable'
import { FilterBar } from './FilterBar'
import { NotesPanel } from './NotesPanel'
import { PriceChart, type ChartSeries } from './PriceChart'

type Props = {
  params: DashboardParams
  companies: Company[]
  quotes: Quote[]
  notes: Note[]
  /** Daily bars per selected ticker, fetched on the server for the active range. */
  prices: Record<string, Price[]>
  /** Per-panel failures, rendered inline rather than as a thrown error. */
  errors: string[]
}

/**
 * Owns the URL. Every filter writes `searchParams`, which re-runs the server
 * component above and returns fresh prices - so selection and range are one
 * source of truth rather than duplicated in client state.
 */
export function Dashboard({ params, companies, quotes, notes, prices, errors }: Props) {
  const router = useRouter()
  const [loading, startTransition] = useTransition()

  const { slots, tickers, from, to, normalize } = params

  const navigate = useCallback(
    (next: {
      slots?: TickerSlots
      from?: string
      to?: string
      normalize?: boolean
    }) => {
      const search = buildSearchParams({
        slots: next.slots ?? slots,
        from: 'from' in next ? next.from : from,
        to: 'to' in next ? next.to : to,
        normalize: next.normalize ?? normalize,
      })
      const query = search.toString()
      startTransition(() => {
        router.replace(query ? `/?${query}` : '/', { scroll: false })
      })
    },
    [router, slots, from, to, normalize],
  )

  const toggleTicker = useCallback(
    (ticker: string) => {
      const next = slots.includes(ticker)
        ? withoutTicker(slots, ticker)
        : withTicker(slots, ticker)
      if (next === slots) return
      navigate({ slots: next })
    },
    [slots, navigate],
  )

  /**
   * Color comes from the ticker's slot, as a CSS variable rather than a resolved
   * hex - DOM marks then follow the theme with no re-render, and the value is
   * identical on the server and the client.
   */
  const colorFor = useCallback(
    (ticker: string) => {
      const slot = slots.indexOf(ticker)
      return slot === -1 ? null : `var(--series-${slot + 1})`
    },
    [slots],
  )

  const { ticks, status } = useTicks(tickers)

  const series = useMemo<ChartSeries[]>(() => {
    return slots.flatMap((ticker, slot) =>
      ticker && prices[ticker]?.length ? [{ ticker, slot, prices: prices[ticker] }] : [],
    )
  }, [slots, prices])

  const companyIdToTicker = useMemo(
    () => new Map(companies.map((company) => [company.id, company.ticker])),
    [companies],
  )

  // Which preset the current range corresponds to, so the row can show it as active.
  const activePreset = useMemo(() => {
    const match = RANGE_PRESETS.find((preset) => {
      const resolved = resolvePreset(preset.label)
      return resolved.from === from && resolved.to === to
    })
    return match?.label ?? null
  }, [from, to])

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        slots={slots}
        from={from}
        to={to}
        activePreset={activePreset}
        status={status}
        loading={loading}
        colorFor={colorFor}
        onRange={(range) => navigate({ from: range.from, to: range.to })}
        onRemoveTicker={(ticker) => navigate({ slots: withoutTicker(slots, ticker) })}
        onClearTickers={() => navigate({ slots: [] })}
      />

      {errors.length > 0 && (
        <ul
          role="alert"
          className="rounded-lg border border-[var(--status-serious)] px-4 py-2.5 text-sm"
        >
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <PriceChart
        series={series}
        notes={notes}
        companyIdToTicker={companyIdToTicker}
        ticks={ticks}
        normalize={normalize}
        onToggleNormalize={(next) => navigate({ normalize: next })}
      />

      <CompanyTable
        companies={companies}
        quotes={quotes}
        ticks={ticks}
        slots={slots}
        onToggleTicker={toggleTicker}
        colorFor={colorFor}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <NotesPanel
          notes={notes}
          companies={companies}
          selectedTickers={tickers}
          colorFor={colorFor}
        />
        <AiChat />
      </div>
    </div>
  )
}
