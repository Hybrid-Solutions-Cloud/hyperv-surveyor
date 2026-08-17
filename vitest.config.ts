import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['Reference/**', 'node_modules/**', 'dist/**'],
  },
})
