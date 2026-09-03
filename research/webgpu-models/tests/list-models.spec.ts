import { test } from '@playwright/test';
import { startLocalServer } from './helpers/local-server';

test('list available WebLLM prebuilt models and their VRAM requirements', async ({ page }) => {
  const server = await startLocalServer(`<!doctype html>
    <script type="module">
      import * as webllm from "https://esm.run/@mlc-ai/web-llm";
      window.__webllm = webllm;
      window.__ready = true;
    </script>`);
  await page.goto(server.url);
  await page.waitForFunction(() => (window as any).__ready === true, { timeout: 30000 });

  const models = await page.evaluate(() => {
    const cfg = (window as any).__webllm.prebuiltAppConfig;
    return cfg.model_list
      .map((m: any) => ({ id: m.model_id, vram_required_MB: m.vram_required_MB, low_resource: m.low_resource_required }))
      .sort((a: any, b: any) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0));
  });

  console.log(`Total models: ${models.length}`);

  const candidates = models.filter((m: any) =>
    /llama-3\.2-(1|3)b-instruct|qwen2\.5-coder-1\.5b-instruct|qwen2\.5-1\.5b-instruct/i.test(m.id)
  );
  console.log('Candidates:', JSON.stringify(candidates, null, 2));

  server.close();
});
