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
    port: 5273,
    proxy: {
      // L'interface parle a l'API par le meme domaine en developpement : les
      // cookies de session sont ainsi traites exactement comme en production.
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        // Le flux temps reel d'une execution passe par ici. Rien de special a
        // declarer : ce sont des evenements diffuses par le serveur sur une
        // requete HTTP ordinaire, que le relais transmet au fil de l'eau.
        //
        // Une entree `ws: true` a vecu ici, ecrite quand l'architecture
        // annoncait un WebSocket. Elle pointait vers une route qui n'existera
        // pas : une configuration qui ne sert a rien et qu'on garde par
        // prudence finit par etre copiee ailleurs.
      },
    },
  },
});
