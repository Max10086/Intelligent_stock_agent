import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Define global constants to replace in the code
  define: {
    // Make process.env available in browser (for compatibility)
    'process.env': JSON.stringify(process.env),
  },
  // Server configuration for development
  server: {
    port: 3000,
    open: true,
    // Proxy API requests to backend server
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
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
