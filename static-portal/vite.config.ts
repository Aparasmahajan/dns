import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static portal: no backend, no proxy. `npm run build` produces dist/index.html as ONE self-contained file
// (scripts/inline.mjs inlines the JS, CSS, fonts and icon) that opens by double-click.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5174 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 100_000_000, // fonts become data: URLs, so nothing is loaded from disk
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
