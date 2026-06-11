import { defineConfig } from 'vite';

/**
 * Vite configuration for the Echoes of the Veil client.
 * The Workers backend lives in worker/ and is built separately by wrangler;
 * shared/ is plain TypeScript imported by both sides via relative paths.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is intentionally one large vendor chunk; raise the warning bar.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Keep three.js (and its addons) in one cacheable vendor chunk.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
