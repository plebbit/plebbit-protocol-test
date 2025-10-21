import {defineConfig} from 'vitest/config'

const mochaTimeout = 120000

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: process.env.VITEST_BROWSER === 'firefox' ? 'firefox' : 'chromium',
          launch: {
            args: process.env.VITEST_BROWSER === 'firefox' ? [] : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security'],
          },
        },
      ],
    },
    include: ['test/node-and-browser/**/*.test.js'],
    globals: false,
    setupFiles: [],
    fileParallelism: false,
    env: {
      DEBUG: process.env.DEBUG,
      NO_COLOR: process.env.NO_COLOR,
      FORCE_COLOR: process.env.FORCE_COLOR,
      CI: process.env.CI,
    },
    passWithNoTests: false,
    testTimeout: mochaTimeout,
    hookTimeout: mochaTimeout,
    browserStartTimeout: mochaTimeout,
  },
  resolve: {
    alias: [
      {
        find: /^((\.\.\/)+)dist\/node(\/.*)?$/,
        replacement: (match, relativePath, _lastSlash, subPath) => {
          const path = subPath || ''
          return `${relativePath}dist/browser${path}`
        },
      },
    ],
  },
})
