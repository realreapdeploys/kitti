import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/sim.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/ai/**'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 }
    }
  }
})
