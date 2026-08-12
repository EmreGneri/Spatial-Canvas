import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'src/embed.ts'),
      },
    },
  },
  optimizeDeps: {
    exclude: [
      // Node-side backends of @huggingface/transformers; the browser never needs them.
      'onnxruntime-node',
      'sharp',
      // Prebundling rewrites ORT's runtime `import(wasmPaths + ...)` into a Vite
      // module request, which then 500s because the file lives in /public.
      // Excluding these leaves the dynamic import as a plain fetch.
      '@huggingface/transformers',
      'onnxruntime-web',
    ],
  },
});
