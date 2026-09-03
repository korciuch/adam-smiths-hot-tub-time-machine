'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Company, Note, Price, Quote } from '@/lib/api/types'
import { MAX_LIVE_SYMBOLS } from '@/lib/ticks/protocol'
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

  /**
   * Tickers the table currently has on screen. Subscribed alongside the charted
   * ones so the Live column means "trading right now" for every visible row,
   * which is what lets the table sort the active names to the top.
   */
  const [visibleTickers, setVisibleTickers] = useState<string[]>([])

  const handleVisibleTickersChange = useCallback((next: string[]) => {
    // Compared by content: the table reports a fresh array on every render, and
    // storing it unconditionally would re-render the table, which would report
    // again.
    setVisibleTickers((previous) =>
      previous.join(',') === next.join(',') ? previous : next,
    )
  }, [])

  const liveSymbols = useMemo(() => {
    // Charted tickers go first so they can never be the ones dropped by the cap -
    // their live price extends the plotted line, while a table row just shows a
    // dash.
    const wanted = [...tickers]
    for (const ticker of visibleTickers) {
      if (!wanted.includes(ticker)) wanted.push(ticker)
    }
    return wanted.slice(0, MAX_LIVE_SYMBOLS)
  }, [tickers, visibleTickers])

  const { ticks, status } = useTicks(liveSymbols)

  // A selected ticker with no bars in the range stays in the series list with an
  // empty array; the chart labels it in the legend. Dropping it here instead
  // made the selection look like it hadn't registered. A ticker whose fetch
  // failed has no key at all and is left out - the error banner covers that.
  const series = useMemo<ChartSeries[]>(() => {
    return slots.flatMap((ticker, slot) =>
      ticker && prices[ticker] ? [{ ticker, slot, prices: prices[ticker] }] : [],
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
        rangeKey={`${from ?? ''}:${to ?? ''}`}
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
        onVisibleTickersChange={handleVisibleTickersChange}
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
