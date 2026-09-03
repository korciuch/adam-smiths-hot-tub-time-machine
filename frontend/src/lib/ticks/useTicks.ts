'use client'

import { useEffect, useRef, useState } from 'react'

import {
  TICKS_PATH,
  type RelayStatus,
  type ServerMessage,
  type Tick,
} from './protocol'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

function relayUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${TICKS_PATH}`
}

/**
 * Subscribes to live trades for `symbols` over the relay.
 *
 * The socket outlives changes to `symbols`: only the difference is sent, so
 * changing the selection does not tear down and rebuild the connection. The
 * relay replays its last known tick per symbol on subscribe, so a symbol that
 * last traded before this component mounted still paints immediately.
 */
export function useTicks(symbols: string[]) {
  const [ticks, setTicks] = useState<Record<string, Tick>>({})
  const [status, setStatus] = useState<RelayStatus>('connecting')

  const socketRef = useRef<WebSocket | null>(null)
  /** What the relay currently believes we want. */
  const subscribedRef = useRef<Set<string>>(new Set())
  /** What we actually want right now, readable from the socket's open handler. */
  const wantedRef = useRef<string[]>(symbols)

  // Connection lifecycle. Deliberately mount-only: reconnects are handled
  // internally so that a changing symbol list never cycles the socket.
  useEffect(() => {
    let disposed = false
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (disposed) return

      const socket = new WebSocket(relayUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        reconnectAttempt = 0
        subscribedRef.current = new Set(wantedRef.current)
        if (wantedRef.current.length > 0) {
          socket.send(
            JSON.stringify({ type: 'subscribe', symbols: wantedRef.current }),
          )
        }
      })

      socket.addEventListener('message', (event) => {
        let message: ServerMessage
        try {
          message = JSON.parse(event.data as string)
        } catch {
          return
        }

        if (message.type === 'status') {
          setStatus(message.upstream)
        } else if (message.type === 'ticks') {
          setTicks((previous) => {
            const next = { ...previous }
            for (const tick of message.data) next[tick.symbol] = tick
            return next
          })
        }
      })

      socket.addEventListener('close', () => {
        socketRef.current = null
        subscribedRef.current.clear()
        if (disposed) return

        setStatus('offline')
        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** reconnectAttempt,
        )
        reconnectAttempt += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
      subscribedRef.current.clear()
    }
  }, [])

  // Reconcile the subscription set whenever the caller's symbols change.
  const symbolKey = symbols.join(',')
  useEffect(() => {
    // Published here rather than during render so the socket's `open` handler,
    // which may fire before this effect ever runs, still sees the latest list.
    wantedRef.current = symbols

    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return

    const wanted = new Set(symbols)
    const subscribed = subscribedRef.current

    const added = symbols.filter((symbol) => !subscribed.has(symbol))
    const removed = [...subscribed].filter((symbol) => !wanted.has(symbol))

    if (added.length > 0) {
      socket.send(JSON.stringify({ type: 'subscribe', symbols: added }))
      for (const symbol of added) subscribed.add(symbol)
    }
    if (removed.length > 0) {
      socket.send(JSON.stringify({ type: 'unsubscribe', symbols: removed }))
      for (const symbol of removed) subscribed.delete(symbol)
    }
    // `symbolKey` is the stable identity of `symbols`; the array itself is a new
    // reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey])

  return { ticks, status }
}
