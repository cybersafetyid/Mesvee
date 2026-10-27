import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vitest configuration.
 * Unit tests target pure domain logic so they stay fast and do not need a native runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/core/**/*.ts'],
    },
  },
});
