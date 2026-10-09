import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // inline the brand font and logo so the build is a single self-contained bundle
  build: { assetsInlineLimit: 40000 },
})
