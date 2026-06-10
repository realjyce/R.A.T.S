import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/xiao_start":  "http://localhost:5000",
      "/xiao_stop":   "http://localhost:5000",
      "/xiao_stream": "http://localhost:5000",
      "/xiao_counts": "http://localhost:5000",
      "/detect":      "http://localhost:5000",
      "/health":      "http://localhost:5000",
      "/metrics":     "http://localhost:5000",
    },
  },
});
