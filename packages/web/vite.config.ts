import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rolldownOptions: { input: ['index.html', 'softphone.html', 'connect.html'] } },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/api': { target: 'http://127.0.0.1:8080' },
    },
  },
});
