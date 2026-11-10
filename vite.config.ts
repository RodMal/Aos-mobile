import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative, so the same `dist/` works at a domain root and
// under a GitHub Pages project path (/Aos-mobile/).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
