const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3197', headless: true,
    channel: process.env.E2E_BROWSER_CHANNEL || (fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined),
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/browser/server.cjs', url: 'http://127.0.0.1:3197/api/providers',
    reuseExistingServer: false, timeout: 30000 },
});
