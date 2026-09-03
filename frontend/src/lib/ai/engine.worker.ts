/**
 * The WebLLM inference worker.
 *
 * Generation runs off the main thread. On the main thread, token decoding
 * blocks paint for the whole generation - seconds, with no spinner able to
 * animate - which reads as a frozen tab. The engine's WebGPU work is
 * dispatched from here instead, so the UI stays responsive while a query is
 * being written.
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event)
}
