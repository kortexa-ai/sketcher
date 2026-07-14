import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://kortexa-ai.github.io/sketcher/ in production.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/sketcher/' : '/',
  plugins: [react()],
  build: {
    // three.js dominates the bundle; shipping it as its own chunk lets it
    // load in parallel and stay cached across app-code deploys.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
}));
