// Component tests only (tests-react/). Deliberately NOT built on
// vite.config.ts: that config requires the LIBRARIAN_* build env, and
// component tests need none of the page build. Pure-logic tests stay in
// node:test (tests/).
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['tests-react/**/*.test.tsx'],
    setupFiles: ['tests-react/setup.ts']
  }
});
