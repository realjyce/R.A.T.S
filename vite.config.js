import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/detect_xiao": "http://localhost:5000",
      "/detect":      "http://localhost:5000",
      "/health":      "http://localhost:5000",
      "/metrics":     "http://localhost:5000",
    },
  },
});
