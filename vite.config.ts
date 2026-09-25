import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * SÜRÜM TEK KAYNAKTAN. Arayüz kendi sürümünü göstermiyordu; başlıkta aylar
 * önceki bir günün etiketi ("Gün A — ACES + bloom…") elle yazılı duruyordu ve
 * kimse güncellemediği için ekrandaki bilgi yanlıştı.
 *
 * Sürüm `package.json`'dan build zamanında enjekte edilir: elle yazılan ikinci
 * bir kopya olmadığı için tekrar eskiyemez. Dev sunucusunda da aynı değer gelir.
 */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
