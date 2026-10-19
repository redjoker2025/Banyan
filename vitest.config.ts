import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/**/__tests__/**/*.spec.ts',
      'plugins/**/__tests__/**/*.spec.ts',
    ],
  },
})
