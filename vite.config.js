import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  optimizeDeps: {
    exclude: ['signal_processor'],
  },
  assetsInclude: ['**/*.wasm'],
})
