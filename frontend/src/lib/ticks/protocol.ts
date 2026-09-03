/**
 * Wire protocol for the tick relay.
 *
 * The server half lives in `server/finnhub-relay.mjs`, which is plain JS
 * outside the Next.js compiler and so cannot import these types. Keep the two
 * in sync by hand; the smoke test in `scripts/relay-smoke-test.mjs` exercises
 * every message shape below.
 */

export const TICKS_PATH = '/api/ws/ticks'

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
