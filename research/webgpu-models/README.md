# WebGPU / WebLLM research spikes

Exploratory only - not part of the shipped frontend. Validates whether
in-browser WebGPU LLM inference (WebLLM) is viable for the AI query feature
before the frontend agent builds against it.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npx playwright test tests/webgpu-support.spec.ts       # sanity check WebGPU works here
npx playwright test tests/list-models.spec.ts           # see available models + VRAM needs
WEBLLM_MODEL_ID="Llama-3.2-3B-Instruct-q4f16_1-MLC" \
  npx playwright test tests/webllm-text-to-sql.spec.ts   # load a model, generate SQL
```

See `FINDINGS.md` for the WebGPU-in-Playwright investigation (secure
context + platform-specific ANGLE backend gotchas) and `MODEL_FINDINGS.md`
for model-quality results.
