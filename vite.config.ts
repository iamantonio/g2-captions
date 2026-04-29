import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    environment: 'node',
  },
  build: {
    target: 'es2022',
  },
})
