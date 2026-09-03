'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  columnFilteringFeature,
  constructSortFn,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table'

import type { Company, Quote } from '@/lib/api/types'
import { MAX_LIVE_SYMBOLS, type Tick } from '@/lib/ticks/protocol'
import { MAX_SERIES } from '@/lib/series'

/**
 * Sorts symbols that are printing above symbols that are not.
 *
 * Presence only - two live symbols compare equal, so the tie falls through to
 * the next sort entry (ticker) rather than ordering by price, which would rank
 * a $500 share above a $30 one for no reason the user asked for.
 *
 * Ascending puts live first, so the default sort reads `desc: false`.
 */
const sortFn_liveFirst = constructSortFn({
  sort: (a, b) => {
    const aLive = a !== null && a !== undefined
    const bLive = b !== null && b !== undefined
    if (aLive === bLive) return 0
    return aLive ? -1 : 1
  },
})

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    liveFirst: sortFn_liveFirst,
  },
})

/** One table row: a company plus whatever price information we have for it. */
type Row = Company & {
  close: number | null
  closeDate: string | null
  live: number | null
  /** Live price against the last persisted close, as a fraction. */
  change: number | null
}

const columnHelper = createColumnHelper<typeof features, Row>()

function formatPrice(value: number | null) {
  if (value === null) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatChange(value: number | null) {
  if (value === null) return '—'
  const percent = (value * 100).toFixed(2)
  return `${value > 0 ? '+' : ''}${percent}%`
}

type Props = {
  companies: Company[]
  quotes: Quote[]
  ticks: Record<string, Tick>
  slots: (string | null)[]
  onToggleTicker: (ticker: string) => void
  /** Color for a selected ticker's slot, or null when unselected. */
  colorFor: (ticker: string) => string | null
  /**
   * Tickers currently on screen. Reported upwards so they can be subscribed for
   * live prices: without this the Live column would only ever be populated for
   * the handful of charted tickers, and every other row would read as flat.
   */
  onVisibleTickersChange: (tickers: string[]) => void
}

export function CompanyTable({
  companies,
  quotes,
  ticks,
  slots,
  onToggleTicker,
  colorFor,
  onVisibleTickersChange,
}: Props) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')

  const selectedCount = slots.filter(Boolean).length
  const atCapacity = selectedCount >= MAX_SERIES

  const quoteByTicker = useMemo(() => {
    return new Map(quotes.map((quote) => [quote.ticker, quote]))
  }, [quotes])

  const rows = useMemo<Row[]>(() => {
    return companies.map((company) => {
      const quote = quoteByTicker.get(company.ticker) ?? null
      const live = ticks[company.ticker]?.price ?? null
      const close = quote?.close ?? null
      return {
        ...company,
        close,
        closeDate: quote?.date ?? null,
        live,
        change: live !== null && close ? (live - close) / close : null,
      }
    })
  }, [companies, quoteByTicker, ticks])

  const sectors = useMemo(() => {
    const unique = new Set<string>()
    for (const company of companies) {
      if (company.sector) unique.add(company.sector)
    }
    return [...unique].sort()
  }, [companies])

  // A mixed accessor/display array narrows each column to its own value type,
  // and `accessorFn` puts that type in both an argument and a return position,
  // so the columns never unify. `any` in the value slot is the documented
  // escape; `unknown` and `never` both fail on the variance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<typeof features, Row, any>[]>(
    () => [
      columnHelper.display({
        id: 'select',
        header: '',
        cell: ({ row }) => {
          const ticker = row.original.ticker
          const color = colorFor(ticker)
          const selected = color !== null
          return (
            <button
              type="button"
              onClick={() => onToggleTicker(ticker)}
              disabled={!selected && atCapacity}
              aria-pressed={selected}
              aria-label={
                selected ? `Remove ${ticker} from chart` : `Add ${ticker} to chart`
              }
              title={
                !selected && atCapacity
                  ? `Charting is capped at ${MAX_SERIES} companies`
                  : undefined
              }
              // 24px hit target, larger than the 10px swatch it contains.
              className="flex size-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-30 hover:bg-[color-mix(in_oklab,var(--text-primary)_8%,transparent)]"
            >
              <span
                className="size-[10px] rounded-full"
                style={
                  selected
                    ? { backgroundColor: color }
                    : { boxShadow: 'inset 0 0 0 1.5px var(--text-muted)' }
                }
              />
            </button>
          )
        },
      }),
      columnHelper.accessor('ticker', {
        header: 'Ticker',
        sortFn: 'alphanumeric',
        filterFn: 'includesString',
        cell: (info) => <span className="font-mono font-medium">{info.getValue()}</span>,
      }),
      columnHelper.accessor('name', {
        header: 'Company',
        sortFn: 'alphanumeric',
        filterFn: 'includesString',
      }),
      columnHelper.accessor('sector', {
        header: 'Sector',
        sortFn: 'alphanumeric',
        filterFn: 'includesString',
        cell: (info) => (
          <span className="text-[var(--text-secondary)]">{info.getValue() ?? '—'}</span>
        ),
      }),
      columnHelper.accessor('close', {
        header: 'Last close',
        sortFn: 'basic',
        cell: (info) => (
          <span className="tnum">{formatPrice(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor('live', {
        header: 'Live',
        sortFn: 'liveFirst',
        cell: (info) => {
          const value = info.getValue()
          return (
            <span className="tnum">
              {value === null ? (
                <span className="text-[var(--text-muted)]">—</span>
              ) : (
                formatPrice(value)
              )}
            </span>
          )
        },
      }),
      columnHelper.accessor('change', {
        header: 'Change',
        sortFn: 'basic',
        cell: (info) => {
          const value = info.getValue()
          if (value === null) return <span className="text-[var(--text-muted)]">—</span>
          // Direction is carried by the arrow and the sign, not by color alone.
          const rising = value > 0
          return (
            <span
              className="tnum"
              style={{
                color: rising ? 'var(--delta-up)' : value < 0 ? 'var(--status-critical)' : undefined,
              }}
            >
              {rising ? '▲' : value < 0 ? '▼' : ''} {formatChange(value)}
            </span>
          )
        },
      }),
    ],
    [atCapacity, colorFor, onToggleTicker],
  )

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    initialState: {
      // Trading symbols first, then alphabetical within each group. Outside
      // market hours most rows have no live price, so this is what surfaces the
      // few that are actually printing instead of burying them on page 14.
      sorting: [
        { id: 'live', desc: false },
        { id: 'ticker', desc: false },
      ],
      pagination: { pageIndex: 0, pageSize: 25 },
    },
  })

  // Sector is a dimension filter rather than free text, so it drives the column
  // filter directly instead of the global one.
  function applySectorFilter(value: string) {
    setSectorFilter(value)
    table.getColumn('sector')?.setFilterValue(value || undefined)
  }

  const pagination = table.state.pagination
  const filteredCount = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()

  // Rows after filtering, sorting and pagination - i.e. exactly what is on
  // screen, which is the set worth spending the subscription budget on.
  const visibleRows = table.getRowModel().rows
  const visibleTickers = useMemo(
    () => visibleRows.map((row) => row.original.ticker),
    [visibleRows],
  )
  const visibleKey = visibleTickers.join(',')

  useEffect(() => {
    onVisibleTickersChange(visibleTickers)
    // `visibleKey` is the stable identity of `visibleTickers`, which is a new
    // array on every render. Keying on the contents stops this from re-reporting
    // the same page and looping against the parent's state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, onVisibleTickersChange])

  // Truthful only while the page fits the budget; past it the surplus rows show
  // "—" because nobody is listening, not because nobody is trading. Charted
  // tickers are counted in: they hold their subscriptions even when scrolled off
  // this page, so they spend from the same budget.
  const liveBudgetUsed = new Set([
    ...slots.filter((ticker): ticker is string => ticker !== null),
    ...visibleTickers,
  ]).size
  const liveTruncated = liveBudgetUsed > MAX_LIVE_SYMBOLS

  return (
    <section className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-4 py-3">
        <h2 className="mr-auto text-sm font-semibold">
          S&amp;P 500 companies
          <span className="ml-2 font-normal text-[var(--text-secondary)]">
            {filteredCount} of {companies.length}
          </span>
          {liveTruncated && (
            <span className="ml-2 font-normal text-[var(--text-muted)]">
              · live prices for the first {MAX_LIVE_SYMBOLS} only
            </span>
          )}
        </h2>

        <input
          type="search"
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Filter ticker, name, sector…"
          aria-label="Filter companies"
          className="h-8 w-56 rounded border border-[var(--hairline)] bg-transparent px-2 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--series-1)] focus:outline-none"
        />

        <select
          value={sectorFilter}
          onChange={(event) => applySectorFilter(event.target.value)}
          aria-label="Filter by sector"
          className="h-8 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2 text-sm focus:border-[var(--series-1)] focus:outline-none"
        >
          <option value="">All sectors</option>
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </select>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-[var(--hairline)]">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)]"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 hover:text-[var(--text-primary)]"
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden className="text-[var(--text-muted)]">
                            {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                          </span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--hairline)] last:border-0 hover:bg-[color-mix(in_oklab,var(--text-primary)_4%,transparent)]"
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1.5 whitespace-nowrap">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {filteredCount === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-[var(--text-secondary)]"
                >
                  No companies match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] px-4 py-2 text-sm">
        <span className="mr-auto text-[var(--text-secondary)]">
          Page <span className="tnum">{pagination.pageIndex + 1}</span> of{' '}
          <span className="tnum">{Math.max(pageCount, 1)}</span>
        </span>

        <select
          value={pagination.pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
          aria-label="Rows per page"
          className="h-8 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2 text-sm"
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="h-8 rounded border border-[var(--hairline)] px-3 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="h-8 rounded border border-[var(--hairline)] px-3 disabled:opacity-40"
        >
          Next
        </button>
      </footer>
    </section>
  )
}
