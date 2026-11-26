import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Content-hashed file names under /assets -> cached for a year by CloudFront
    // (see infra/scripts/deploy-frontend.sh for the Cache-Control headers).
    assetsDir: 'assets',
  },
  server: { port: 5173, strictPort: true },
});
