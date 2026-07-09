// @ts-check
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.',
  testMatch: 'bench.spec.js',
  timeout: 180000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    launchOptions: {
      // SwiftShader GL in CI headless; emulator needs WebGL2.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'python3 ../../tools/serve.py ../../dist 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
