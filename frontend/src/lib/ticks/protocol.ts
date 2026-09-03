/**
 * Wire protocol for the tick relay.
 *
 * The server half lives in `server/finnhub-relay.mjs`, which is plain JS
 * outside the Next.js compiler and so cannot import these types. Keep the two
 * in sync by hand; the smoke test in `scripts/relay-smoke-test.mjs` exercises
 * every message shape below.
 */

export const TICKS_PATH = '/api/ws/ticks'

/**
 * Ceiling on symbols subscribed at once.
 *
 * Finnhub caps concurrent subscriptions per connection, and the relay shares one
 * upstream across every browser tab - so the budget is global, not per-client.
 * Chosen conservatively rather than measured: exceeding the real limit is
 * answered upstream with silence on the surplus symbols, which is
 * indistinguishable from "not trading" and so would quietly make the Live
 * column lie.
 */
export const MAX_LIVE_SYMBOLS = 50

export type Tick = {
  symbol: string
  price: number
  volume: number
  /** Finnhub trade timestamp, epoch milliseconds. */
  timestamp: number
}

/** State of the relay's single upstream connection to Finnhub. */
export type UpstreamStatus =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'disconnected'

/** Additionally: the browser cannot reach our own relay. */
export type RelayStatus = UpstreamStatus | 'offline'

export type ServerMessage =
  | { type: 'status'; upstream: UpstreamStatus }
  | { type: 'ticks'; data: Tick[] }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'subscribe'; symbols: string[] }
  | { type: 'unsubscribe'; symbols: string[] }
