import createClient from 'openapi-fetch'

import type { paths } from './schema'

/**
 * Server-side only: deliberately not `NEXT_PUBLIC_`, so the backend is never
 * addressed directly from the browser. Reads happen in server components and
 * writes in server actions, which also means CORS never enters the picture.
 */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export const api = createClient<paths>({ baseUrl: BACKEND_URL })
