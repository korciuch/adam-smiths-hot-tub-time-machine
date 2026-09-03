/**
 * Finnhub trade-feed relay.
 *
 * Finnhub's WebSocket takes the API key as a query param, so the browser can
 * never talk to it directly without leaking the key. This module holds a single
 * upstream connection server-side and fans ticks out to browser clients over
 * `/api/ws/ticks`.
 *
 * One upstream connection is also the only sane option on the free tier, which
 * caps concurrent connections and subscribed symbols. Symbols are
 * reference-counted across clients: we subscribe upstream on the first
 * interested client and unsubscribe on the last.
 *
 * Plain JS because `server.mjs` runs outside the Next.js compiler.
 */

import { WebSocketServer } from 'ws'

const FINNHUB_WS_URL = 'wss://ws.finnhub.io'

/**
 * Trades on an active symbol can print far faster than a browser can paint.
 * We keep only the newest tick per symbol and flush on this interval, so a
 * burst of 500 prints collapses into one render instead of 500.
 */
const FLUSH_INTERVAL_MS = 250

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** Drop browser clients that stop answering pings (closed laptop, dead tab). */
const HEARTBEAT_INTERVAL_MS = 30_000

/** Upstream connection states reported to clients so the UI can show them. */
const UPSTREAM = {
  unconfigured: 'unconfigured',
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected',
}

