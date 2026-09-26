import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
