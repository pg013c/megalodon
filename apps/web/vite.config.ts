import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverPort = Number(process.env.MEGALODON_PORT ?? 4600);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.MEGALODON_WEB_PORT ?? 5600),
    strictPort: true,
    proxy: {
      // changeOrigin so the server's Host check sees its own host (ADR-0017)
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
    },
  },
});
