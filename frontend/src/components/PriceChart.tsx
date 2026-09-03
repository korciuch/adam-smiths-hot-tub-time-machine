'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineData,
  MouseEventParams,
  SeriesMarker,
  Time,
} from 'lightweight-charts'

import type { Note, Price } from '@/lib/api/types'
import type { Tick } from '@/lib/ticks/protocol'
import { readChartTokens, watchTheme } from '@/lib/theme-tokens'

export type ChartSeries = {
  ticker: string
  /** Categorical color slot, owned by the ticker for as long as it is selected. */
  slot: number
  prices: Price[]
}

type Props = {
  series: ChartSeries[]
  /** Notes to mark on the matching company's line. */
  notes: Note[]
  companyIdToTicker: Map<number, string>
  ticks: Record<string, Tick>
  /**
   * Identity of the active date range. Changing it refits the visible window,
   * which is what makes the range presets ("1Y", "Max", …) frame their new data
   * instead of inheriting the zoom from the previous range.
   */
  rangeKey: string
  /** Rebase each line to 100 at the range start so different price scales compare. */
  normalize: boolean
  onToggleNormalize: (next: boolean) => void
}

type HoverRow = { ticker: string; color: string; value: number }
type Hover = { date: string; rows: HoverRow[]; x: number; y: number }

function toLineData(prices: Price[], normalize: boolean): LineData<Time>[] {
  const base = prices.find((price) => price.close > 0)?.close
  return prices.map((price) => ({
    time: price.date as Time,
    value: normalize && base ? (price.close / base) * 100 : price.close,
  }))
}

