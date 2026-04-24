/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

const TEST_PORT = 9876;
const TEST_BASE = `http://localhost:${TEST_PORT}`;
const TEST_URL = `${TEST_BASE}/lab`;

module.exports = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: TEST_BASE
  },
  webServer: {
    command: 'jlpm start',
    url: TEST_URL,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  }
};
