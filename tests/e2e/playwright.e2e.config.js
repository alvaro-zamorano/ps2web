// @ts-check
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.',
  testMatch: 'opfs.spec.js',
  timeout: 120000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'python3 ../../tools/serve.py ../../dist 8080',
    url: 'http://localhost:8080',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
