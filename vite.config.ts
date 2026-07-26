import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
    watch: {
      ignored: [
        '**/.local-video/**',
        '**/.local-video-library/**',
        '**/tts-test/**',
        '**/temp/**',
        '**/dist/**',
        '**/output/**',
        '**/.claude/**',
        '**/scratch/**',
        '**/public/generated/**',
        '**/public/projects/**',
      ],
    },
    warmup: {
      clientFiles: ['./src/main.ts'],
    },
  },
});
