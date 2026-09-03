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
 * Ceiling on symbols subscribed at once. The relay shares one upstream across
 * every browser tab, so this budget is global rather than per-client.
 *
 * PROVISIONAL - not a measured limit. Subscribing a 25-row page put the upstream
 * into a connect/drop/reconnect loop, so Finnhub answers an over-subscription by
 * closing the socket rather than ignoring the surplus. Which threshold was
 * crossed is unresolved: repeated probing also degraded connections that had
 * worked minutes earlier at two symbols, which points at a rate limit on
 * connection attempts confounding the symbol count.
 *
 * Until it is measured on a rested key during market hours, keep this small
 * enough that a full page never approaches whatever the real limit is.
 */
export const MAX_LIVE_SYMBOLS = 10

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