export function createTickRelay({ apiKey, logger = console } = {}) {
  const wss = new WebSocketServer({ noServer: true })

  /** @type {Map<string, Set<import('ws').WebSocket>>} symbol -> subscribed clients */
  const subscribers = new Map()
  /** @type {Map<import('ws').WebSocket, Set<string>>} client -> its symbols */
  const clientSymbols = new Map()
  /** @type {Map<string, object>} symbol -> most recent tick, for instant paint on subscribe */
  const lastTick = new Map()
  /** @type {Set<string>} symbols that changed since the last flush */
  const dirty = new Set()

  /** @type {import('ws').WebSocket | null} */
  let upstream = null
  let upstreamState = apiKey ? UPSTREAM.disconnected : UPSTREAM.unconfigured
  let reconnectAttempt = 0
  let reconnectTimer = null
  let flushTimer = null
  let heartbeatTimer = null
  let closed = false

  // --- outbound helpers -------------------------------------------------------

  function send(client, message) {
    if (client.readyState !== client.OPEN) return
    client.send(JSON.stringify(message))
  }

  function broadcastStatus() {
    for (const client of clientSymbols.keys()) {
      send(client, { type: 'status', upstream: upstreamState })
    }
  }

  // --- upstream (Finnhub) ----------------------------------------------------

  function upstreamSend(message) {
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify(message))
    }
  }

  function connectUpstream() {
    if (closed || !apiKey || upstream) return

    upstreamState = UPSTREAM.connecting
    broadcastStatus()

    const ws = new WebSocket(`${FINNHUB_WS_URL}?token=${apiKey}`)
    upstream = ws

    ws.addEventListener('open', () => {
      reconnectAttempt = 0
      upstreamState = UPSTREAM.connected
      logger.log('[relay] upstream connected')
      // Re-subscribe everything: after a reconnect Finnhub remembers nothing.
      for (const symbol of subscribers.keys()) {
        upstreamSend({ type: 'subscribe', symbol })
      }
      broadcastStatus()
    })

    ws.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        logger.warn('[relay] non-JSON upstream frame')
        return
      }

      // Finnhub sends `ping` as a keepalive; `ws` answers protocol-level pings
      // itself, and this application-level one needs no reply.
      if (message.type === 'ping') return

      if (message.type === 'error') {
        logger.error('[relay] upstream error:', message.msg)
        return
      }

      if (message.type !== 'trade' || !Array.isArray(message.data)) return

      for (const trade of message.data) {
        const symbol = trade.s
        if (!symbol) continue
        const previous = lastTick.get(symbol)
        // Out-of-order frames happen; never let an older print win.
        if (previous && previous.timestamp > trade.t) continue
        lastTick.set(symbol, {
          symbol,
          price: trade.p,
          volume: trade.v,
          timestamp: trade.t,
        })
        dirty.add(symbol)
      }
    })

    ws.addEventListener('close', () => {
      if (upstream === ws) upstream = null
      upstreamState = UPSTREAM.disconnected
      broadcastStatus()
      scheduleReconnect()
    })

    ws.addEventListener('error', (event) => {
      logger.error('[relay] upstream socket error:', event.message ?? event)
      // A `close` always follows, which is what triggers the reconnect.
    })
  }

  function scheduleReconnect() {
    // Nothing to reconnect for if no client cares, and no key means no upstream.
    if (closed || !apiKey || reconnectTimer || subscribers.size === 0) return

    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    )
    reconnectAttempt += 1
    logger.log(`[relay] reconnecting to upstream in ${delay}ms`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectUpstream()
    }, delay)
  }

  // --- fan-out ---------------------------------------------------------------

  function flush() {
    if (dirty.size === 0) return

    // Batch per client: one frame carrying every symbol that client watches,
    // rather than one frame per symbol.
    /** @type {Map<import('ws').WebSocket, object[]>} */
    const batches = new Map()

    for (const symbol of dirty) {
      const tick = lastTick.get(symbol)
      const watchers = subscribers.get(symbol)
      if (!tick || !watchers) continue
      for (const client of watchers) {
        let batch = batches.get(client)
        if (!batch) {
          batch = []
          batches.set(client, batch)
        }
        batch.push(tick)
      }
    }
    dirty.clear()

    for (const [client, ticks] of batches) {
      send(client, { type: 'ticks', data: ticks })
    }
  }

  // --- subscription bookkeeping ---------------------------------------------

  function subscribe(client, symbols) {
    const owned = clientSymbols.get(client)
    if (!owned) return

    /** @type {object[]} */
    const snapshot = []

    for (const symbol of symbols) {
      if (owned.has(symbol)) continue
      owned.add(symbol)

      let watchers = subscribers.get(symbol)
      if (!watchers) {
        watchers = new Set()
        subscribers.set(symbol, watchers)
        upstreamSend({ type: 'subscribe', symbol })
      }
      watchers.add(client)

      const cached = lastTick.get(symbol)
      if (cached) snapshot.push(cached)
    }

    // Finnhub only pushes on an actual print, so a symbol that last traded
    // minutes ago would otherwise show nothing until it trades again.
    if (snapshot.length > 0) send(client, { type: 'ticks', data: snapshot })

    // First subscription is what brings the upstream connection up.
    if (!upstream) connectUpstream()
  }

  function unsubscribe(client, symbols) {
    const owned = clientSymbols.get(client)
    if (!owned) return

    for (const symbol of symbols) {
      if (!owned.delete(symbol)) continue

      const watchers = subscribers.get(symbol)
      if (!watchers) continue
      watchers.delete(client)
      if (watchers.size === 0) {
        subscribers.delete(symbol)
        upstreamSend({ type: 'unsubscribe', symbol })
      }
    }
  }

  function normalizeSymbols(value) {
    if (!Array.isArray(value)) return []
    return value
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  }

  // --- client lifecycle ------------------------------------------------------

  wss.on('connection', (client) => {
    clientSymbols.set(client, new Set())
    client.isAlive = true

    send(client, { type: 'status', upstream: upstreamState })

    client.on('pong', () => {
      client.isAlive = true
    })

    client.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        send(client, { type: 'error', message: 'Expected a JSON message' })
        return
      }

      const symbols = normalizeSymbols(message?.symbols)

      switch (message?.type) {
        case 'subscribe':
          subscribe(client, symbols)
          break
        case 'unsubscribe':
          unsubscribe(client, symbols)
          break
        default:
          send(client, {
            type: 'error',
            message: `Unknown message type: ${message?.type}`,
          })
      }
    })

    client.on('close', () => {
      const owned = clientSymbols.get(client)
      if (owned) unsubscribe(client, [...owned])
      clientSymbols.delete(client)

      // Last client out closes the upstream connection so we do not burn a
      // free-tier slot on an idle server.
      if (clientSymbols.size === 0 && upstream) {
        upstream.close()
        upstream = null
      }
    })
  })

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)

  heartbeatTimer = setInterval(() => {
    for (const client of clientSymbols.keys()) {
      if (client.isAlive === false) {
        client.terminate()
        continue
      }
      client.isAlive = false
      client.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)

  if (!apiKey) {
    logger.warn(
      '[relay] FINNHUB_API_KEY is not set - live ticks are disabled. ' +
        'Clients will connect and receive status "unconfigured".',
    )
  }

  return {
    /** Hand a matching HTTP upgrade to the relay's WebSocket server. */
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request)
      })
    },

    async close() {
      closed = true
      clearInterval(flushTimer)
      clearInterval(heartbeatTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      upstream?.close()
      upstream = null
      for (const client of clientSymbols.keys()) client.close(1001, 'Server shutting down')
      await new Promise((resolve) => wss.close(resolve))
    },
  }
}
