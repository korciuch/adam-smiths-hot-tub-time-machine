import { test, expect, chromium } from '@playwright/test';
import { startLocalServer } from './helpers/local-server';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * End-to-end spike: load a real WebLLM model in-browser via WebGPU and see
 * if it can turn a natural-language question into a SELECT query against
 * our actual schema (companies/prices/notes). This is the mechanism the
 * frontend's AI chat feature would use.
 *
 * Uses a persistent browser context (real user-data-dir) rather than
 * Playwright's default ephemeral context - the default context's IndexedDB
 * quota is too small for multi-hundred-MB model caches regardless of actual
 * disk space (QuotaExceededError), which isn't representative of a real
 * Chrome profile.
 */

const MODEL_ID = process.env.WEBLLM_MODEL_ID || 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

const SCHEMA_PROMPT = `You translate natural language questions into a single SQLite SELECT query.

Schema:
  companies(id, ticker, name, sector)
  prices(id, company_id, date, open, high, low, close, volume)
  notes(id, company_id, date, text, created_at)

Rules:
- Output ONLY the SQL query, no explanation, no markdown code fences.
- Only SELECT statements. Never modify data.
- Join prices to companies via company_id when you need ticker/name/sector.`;

const QUESTIONS = [
  'Which 5 companies had the lowest closing price on any single day, and what was that price?',
  'Show me the closing price history for AAPL.',
];

test(`WebLLM (${MODEL_ID}) generates SQL from natural language`, async () => {
  test.setTimeout(15 * 60 * 1000);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webllm-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=vulkan',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await context.newPage();

  const server = await startLocalServer(`<!doctype html>
    <script type="module">
      import * as webllm from "https://esm.run/@mlc-ai/web-llm";
      window.__webllm = webllm;
      window.__ready = true;
    </script>`);

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('%') || text.toLowerCase().includes('load')) {
      console.log('[load progress]', text);
    }
  });

  await page.goto(server.url);
  await page.waitForFunction(() => (window as any).__ready === true, { timeout: 30000 });

  const loadStart = Date.now();
  const loadResult = await page.evaluate(async (modelId) => {
    const webllm = (window as any).__webllm;
    try {
      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (report: any) => console.log(report.text),
      });
      (window as any).__engine = engine;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, MODEL_ID);
  const loadMs = Date.now() - loadStart;

  console.log(`Model load: ${loadResult.ok ? 'OK' : 'FAILED'} in ${loadMs}ms`, loadResult.ok ? '' : loadResult.error);
  expect(loadResult.ok, `model failed to load: ${(loadResult as any).error}`).toBe(true);

  for (const question of QUESTIONS) {
    const genStart = Date.now();
    const answer = await page.evaluate(
      async ({ schemaPrompt, question }) => {
        const engine = (window as any).__engine;
        const reply = await engine.chat.completions.create({
          messages: [
            { role: 'system', content: schemaPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0,
        });
        return reply.choices[0].message.content;
      },
      { schemaPrompt: SCHEMA_PROMPT, question }
    );
    const genMs = Date.now() - genStart;

    console.log(`\nQ: ${question}`);
    console.log(`SQL (${genMs}ms):\n${answer}`);
  }

  server.close();
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});
