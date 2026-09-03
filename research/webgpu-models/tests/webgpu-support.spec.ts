import { test, expect } from '@playwright/test';
import { startLocalServer } from './helpers/local-server';

/**
 * Foundational check: does headless Chrome, with the launch flags in
 * playwright.config.ts, actually expose a working WebGPU adapter? Everything
 * else (WebLLM model loading, etc.) is moot if this fails.
 *
 * Must be served from http://127.0.0.1, not about:blank - see FINDINGS.md.
 */
test('navigator.gpu is available and can request a real adapter', async ({ page }) => {
  const server = await startLocalServer('<!doctype html><body>ok</body>');
  await page.goto(server.url);

  const result = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return { hasGpu: false };

    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) return { hasGpu: true, adapter: null };

    const info = adapter.info ?? (await adapter.requestAdapterInfo?.().catch(() => null));
    return {
      hasGpu: true,
      isSecureContext: window.isSecureContext,
      adapter: {
        limits: {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        },
        info: info
          ? { vendor: info.vendor, architecture: info.architecture, description: info.description }
          : null,
      },
    };
  });

  console.log('WebGPU probe result:', JSON.stringify(result, null, 2));
  server.close();

  expect(result.hasGpu, 'navigator.gpu should exist').toBe(true);
  expect(result.adapter, 'requestAdapter() should return a real adapter, not null').not.toBeNull();
});
