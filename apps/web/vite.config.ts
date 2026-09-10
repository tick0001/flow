import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // L'interface parle a l'API par le meme domaine en developpement : les
      // cookies de session sont ainsi traites exactement comme en production.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Le flux temps reel d'une execution. Declare a part parce qu'il faut
      // `ws: true` : sans lui, la requete de bascule de protocole est relayee
      // comme une requete HTTP ordinaire et le WebSocket ne s'ouvre jamais --
      // en developpement seulement, ce qui est le pire cas de figure.
      '/api/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
