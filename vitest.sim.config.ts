import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/sim.test.ts'],
    testTimeout: 600000
  }
})
