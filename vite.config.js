import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',            // <- ESSENCIAL p/ evitar tela preta no pacote
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})