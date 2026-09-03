/**
 * Question -> SQL -> rows, with a correction loop.
 *
 * The generate/execute/correct cycle that `TASKS.md` specifies: the model runs
 * in this tab, the backend only executes. Kept out of the component so the
 * loop is readable on its own, and `execute` is injected so this module has no
 * dependency on the server action.
 */

import type { AiRow } from './chart-spec'
import { loadEngine, type LoadProgress } from './engine'
import { inferChart, type InferredChart } from './infer-chart'
import { correctionPrompt, SQL_SYSTEM_PROMPT } from './prompt'
import { extractSql, lintSql } from './sql-text'

/**
 * One generation plus up to two corrections.
 *
 * `MODEL_FINDINGS.md` found errors of the kind a single feedback pass fixes
 * (an integer FK compared to 'AAPL' - the driver says "no such column"). A
 * third attempt is the ceiling: each one costs seconds of on-device inference,
 * and a model that has failed twice on the same error is not converging.
 */
const MAX_ATTEMPTS = 3

/** SQL is short. A cap keeps a looping model from generating for a minute. */
const MAX_TOKENS = 400

export type SqlResult = {
  columns: string[]
  rows: AiRow[]
  truncated: boolean
  error?: string | null
}

export type ExecuteSql = (
  sql: string,
) => Promise<{ ok: true; data: SqlResult } | { ok: false; error: string }>

export type QueryProgress =
  | { stage: 'loading-model'; load: LoadProgress }
  | { stage: 'generating'; attempt: number }
  | { stage: 'executing'; sql: string }

export type QueryOutcome =
  | {
      ok: true
      sql: string
      columns: string[]
      rows: AiRow[]
      chart: InferredChart | null
      truncated: boolean
    }
  | { ok: false; sql?: string; error: string }

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export async function runQuery(
  question: string,
  execute: ExecuteSql,
  onProgress: (progress: QueryProgress) => void,
): Promise<QueryOutcome> {
  let engine
  try {
    engine = await loadEngine((load) => onProgress({ stage: 'loading-model', load }))
  } catch (cause) {
    return { ok: false, error: `Could not load the model: ${String(cause)}` }
  }

  const messages: Message[] = [
    { role: 'system', content: SQL_SYSTEM_PROMPT },
    { role: 'user', content: question },
  ]

  let lastSql: string | undefined
  let lastError = 'The model did not produce a usable query.'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onProgress({ stage: 'generating', attempt })

    let raw: string
    try {
      const reply = await engine.chat.completions.create({
        messages,
        temperature: 0,
        max_tokens: MAX_TOKENS,
      })
      raw = reply.choices[0]?.message?.content ?? ''
    } catch (cause) {
      return { ok: false, sql: lastSql, error: `Generation failed: ${String(cause)}` }
    }

    const sql = extractSql(raw)
    lastSql = sql
    if (!sql) {
      lastError = 'The model did not produce a query.'
      messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: 'Output only a SELECT statement.' })
      continue
    }

    // Caught before the round trip: this class of mistake executes cleanly and
    // returns nothing, so the backend has no error to report on it.
    const lint = lintSql(sql)
    if (lint) {
      lastError = lint
      messages.push({ role: 'assistant', content: sql })
      messages.push({ role: 'user', content: correctionPrompt(sql, lint) })
      continue
    }

    onProgress({ stage: 'executing', sql })
    const result = await execute(sql)

    // A transport failure is not something the model can correct by rewriting
    // its SQL, so it ends the loop instead of consuming an attempt.
    if (!result.ok) return { ok: false, sql, error: result.error }

    if (!result.data.error) {
      const { columns, rows, truncated } = result.data
      return {
        ok: true,
        sql,
        columns,
        rows,
        chart: inferChart(columns, rows),
        truncated,
      }
    }

    lastError = result.data.error
    messages.push({ role: 'assistant', content: sql })
    messages.push({ role: 'user', content: correctionPrompt(sql, lastError) })
  }

  return { ok: false, sql: lastSql, error: lastError }
}
