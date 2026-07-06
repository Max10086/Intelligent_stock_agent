import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose NEXT_PUBLIC_* (and VITE_*) to the client via import.meta.env
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  // Server configuration for development
  server: {
    port: 3000,
    strictPort: true, // never fall back to 3001 (backend uses that port)
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
