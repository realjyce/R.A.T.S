import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/xiao_start":   "http://localhost:5000",
      "/xiao_stop":    "http://localhost:5000",
      "/xiao_stream":  "http://localhost:5000",
      "/xiao_counts":  "http://localhost:5000",
      "/xiao":         "http://localhost:5000",
      "/phone_start":  "http://localhost:5000",
      "/phone_stop":   "http://localhost:5000",
      "/phone_stream": "http://localhost:5000",
      "/phone_counts": "http://localhost:5000",
      "/edge":         "http://localhost:5000",
      "/shelf2":       "http://localhost:5000",
      "/detect":       "http://localhost:5000",
      "/health":      "http://localhost:5000",
      "/metrics":     "http://localhost:5000",
    },
  },
});
