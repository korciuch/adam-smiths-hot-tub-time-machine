/**
 * Custom Next.js server.
 *
 * Needed only for the WebSocket relay: Next.js Route Handlers cannot hold a
 * socket open (the connection closes once the response is generated), so the
 * live tick feed has to be served from the underlying HTTP server. Everything
 * else is handed straight to Next.js.
 *
 * Not run through the Next.js compiler - keep this file plain Node ESM.
 */

import { createServer } from 'node:http'
import next from 'next'

import { createTickRelay } from './server/finnhub-relay.mjs'

// Next.js loads .env for the app itself, but that happens too late for the
// relay, which needs FINNHUB_API_KEY before `app.prepare()`.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Missing env file is fine; the key can come from the real environment.
  }
}

const TICKS_PATH = '/api/ws/ticks'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const hostname = process.env.HOSTNAME ?? 'localhost'
const dev = process.env.NODE_ENV !== 'production'

const httpServer = createServer()
const app = next({ dev, hostname, port, httpServer })
const relay = createTickRelay({ apiKey: process.env.FINNHUB_API_KEY })

// Next.js rejects `getUpgradeHandler()` before `prepare()` resolves.
await app.prepare()

const handle = app.getRequestHandler()
const upgradeNext = app.getUpgradeHandler()

httpServer.on('request', (req, res) => {
  handle(req, res)
})

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? hostname}`)

  if (pathname === TICKS_PATH) {
    relay.handleUpgrade(req, socket, head)
    return
  }

  // Everything else is Next.js's own upgrade traffic (HMR in dev).
  upgradeNext(req, socket, head)
})

httpServer.listen(port, () => {
  console.log(`> Ready on http://${hostname}:${port} (${dev ? 'development' : 'production'})`)
  console.log(`> Tick relay listening on ws://${hostname}:${port}${TICKS_PATH}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n> ${signal} received, shutting down`)
    await relay.close()
    httpServer.close()
    await app.close()
    process.exit(0)
  })
}
