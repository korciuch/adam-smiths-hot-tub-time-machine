/**
 * Loading and holding the in-browser model.
 *
 * The engine is a module-level singleton, not React state. Weights are
 * hundreds of MB to low GB and take tens of seconds to compile on first load
 * (`research/webgpu-models/MODEL_FINDINGS.md`: ~15s for 1B, ~34s for 3B, cold);
 * a second engine would mean a second copy in VRAM. Remounting the chat panel
 * must not pay that cost again, so ownership sits outside the component tree.
 *
 * The promise is cached rather than the resolved engine, so concurrent callers
 * during a load all await the same one instead of racing two downloads.
 */

import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'

/**
 * 3B is the default on the strength of the spike: it resolved ticker -> id
 * through `companies` where 1B compared an integer FK to the string 'AAPL'
 * outright. Overridable for testing on memory-constrained machines.
 */
export const MODEL_ID =
  process.env.NEXT_PUBLIC_WEBLLM_MODEL_ID ?? 'Llama-3.2-3B-Instruct-q4f16_1-MLC'

export type LoadProgress = { text: string; progress: number }

let enginePromise: Promise<MLCEngineInterface> | null = null

/**
 * Resolves the shared engine, loading it on first call.
 *
 * `onProgress` only reports for the caller that triggers the load. A caller
 * that joins an in-flight load gets no progress events - it is already
 * displaying whatever the first caller's UI is showing.
 */
export function loadEngine(onProgress?: (progress: LoadProgress) => void) {
  if (enginePromise) return enginePromise

  enginePromise = (async () => {
    // Imported here, not at module scope: the package pulls in WebGPU and
    // worker globals, and it is several hundred KB that no other route needs.
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')

    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    })

    return CreateWebWorkerMLCEngine(worker, MODEL_ID, {
      initProgressCallback: (report: InitProgressReport) =>
        onProgress?.({ text: report.text, progress: report.progress }),
    })
  })()

  // A failed load must not poison the singleton - the user may retry, and a
  // rejected cached promise would reject forever.
  enginePromise.catch(() => {
    enginePromise = null
  })

  return enginePromise
}

/** True once the model is resident and a query will not pay the load cost. */
export function isEngineLoading() {
  return enginePromise !== null
}
