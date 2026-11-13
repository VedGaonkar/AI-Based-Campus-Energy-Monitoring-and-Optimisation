import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies the API and Socket.IO so the browser stays same-origin
// and no credential or backend address is ever needed in client code.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
