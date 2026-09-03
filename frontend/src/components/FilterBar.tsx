'use client'

import { RANGE_PRESETS, resolvePreset, type TickerSlots } from '@/lib/url-state'
import type { RelayStatus } from '@/lib/ticks/protocol'
import { MAX_SERIES } from '@/lib/series'

type Props = {
  slots: TickerSlots
  from?: string
  to?: string
  activePreset: string | null
  status: RelayStatus
  loading: boolean
  colorFor: (ticker: string) => string | null
  onRange: (range: { from?: string; to?: string }) => void
  onRemoveTicker: (ticker: string) => void
  onClearTickers: () => void
}

const STATUS_LABEL: Record<RelayStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  disconnected: 'Upstream down',
  unconfigured: 'No API key',
  offline: 'Relay offline',
}

const STATUS_COLOR: Record<RelayStatus, string> = {
  connected: 'var(--status-good)',
  connecting: 'var(--status-warning)',
  disconnected: 'var(--status-serious)',
  unconfigured: 'var(--text-muted)',
  offline: 'var(--status-serious)',
}

/**
 * One filter row above everything it scopes. Every control writes the URL, so
 * the range and the selection survive a reload and can be shared.
 */
export function FilterBar({
  slots,
  from,
  to,
  activePreset,
  status,
  loading,
  colorFor,
  onRange,
  onRemoveTicker,
  onClearTickers,
}: Props) {
  const selected = slots.filter((ticker): ticker is string => ticker !== null)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-2.5">
      <div className="flex items-center gap-1" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((preset) => {
          const active = activePreset === preset.label
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onRange(resolvePreset(preset.label))}
              aria-pressed={active}
              className={`h-8 rounded px-2.5 text-sm ${
                active
                  ? 'bg-[var(--series-1)] font-medium text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--text-primary)_8%,transparent)]'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <input
          type="date"
          value={from ?? ''}
          max={to}
          onChange={(event) => onRange({ from: event.target.value || undefined, to })}
          aria-label="From date"
          className="tnum h-8 rounded border border-[var(--hairline)] bg-transparent px-2"
        />
        <span className="text-[var(--text-muted)]">to</span>
        <input
          type="date"
          value={to ?? ''}
          min={from}
          onChange={(event) => onRange({ from, to: event.target.value || undefined })}
          aria-label="To date"
          className="tnum h-8 rounded border border-[var(--hairline)] bg-transparent px-2"
        />
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {selected.map((ticker) => (
            <li key={ticker}>
              <button
                type="button"
                onClick={() => onRemoveTicker(ticker)}
                aria-label={`Remove ${ticker}`}
                className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--hairline)] pl-2 pr-2.5 text-sm hover:border-[var(--text-muted)]"
              >
                <span
                  aria-hidden
                  className="size-[8px] rounded-full"
                  style={{ backgroundColor: colorFor(ticker) ?? 'transparent' }}
                />
                <span className="font-mono">{ticker}</span>
                <span aria-hidden className="text-[var(--text-muted)]">
                  ×
                </span>
              </button>
            </li>
          ))}
          {selected.length > 1 && (
            <li>
              <button
                type="button"
                onClick={onClearTickers}
                className="h-7 px-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Clear
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="ml-auto flex items-center gap-3 text-sm">
        {loading && <span className="text-[var(--text-secondary)]">Loading…</span>}
        <span className="text-[var(--text-muted)] tnum">
          {selected.length}/{MAX_SERIES}
        </span>
        {/* Status carries an icon and a word, never color alone. */}
        <span className="flex items-center gap-1.5" title="Finnhub relay connection">
          <span
            aria-hidden
            className="size-[8px] rounded-full"
            style={{ backgroundColor: STATUS_COLOR[status] }}
          />
          <span className="text-[var(--text-secondary)]">{STATUS_LABEL[status]}</span>
        </span>
      </div>
    </div>
  )
}
