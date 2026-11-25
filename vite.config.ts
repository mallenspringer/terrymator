import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const enableHarness = command === 'serve' || process.env.VITE_ENABLE_TEST_HARNESS === '1';

  return {
    plugins: [react()],
    define: {
      __ENABLE_TEST_HARNESS__: JSON.stringify(enableHarness),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
