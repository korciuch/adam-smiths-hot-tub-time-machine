/**
 * Smoke test for the tick relay at /api/ws/ticks.
 *
 * Connects, subscribes, prints every frame the relay sends, and exits. With no
 * FINNHUB_API_KEY configured the expected output is a single `status:
 * unconfigured` frame - that still proves the upgrade path and the client
 * protocol work.
 *
 *   node scripts/relay-smoke-test.mjs
 *   node scripts/relay-smoke-test.mjs --symbols BINANCE:BTCUSDT --duration 15
 */

const args = process.argv.slice(2)

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const url = arg('url', 'ws://localhost:3000/api/ws/ticks')
const symbols = arg('symbols', 'AAPL,MSFT,BINANCE:BTCUSDT').split(',')
const duration = Number.parseFloat(arg('duration', '10')) * 1000

const ws = new WebSocket(url)
let frames = 0

const stamp = () => new Date().toISOString().slice(11, 19)

ws.addEventListener('open', () => {
  console.log(`[${stamp()}] connected to ${url}`)
  ws.send(JSON.stringify({ type: 'subscribe', symbols }))
  console.log(`[${stamp()}] subscribed to ${symbols.join(', ')}`)
})

ws.addEventListener('message', (event) => {
  frames += 1
  const message = JSON.parse(event.data)
  if (message.type === 'ticks') {
    for (const tick of message.data) {
      console.log(
        `[${stamp()}] TICK  ${tick.symbol.padEnd(18)} price=${tick.price} volume=${tick.volume}`,
      )
    }
  } else {
    console.log(`[${stamp()}] ${JSON.stringify(message)}`)
  }
})

ws.addEventListener('error', (event) => {
  console.error(`[${stamp()}] socket error:`, event.message ?? event)
})

ws.addEventListener('close', (event) => {
  console.log(`[${stamp()}] closed (code=${event.code})`)
})

setTimeout(() => {
  console.log(`\n--- ${frames} frame(s) received ---`)
  ws.close()
  process.exit(0)
}, duration)
