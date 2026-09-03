# WebGPU-in-Playwright findings

## TL;DR
The originally-given config didn't work, for two independent reasons:

1. **Secure context**: `navigator.gpu` does not exist at all on `about:blank` or
   `data:` URLs - WebGPU requires a secure context (`https://` or
   `http://127.0.0.1`/`localhost`). Tests must serve a real page from
   localhost, not navigate to `about:blank`. This was the primary bug -
   `navigator.gpu` was entirely `undefined`, not just failing to find an
   adapter.
2. **Platform-specific backend**: `--use-angle=vulkan` is a Linux-oriented
   flag. macOS has no native Vulkan driver, so with it `navigator.gpu` exists
   but `requestAdapter()` resolves to `null`. macOS needs `--use-angle=metal`
   instead, which gets a real Apple Silicon adapter (confirmed:
   `vendor: apple, architecture: metal-3`, ~4GB single-buffer limit - the
   spec-level ceiling discussed with the user, not a software fallback).

`playwright.config.ts` now branches on `process.platform`: Metal on macOS,
Vulkan+SwiftShader (software) on Linux, which is the standard approach for
GPU-less Linux CI runners.

## Verified working config

macOS:
```
--headless=new --use-angle=metal --enable-unsafe-webgpu --ignore-gpu-blocklist
```

Linux (untested here, no Linux host available, but this is the documented
community-verified pattern for GPU-less containers/CI):
```
--headless=new --use-angle=vulkan --use-vulkan=swiftshader
--enable-unsafe-swiftshader --enable-features=Vulkan,WebGPU
--enable-unsafe-webgpu --ignore-gpu-blocklist
```

## Diagnostic method (for next time)
- `chrome://gpu` is not navigable through Playwright/CDP automation.
- Launching the downloaded "Chrome for Testing" binary directly with
  `--enable-logging=stderr --v=1` and a `data:` URL that
  `console.log`s a probe result is a fast way to see engine-level state
  without fighting Playwright's page/console plumbing.
- Absence of *any* GPU/ANGLE/Dawn log lines (not even a failure) was the tell
  that this was a secure-context/API-visibility issue, not a GPU
  init/driver failure - if it were a driver issue, `navigator.gpu` would
  still exist and `requestAdapter()` would resolve to `null` with GPU
  process logs, as seen once the vulkan-on-macOS case was actually reachable.
