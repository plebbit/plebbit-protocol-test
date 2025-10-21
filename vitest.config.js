import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/node/**/*.test.js', 'test/node-and-browser/**/*.test.js'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    passWithNoTests: true,
  },
})
