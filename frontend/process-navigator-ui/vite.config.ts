import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'PN_');
  return {
    plugins: [react()],
    // The offline BPMN modeler is intentionally isolated in a lazy-loaded chunk.
    build: { chunkSizeWarningLimit: 600 },
    server: {
      port: Number(env.PN_UI_PORT ?? 5173),
      proxy: { '/api': env.PN_API_URL ?? 'http://localhost:5080' }
    }
  };
});
