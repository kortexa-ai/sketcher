import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://kortexa-ai.github.io/sketcher/ in production.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/sketcher/' : '/',
  plugins: [react()],
}));