export function PriceChart({
  series,
  notes,
  companyIdToTicker,
  ticks,
  rangeKey,
  normalize,
  onToggleNormalize,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const markersRef = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map())
  /**
   * Range the visible window was last fitted for. A new range refits; an
   * unrelated redraw (a ticker added, a live tick arriving) leaves the zoom the
   * user set alone.
   */
  const fittedRangeRef = useRef<string | null>(null)

  const [hover, setHover] = useState<Hover | null>(null)
  const [showTable, setShowTable] = useState(false)
  /**
   * Why the chart is not doing what was asked - a failed fit, or a chart library
   * chunk that never arrived. Surfaced instead of dropped on the floor.
   */
  const [chartError, setChartError] = useState<string | null>(null)
  const [colors, setColors] = useState<string[]>([])
  const [plotWidth, setPlotWidth] = useState(0)
  /**
   * Bumped once the series map matches `series`. Series are attached from an
   * async import, so the effects that read the map have to wait for this rather
   * than for their own render.
   */
  const [seriesEpoch, setSeriesEpoch] = useState(0)

  // Identity of the drawn data: selection, slot assignment, and the bars
  // themselves, so a range change with an unchanged selection still redraws.
  const dataKey = series
    .map((s) => `${s.ticker}:${s.slot}:${s.prices.length}:${s.prices.at(-1)?.date ?? ''}`)
    .join('|')

  /**
   * Fit the visible window to the drawn data. Returns a message on failure and
   * `null` on success, so the caller decides how to surface it.
   *
   * A React error boundary cannot help here: boundaries only catch errors thrown
   * during render, not inside event handlers, so a throw from the click path
   * would escape to `window.onerror` and leave the button looking inert. The
   * failure is caught and reported as state instead.
   */
  const fitToData = useCallback((): string | null => {
    const chart = chartRef.current
    // The chart arrives from an async `import`, and its effect can be torn down
    // and rebuilt while `seriesEpoch` still reads as ready.
    if (!chart) return 'Chart is still loading — try again in a moment.'
    if (seriesRef.current.size === 0) return 'No series drawn yet, nothing to fit.'

    try {
      chart.timeScale().fitContent()
      return null
    } catch (reason) {
      // lightweight-charts throws once a chart is disposed; losing the race with
      // an unmount is the realistic way to land here.
      console.error('[PriceChart] fitContent failed', reason)
      return reason instanceof Error
        ? `Could not reset the zoom: ${reason.message}`
        : 'Could not reset the zoom.'
    }
  }, [])

  // Chart instance: created once, themed and resized in place.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let chart: IChartApi | null = null
    let disposed = false
    let stopWatchingTheme: (() => void) | undefined
    let observer: ResizeObserver | undefined

    function applyTokens(instance: IChartApi) {
      const tokens = readChartTokens()
      setColors(tokens.series)
      instance.applyOptions({
        layout: {
          background: { color: tokens.surface },
          textColor: tokens.textSecondary,
          attributionLogo: false,
        },
        // Hairline grid, one shade off the surface.
        grid: {
          vertLines: { color: tokens.gridline },
          horzLines: { color: tokens.gridline },
        },
        rightPriceScale: { borderColor: tokens.axis },
        timeScale: { borderColor: tokens.axis, rightOffset: 4 },
        crosshair: {
          vertLine: { color: tokens.axis, labelBackgroundColor: tokens.textSecondary },
          horzLine: { color: tokens.axis, labelBackgroundColor: tokens.textSecondary },
        },
      })
    }

    void (async () => {
      const { createChart } = await import('lightweight-charts')
      if (disposed) return

      chart = createChart(container, {
        height: 380,
        autoSize: false,
        width: container.clientWidth,
        // Zoom and pan: mouse wheel scales the time axis, drag pans, pinch on
        // touch. All on by default; spelled out because it is a requirement.
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
      })
      chartRef.current = chart
      applyTokens(chart)

      chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
        if (!param.time || !param.point) {
          setHover(null)
          return
        }
        const rows: HoverRow[] = []
        for (const [ticker, api] of seriesRef.current) {
          const point = param.seriesData.get(api) as LineData<Time> | undefined
          if (point?.value === undefined) continue
          rows.push({
            ticker,
            color: api.options().color,
            value: point.value,
          })
        }
        if (rows.length === 0) {
          setHover(null)
          return
        }
        setHover({
          date: String(param.time),
          rows,
          x: param.point.x,
          y: param.point.y,
        })
      })

      observer = new ResizeObserver(([entry]) => {
        const next = Math.floor(entry.contentRect.width)
        chart?.applyOptions({ width: next })
        setPlotWidth(next)
      })
      observer.observe(container)
      setPlotWidth(container.clientWidth)

      stopWatchingTheme = watchTheme(() => {
        if (chart) applyTokens(chart)
      })
    })().catch((reason) => {
      // Covers a throw from setup itself - `createChart`, `applyTokens`, the
      // theme watcher. It deliberately does not claim to cover a chart chunk
      // that fails to arrive: measured against this build, Turbopack evaluates
      // chunks outside this promise chain, so a failed request leaves the import
      // pending forever and an evaluation throw goes to `window.onerror`.
      // Neither reaches here, and both leave the button disabled with no message.
      if (disposed) return
      console.error('[PriceChart] chart failed to initialise', reason)
      setChartError('The chart could not be loaded. Reload the page to try again.')
    })

    const attached = seriesRef.current
    const markers = markersRef.current

    return () => {
      disposed = true
      observer?.disconnect()
      stopWatchingTheme?.()
      attached.clear()
      markers.clear()
      fittedRangeRef.current = null
      chart?.remove()
      chartRef.current = null
    }
  }, [])

  // Reconcile series with the current selection.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || colors.length === 0) return

    const wanted = new Set(series.map((s) => s.ticker))

    for (const [ticker, api] of seriesRef.current) {
      if (!wanted.has(ticker)) {
        chart.removeSeries(api)
        seriesRef.current.delete(ticker)
        markersRef.current.delete(ticker)
      }
    }

    void (async () => {
      const { LineSeries } = await import('lightweight-charts')

      for (const entry of series) {
        const color = colors[entry.slot % colors.length]
        let api = seriesRef.current.get(entry.ticker)
        if (!api) {
          api = chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            // The endpoint label is the direct label that the light-mode
            // contrast warning obliges us to ship.
            lastValueVisible: true,
            priceLineVisible: false,
            title: entry.ticker,
          })
          seriesRef.current.set(entry.ticker, api)
        } else {
          api.applyOptions({ color })
        }
        api.setData(toLineData(entry.prices, normalize))
      }

      // Fit on first draw and on every range change, so clicking "1Y" or "Max"
      // frames the new window. `rangeKey` is a dependency in its own right: two
      // ranges can resolve to identical bars (5Y and Max for a young listing),
      // leaving `dataKey` unchanged even though the user asked for a new range.
      if (series.length > 0 && fittedRangeRef.current !== rangeKey) {
        fittedRangeRef.current = rangeKey
        setChartError(fitToData())
      }

      setSeriesEpoch((epoch) => epoch + 1)
    })().catch((reason) => {
      // Guards a throw from `addSeries` or `setData`; see the setup effect for
      // what a missing chart chunk does instead.
      console.error('[PriceChart] drawing the series failed', reason)
      setChartError('The chart could not be drawn. Reload the page to try again.')
    })
    // `dataKey` is the content identity of `series`; the array itself is a new
    // reference on every render, which would redraw on unrelated state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, normalize, colors, rangeKey, fitToData])

  // Note annotations, redrawn whenever notes or the selection change.
  useEffect(() => {
    if (seriesEpoch === 0 || seriesRef.current.size === 0) return

    void (async () => {
      const { createSeriesMarkers } = await import('lightweight-charts')

      const byTicker = new Map<string, SeriesMarker<Time>[]>()
      for (const note of notes) {
        if (!note.date || note.company_id === null || note.company_id === undefined) continue
        const ticker = companyIdToTicker.get(note.company_id)
        if (!ticker || !seriesRef.current.has(ticker)) continue
        const markers = byTicker.get(ticker) ?? []
        markers.push({
          time: note.date as Time,
          position: 'aboveBar',
          shape: 'circle',
          color: readChartTokens().textSecondary,
          text: note.text.length > 24 ? `${note.text.slice(0, 23)}…` : note.text,
        })
        byTicker.set(ticker, markers)
      }

      for (const [ticker, api] of seriesRef.current) {
        // Markers must be sorted by time or the plugin throws.
        const markers = (byTicker.get(ticker) ?? []).sort((a, b) =>
          String(a.time).localeCompare(String(b.time)),
        )
        const existing = markersRef.current.get(ticker)
        if (existing) {
          existing.setMarkers(markers)
        } else {
          markersRef.current.set(ticker, createSeriesMarkers(api, markers))
        }
      }
    })()
  }, [notes, companyIdToTicker, seriesEpoch])

  // Live ticks extend the last bar in place. Skipped while normalized, because
  // an intraday print is not a daily close and would distort the rebase.
  useEffect(() => {
    if (normalize) return

    for (const entry of series) {
      const tick = ticks[entry.ticker]
      const api = seriesRef.current.get(entry.ticker)
      if (!tick || !api) continue

      const lastDate = entry.prices.at(-1)?.date
      if (!lastDate) continue
      const tickDate = new Date(tick.timestamp).toISOString().slice(0, 10)
      // Only ever touch today's bar; never rewrite history.
      if (tickDate < lastDate) continue

      api.update({ time: tickDate as Time, value: tick.price })
    }
  }, [ticks, series, normalize, seriesEpoch])

  /**
   * Why the plot area is empty, when it is. Both cases draw nothing, and an
   * unexplained empty plot looks like the chart failed rather than like there is
   * nothing to show yet.
   */
  const emptyState = useMemo(() => {
    if (series.length === 0) {
      return {
        title: 'No company selected',
        hint: 'Pick a ticker from the table below to chart its price history.',
      }
    }
    if (series.every((entry) => entry.prices.length === 0)) {
      const tickers = series.map((entry) => entry.ticker).join(', ')
      return {
        title: `No price data in this range for ${tickers}`,
        hint: 'Try a wider date range, or a different company.',
      }
    }
    return null
  }, [series])

  const tableRows = useMemo(() => {
    if (!showTable) return []
    const dates = new Set<string>()
    for (const entry of series) for (const price of entry.prices) dates.add(price.date)
    const byTickerDate = new Map<string, Map<string, number>>()
    for (const entry of series) {
      byTickerDate.set(entry.ticker, new Map(entry.prices.map((p) => [p.date, p.close])))
    }
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 250)
      .map((date) => ({
        date,
        values: series.map((entry) => byTickerDate.get(entry.ticker)?.get(date) ?? null),
      }))
  }, [showTable, series])

  return (
    <section className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="text-sm font-semibold">
          {normalize ? 'Price, indexed to 100 at range start' : 'Daily close'}
        </h2>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(event) => onToggleNormalize(event.target.checked)}
            />
            Index to 100
          </label>
          <button
            type="button"
            onClick={() => setChartError(fitToData())}
            // Disabled rather than a silent no-op: with nothing plotted, or
            // before the async chart import resolves, there is genuinely nothing
            // to fit, and a button that swallows clicks reads as broken.
            // `emptyState` is the same test the overlay uses, so the button and
            // the plot area can never disagree about whether anything is drawn.
            disabled={emptyState !== null || seriesEpoch === 0}
            className="h-8 rounded border border-[var(--hairline)] px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset zoom
          </button>
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-expanded={showTable}
            className="h-8 rounded border border-[var(--hairline)] px-3"
          >
            {showTable ? 'Hide data' : 'Show data'}
          </button>
        </div>
      </header>

      {chartError && (
        <p
          role="alert"
          className="flex items-center gap-2 border-b border-[var(--hairline)] px-4 py-2 text-sm text-[var(--status-serious)]"
        >
          {chartError}
          <button
            type="button"
            onClick={() => setChartError(null)}
            className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Legend is always present for >= 2 series; with one, the title names it. */}
      {series.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-sm">
          {series.map((entry) => (
            <li key={entry.ticker} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-[10px] rounded-full"
                style={{ backgroundColor: colors[entry.slot % colors.length] }}
              />
              <span className="font-mono">{entry.ticker}</span>
              {/* A company whose history doesn't cover the selected range draws
                  no line. Saying so beats a legend entry pointing at nothing. */}
              {entry.prices.length === 0 && (
                <span className="text-[var(--text-muted)]">no data in range</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="relative px-2 py-3">
        <div ref={containerRef} className="w-full" />

        {emptyState && (
          // Opaque and stacked above the chart, not merely laid over it.
          // lightweight-charts paints into positioned canvases that otherwise win
          // the stacking order against an un-z-indexed sibling, which left this
          // message technically in the DOM but invisible behind an empty plot -
          // a blank panel that reads as a failure rather than an empty state.
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-[var(--surface-1)] px-4 text-center">
            <p className="text-sm font-medium">{emptyState.title}</p>
            <p className="text-sm text-[var(--text-secondary)]">{emptyState.hint}</p>
          </div>
        )}

        {hover && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(hover.x + 16, Math.max(plotWidth - 160, 0)),
              top: Math.max(hover.y - 8, 0),
            }}
          >
            <div className="mb-1 text-[var(--text-secondary)]">{hover.date}</div>
            {hover.rows.map((row) => (
              <div key={row.ticker} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-[8px] rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="font-mono">{row.ticker}</span>
                <span className="tnum ml-auto pl-3">{row.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTable && series.length > 0 && (
        <div className="max-h-80 overflow-auto border-t border-[var(--hairline)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--surface-1)]">
              <tr className="border-b border-[var(--hairline)]">
                <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)]">
                  Date
                </th>
                {series.map((entry) => (
                  <th
                    key={entry.ticker}
                    scope="col"
                    className="px-3 py-2 text-right text-xs font-medium text-[var(--text-secondary)]"
                  >
                    {entry.ticker}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.date} className="border-b border-[var(--hairline)] last:border-0">
                  <td className="px-3 py-1 tnum">{row.date}</td>
                  {row.values.map((value, index) => (
                    <td key={series[index].ticker} className="px-3 py-1 text-right tnum">
                      {value === null ? '—' : value.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
