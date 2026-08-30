import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    rollupOptions: {
      output: {
        // Groups vendor deps by library family so app code changes don't
        // bust the whole vendor cache. react/react-dom/scheduler/router stay
        // together since react-dom and the router depend on react directly.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|react-is|scheduler|react-router|react-router-dom)\//.test(id)) {
            return 'vendor-react';
          }
          if (/node_modules\/(ai|@ai-sdk)\//.test(id)) {
            return 'vendor-ai';
          }
          if (/node_modules\/@zxing\//.test(id)) {
            return 'vendor-zxing';
          }
          if (/node_modules\/lucide-react\//.test(id)) {
            return 'vendor-icons';
          }
          if (/node_modules\/@radix-ui\//.test(id)) {
            return 'vendor-radix';
          }
          if (/node_modules\/(recharts|victory-vendor|d3-[^/]+|@reduxjs|immer|reselect|react-redux|use-sync-external-store)\//.test(id)) {
            return 'vendor-charts';
          }
          if (/node_modules\/@tanstack\//.test(id)) {
            return 'vendor-query';
          }
          if (/node_modules\/react-hook-form\//.test(id)) {
            return 'vendor-forms';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 3001,
    host: true,
  },
});
