import { defineConfig, devices } from '@playwright/test';

// WebGPU launch flags are platform-dependent:
// - macOS has no native Vulkan driver, so ANGLE must use its Metal backend.
// - Linux (typical CI) has no GPU at all by default, so ANGLE routes through
//   SwiftShader's software Vulkan implementation instead.
// See tests/FINDINGS.md for how this was diagnosed.
const webgpuArgs =
  process.platform === 'darwin'
    ? ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
    : [
        '--headless=new',
        '--use-angle=vulkan',
        '--use-vulkan=swiftshader',
        '--enable-unsafe-swiftshader',
        '--enable-features=Vulkan,WebGPU',
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
      ];

export default defineConfig({
  testDir: './tests',
  timeout: 5 * 60 * 1000,
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: webgpuArgs,
    },
  },
});
