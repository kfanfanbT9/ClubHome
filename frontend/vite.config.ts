import react from '@vitejs/plugin-react';
// vitest/config의 defineConfig만 test 키를 안다(vite의 것은 타입 오류가 난다).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // main.tsx는 createRoot 호출 한 줄(DOM 마운트)이라 단정할 대상이 없고,
      // vite-env.d.ts는 타입 선언만 있어 실행 코드가 없다.
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
